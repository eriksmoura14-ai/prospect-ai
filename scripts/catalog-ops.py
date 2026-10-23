"""Bounded idempotent public-catalog operations. DB credential only on stdin.
Schema is versioned in db/catalog-archive.sql and tested on coverage-dev.
"""
import argparse,gzip,hashlib,json,sys,time,uuid,re
from pathlib import Path
from urllib.parse import urlsplit
import requests
def main():
 p=argparse.ArgumentParser();p.add_argument('action',choices=['bootstrap','coverage','asset','manifest','export_legacy','queue','claim','checkpoint','add_region']);p.add_argument('--root',default='.artifacts/coverage-20261023');a=p.parse_args();root=Path(a.root)
 cfg=json.loads(sys.stdin.readline());url=cfg.get('url');assert isinstance(url,str);host=urlsplit(url).hostname
 assert host.endswith('.neon.tech');session=requests.Session();started=time.monotonic()
 def sql(query,params=None):
  response=session.post('https://'+host+'/sql',headers={'Neon-Connection-String':url,'Neon-Raw-Text-Output':'false','Neon-Array-Mode':'false'},json={'query':query,'params':params or []},timeout=(10,60),allow_redirects=False)
  if response.status_code!=200:raise RuntimeError('database_http_'+str(response.status_code))
  d=response.json()
  if 'error' in d:raise RuntimeError('database_query_rejected')
  rows=d.get('rows',[])
  if rows and isinstance(rows[0],list):rows=[dict(zip([f['name'] for f in d['fields']],r)) for r in rows]
  return rows
 def room():
  size=int(sql('SELECT pg_database_size(current_database()) AS bytes')[0]['bytes'])
  if size>220*1024*1024:raise RuntimeError('operations_database_budget')
 def batches(file,maximum=500,bytes_limit=3*1024*1024):
  current=[];size=0
  for line in (root/file).open():
   row=json.loads(line);n=len(line.encode())
   if current and (len(current)>=maximum or size+n>bytes_limit):yield current;current=[];size=0
   current.append(row);size+=n
  if current:yield current
 if a.action=='bootstrap':
  imported=0
  for batch in batches('admin-areas.ndjson',30):
   room();prepared=[{**r,'geometry':json.dumps(r['geometry'],separators=(',',':'))} for r in batch]
   sql("""INSERT INTO catalog_admin_areas(id,country_code,state_code,name,kind,source,vintage,license,geom,bounds,area_key,source_metadata)
    SELECT id,country_code,state_code,name,kind,source,vintage,license,ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(geometry),4326)),bounds,area_key,source_metadata
    FROM jsonb_to_recordset($1::jsonb) AS r(id text,country_code text,state_code text,name text,kind text,source text,vintage text,license jsonb,geometry text,bounds jsonb,area_key text,source_metadata jsonb)
    ON CONFLICT(id) DO NOTHING""",[json.dumps(prepared,ensure_ascii=False,separators=(',',':'))]);imported+=len(batch)
   if imported%300==0:print(json.dumps({'stage':'admin_areas','processed':imported}),flush=True)
  imported=0
  from importlib.util import spec_from_file_location,module_from_spec
  spec=spec_from_file_location('boundary',Path(__file__).with_name('catalog-boundaries.py'));mod=module_from_spec(spec);spec.loader.exec_module(mod)
  for batch in batches('mapped-inventory.ndjson',1000):
   room();prepared=[{'city_key':r['key'],'dataset':'csc-1.0.9','country_code':r['countryCode'],'country_name':r['countryName'],'state_code':r['stateCode'],'state_name':r['stateName'],'city_id':r['id'],'name':r['name'],'normalized_name':mod.normal(r['name']),'latitude':r.get('latitude'),'longitude':r.get('longitude'),'admin_id':r.get('admin_id'),'association_status':r['association_status'],'coverage_status':r['coverage_status'],'next_action':r['next_action']} for r in batch]
   sql("""INSERT INTO catalog_city_inventory(city_key,dataset,country_code,country_name,state_code,state_name,city_id,name,normalized_name,latitude,longitude,admin_id,association_status,coverage_status,next_action)
    SELECT city_key,dataset,country_code,country_name,state_code,state_name,city_id,name,normalized_name,latitude,longitude,admin_id,association_status,coverage_status,next_action
    FROM jsonb_to_recordset($1::jsonb) AS r(city_key text,dataset text,country_code text,country_name text,state_code text,state_name text,city_id bigint,name text,normalized_name text,latitude double precision,longitude double precision,admin_id text,association_status text,coverage_status text,next_action text)
    ON CONFLICT(city_key) DO UPDATE SET admin_id=coalesce(catalog_city_inventory.admin_id,excluded.admin_id),association_status=CASE WHEN catalog_city_inventory.admin_id IS NULL THEN excluded.association_status ELSE catalog_city_inventory.association_status END""",[json.dumps(prepared,ensure_ascii=False,separators=(',',':'))]);imported+=len(batch)
   (root/'ops-bootstrap-checkpoint.json').write_text(json.dumps({'inventoryProcessed':imported,'idempotent':True}))
   if imported%10000==0:print(json.dumps({'stage':'inventory','processed':imported}),flush=True)
  for part in ['00002','00003']:
   sql("INSERT INTO catalog_ingest_tasks(id,kind,region,budgets) VALUES($1,'overture_partition',$2,$3::jsonb) ON CONFLICT(id) DO NOTHING",['overture-2026-10-21.0-'+part,part,json.dumps({'downloadBytes':900*1024*1024,'maximumSeconds':1800,'memory':'768MB','regionsPerInvocation':1})])
  print(json.dumps({'bootstrapComplete':True,'result':sql('SELECT count(*) AS inventory,count(admin_id) AS mapped FROM catalog_city_inventory'),'elapsedMs':round((time.monotonic()-started)*1000)}),flush=True)
 elif a.action=='asset':
  asset=cfg['asset'];sql("""INSERT INTO catalog_assets(id,url,sha256,bytes,records,countries,bounds,source,release,license)
   VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10::jsonb) ON CONFLICT(id) DO NOTHING""",[asset['id'],asset['url'],asset['sha256'],asset['bytes'],asset['records'],asset['countries'],json.dumps(asset.get('bounds')),asset['source'],asset['release'],json.dumps(asset['license'])]);print(json.dumps({'assetRegistered':asset['id']}))
 elif a.action=='coverage':
  n=0
  for batch in batches('coverage-updates.ndjson',500):
   room()
   sql("""UPDATE catalog_city_inventory c SET unique_supported=r.unique_supported,unique_all=r.unique_all,source_rows=r.source_rows,category_count=r.category_count,sources=r.sources,limitations=r.limitations,coverage_status=r.coverage_status,next_action=r.next_action,updated_at=now()
    FROM jsonb_to_recordset($1::jsonb) AS r(city_key text,unique_supported int,unique_all int,source_rows int,category_count int,sources jsonb,limitations jsonb,coverage_status text,next_action text) WHERE c.city_key=r.city_key""",[json.dumps(batch,separators=(',',':'))]);n+=len(batch)
  print(json.dumps({'coverageUpdated':n,'summary':sql("SELECT coverage_status,count(*) AS n FROM catalog_city_inventory GROUP BY 1 ORDER BY 1")}))
 elif a.action=='queue':
  room()
  sql("""UPDATE catalog_ingest_tasks t SET state='done',checkpoint=jsonb_build_object('stage','target_met_by_regional_import','uniqueSupported',c.unique_supported),outcome=jsonb_build_object('target',t.target,'notACensus',true),updated_at=now()
   FROM catalog_city_inventory c WHERE t.id='city:'||c.city_key AND t.state='queued' AND c.unique_supported>=200""")
  sql("""INSERT INTO catalog_ingest_tasks(id,kind,region,round,target,state,budgets,outcome)
   SELECT 'city:'||city_key,'city_complement',city_key,CASE WHEN unique_supported>=100 THEN 3 WHEN unique_supported>=50 THEN 2 ELSE 1 END,
   CASE WHEN unique_supported>=100 THEN 200 WHEN unique_supported>=50 THEN 100 ELSE 50 END,'queued',
   '{"maximumSeconds":90,"maximumAttempts":3,"maximumResponseBytes":8388608,"concurrency":1}'::jsonb,
   jsonb_build_object('currentSupported',unique_supported,'priority','under_50_first')
   FROM catalog_city_inventory WHERE admin_id IS NOT NULL AND coalesce(unique_supported,0)<200
   ON CONFLICT(id) DO UPDATE SET round=excluded.round,target=excluded.target,outcome=excluded.outcome WHERE catalog_ingest_tasks.state='queued'""")
  sql("""INSERT INTO catalog_ingest_tasks(id,kind,region,state,budgets,outcome)
   SELECT 'country:'||country_code,'country_boundary_review',country_code,'blocked','{"maximumRegions":1,"automaticWorldScan":false}'::jsonb,
   '{"reason":"Official boundary crosswalk, source license, regional asset and resource budget must be reviewed before collection"}'::jsonb
   FROM catalog_city_inventory WHERE admin_id IS NULL GROUP BY country_code ON CONFLICT(id) DO NOTHING""")
  print(json.dumps({'queue':sql('SELECT kind,state,round,count(*) AS tasks FROM catalog_ingest_tasks GROUP BY 1,2,3 ORDER BY 1,2,3')}))
 elif a.action=='add_region':
  part=cfg['region'];assert re.fullmatch('[0-9]{5}',part);room()
  sql("INSERT INTO catalog_ingest_tasks(id,kind,region,budgets) VALUES($1,'overture_partition',$2,$3::jsonb) ON CONFLICT(id) DO NOTHING",['overture-2026-10-21.0-'+part,part,json.dumps({'downloadBytes':900*1024*1024,'maximumSeconds':1800,'memory':'768MB','concurrency':2,'automaticWorldScan':False})]);print(json.dumps({'queuedRegion':part}))
 elif a.action=='claim':
  token=str(uuid.uuid4());tasks=sql("""WITH candidate AS (SELECT id FROM catalog_ingest_tasks WHERE ($1::text IS NULL OR id=$1) AND attempts<3 AND run_after<=now() AND (state='queued' OR state='running' AND lease_until<now() OR $3::boolean AND state='blocked' AND checkpoint->>'stage'='awaiting_publication') ORDER BY round,updated_at FOR UPDATE SKIP LOCKED LIMIT 1)
   UPDATE catalog_ingest_tasks SET state='running',attempts=attempts+1,lease_token=$2::uuid,lease_until=now()+interval '30 minutes',updated_at=now() WHERE id IN (SELECT id FROM candidate) RETURNING id,kind,region,round,target,attempts,checkpoint,budgets""",[cfg.get('taskId'),token,bool(cfg.get('resumePublication'))])
  if tasks:tasks[0]['token']=token
  print(json.dumps({'task':tasks[0] if tasks else None}))
 elif a.action=='checkpoint':
  state=cfg.get('state','running');assert state in ('running','queued','done','blocked','failed')
  rows=sql("""UPDATE catalog_ingest_tasks SET checkpoint=$3::jsonb,state=$4,outcome=$5::jsonb,run_after=now()+interval '5 minutes',lease_until=CASE WHEN $4='running' THEN now()+interval '30 minutes' ELSE NULL END,updated_at=now() WHERE id=$1 AND lease_token=$2::uuid AND state='running' AND lease_until>now() RETURNING id,state""",[cfg['taskId'],cfg['token'],json.dumps(cfg['checkpoint']),state,json.dumps(cfg.get('outcome',{}))])
  if not rows:raise RuntimeError('lease_lost')
  print(json.dumps({'checkpointSaved':rows}))
 elif a.action=='manifest':
  data=cfg.get('manifest') or json.loads((root/'publication-manifest.json').read_text());digest=hashlib.sha256(json.dumps(data,separators=(',',':'),sort_keys=True).encode()).hexdigest();sql('INSERT INTO catalog_manifests(id,payload,sha256) VALUES($1,$2::jsonb,$3) ON CONFLICT(id) DO NOTHING',[data['id'],json.dumps(data),digest]);print(json.dumps({'manifestSaved':data['id']}))
 elif a.action=='export_legacy':
  result={}
  for table in ['discovery_records','discovery_areas','discovery_coverage']:
   result[table]=[r['row'] for r in sql('SELECT to_jsonb(t) AS row FROM '+table+' t')]
  (root/'legacy-snapshot.json').write_text(json.dumps(result,ensure_ascii=False));print(json.dumps({'publicLegacyRecords':len(result['discovery_records']),'areas':len(result['discovery_areas'])}))
if __name__=='__main__':
 try:main()
 except Exception as e:print(json.dumps({'error':type(e).__name__,'detail':str(e) if isinstance(e,RuntimeError) else 'operator_failed'}),flush=True);sys.exit(1)

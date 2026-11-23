"""Reconcile finite DE observations with immutable ready assets. No credentials.
Country membership comes from OSM relation/51477; city counts require polygons.
Original assets and raw source contacts are never overwritten or relabeled.
"""
import argparse,collections,csv,gzip,importlib.util,json,math,shutil,sqlite3,subprocess,time
from pathlib import Path
import duckdb,shapely
from shapely.geometry import shape,Point

def module(name,file):
 s=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
w=module('de_world','catalog-world-ingest.py')
class Worker:
 def __init__(self):self.p=subprocess.Popen(['node',str(Path(__file__).with_name('catalog-germany-normalize.cjs'))],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
 def run(self,rows):
  self.p.stdin.write(json.dumps(rows,ensure_ascii=False)+'\n');self.p.stdin.flush();line=self.p.stdout.readline()
  if not line:raise RuntimeError('normalization_worker_failed')
  data=json.loads(line)
  if len(data)!=len(rows):raise RuntimeError('normalization_batch_incomplete')
  return data
 def close(self):self.p.stdin.close();self.p.wait();assert self.p.returncode==0

def location(raw):
 values=raw.get('geometries',[])
 if not values:raise ValueError('location_missing')
 geometries=[shapely.from_wkt(value) for value in values]
 g=geometries[0]
 if any(not g.equals(other) for other in geometries[1:]):raise ValueError('location_ambiguous')
 if g.is_empty or not g.is_valid:raise ValueError('location_invalid')
 p=g if g.geom_type=='Point' else g.representative_point()
 if not (math.isfinite(p.x) and math.isfinite(p.y) and 5<=p.x<=16 and 47<=p.y<=56):raise ValueError('location_invalid')
 return p.x,p.y,'source_point' if g.geom_type=='Point' else 'source_geometry_point_on_surface'

def normalized(raw,result,groups):
 r=result['row'];ns=result['matchedNiches'];slugs=list(dict.fromkeys(s for n in ns for s in groups[n]));tags=raw['tags']
 provenance=[{'source':'qlever','sourceId':r['sourceId'],'family':'osm','license':r['license'],'url':r['sourceUrl'],'collectedAt':raw['collectedAt'],'countryEvidence':raw['countryEvidence']}]
 return {'source_id':r['sourceId'],'name':r['name'],'normalized_name':w.h.normalize(r['name']),'category':ns[0],
  'primary_category':slugs[0],'category_hierarchy':slugs,'alternate_categories':slugs[1:],'basic_category':slugs[0],
  'country_code':'DE','state':'','city':tags.get('addr:city',''),'original_city':tags.get('addr:city',''),
  'address':r['address'],'latitude':r['latitude'],'longitude':r['longitude'],'phone':r['phone'],'phones':[r['phone']] if r['phone'] else [],
  'website':r['website'],'websites':[r['website']] if r['website'] else [],'confidence':None,'operating_status':'unknown','source':'qlever',
  'source_release':'osm-qlever-collected-'+raw['collectedAt'][:10],'provenance':json.dumps(provenance,ensure_ascii=False),'license_id':'ODbL-1.0',
  'catalog_scope':'active_niche','discovered_at':raw['collectedAt'],'last_seen_at':raw['collectedAt'],'last_verified_at':None,
  'location_verification':raw['locationMethod']+';country_relation_51477','website_classification':r['websiteClassification'],
  'phone_verification':'listed_unverified' if r['phone'] else 'not_listed','verified_area_ids':[],
  'osm_tags':json.dumps(tags,ensure_ascii=False),'source_values':json.dumps(raw.get('sourceValues',{}),ensure_ascii=False),'matched_niches':ns}

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--root',required=True);a=ap.parse_args();root=Path(a.root);started=time.monotonic()
 report=json.loads((root/'source-report.json').read_text());assert report['complete'],'source_scan_not_complete'
 index=w.Index(root/'reconcile.sqlite');db=index.db
 db.executescript('CREATE TABLE IF NOT EXISTS businesses(root INTEGER PRIMARY KEY,payload TEXT,baseline INTEGER);CREATE TABLE IF NOT EXISTS observed(uri TEXT PRIMARY KEY,root INTEGER,status TEXT);')
 worker=Worker();c=duckdb.connect(config={'memory_limit':'256MB','threads':'1'})
 for item in json.loads((root/'download-map.json').read_text()):
  asset=item['metadata']
  if not str(item['file']).endswith('.parquet'):continue
  key='seed-de:'+asset['id'];prior=index.done(key)
  if prior:
   assert prior['sha256']==asset['sha256'];continue
  assert w.sha(item['file'])==asset['sha256']
  cursor=c.execute('SELECT * FROM read_parquet(?)',[item['file']]);cols=[x[0] for x in cursor.description];count=0
  while batch:=cursor.fetchmany(500):
   rows=[dict(zip(cols,v)) for v in batch];phones=worker.run([{'mode':'phone','phone':r.get('phone') or ''} for r in rows])
   with db:
    for r,p in zip(rows,phones):
     proxy={**r,'phone':p};index.seed(proxy);ident=w.identity(r['source'],r['source_id'],'DE');rid=db.execute('SELECT root FROM identities WHERE identity=?',(ident,)).fetchone()[0]
     db.execute('INSERT OR IGNORE INTO businesses VALUES(?,?,1)',(rid,json.dumps(r,ensure_ascii=False,default=str)))
   count+=len(rows)
  assert count==int(asset['records']);index.checkpoint(key,{'sha256':asset['sha256'],'count':count});print(json.dumps({'stage':'seed_ready','records':count}),flush=True)
 if not index.done('legacy-de'):
  legacy=json.loads((root/'legacy-de.json').read_text());ps=[]
  for offset in range(0,len(legacy),500):ps.extend(worker.run([{'mode':'phone','phone':r.get('phone') or ''} for r in legacy[offset:offset+500]]))
  counts=collections.Counter()
  with db:
   for r,p in zip(legacy,ps):
    if r['latitude'] is None or r['longitude'] is None:counts['invalid_location']+=1;continue
    r['provenance']=json.dumps({'originalSource':r['source'],'legacy':True});rid,status=index.accept({**r,'phone':p});counts[status]+=1
    if rid:db.execute('INSERT OR IGNORE INTO businesses VALUES(?,?,1)',(rid,json.dumps(r,ensure_ascii=False,default=str)))
  index.checkpoint('legacy-de',dict(counts))
 source=sqlite3.connect(root/'germany.sqlite');groups=json.loads((root/'runtime-groups.json').read_text());offset=''
 while batch:=source.execute('SELECT uri,payload FROM observations WHERE uri>? ORDER BY uri LIMIT 500',(offset,)).fetchall():
  if shutil.disk_usage(root).free<256*1024*1024:raise RuntimeError('disk_reserve_checkpoint_preserved')
  offset=batch[-1][0];pending=[];rejections=[]
  for uri,payload in batch:
   if db.execute('SELECT 1 FROM observed WHERE uri=?',(uri,)).fetchone():continue
   raw=json.loads(payload)
   try:raw['longitude'],raw['latitude'],raw['locationMethod']=location(raw);pending.append(raw)
   except (ValueError,shapely.errors.GEOSException) as e:rejections.append((uri,None,str(e)))
  results=worker.run(pending) if pending else []
  with db:
   db.executemany('INSERT OR IGNORE INTO observed VALUES(?,?,?)',rejections)
   for raw,result in zip(pending,results):
    if 'rejected' in result:db.execute('INSERT INTO observed VALUES(?,?,?)',(raw['uri'],None,result['rejected']));continue
    row=normalized(raw,result,groups);rid,status=index.accept({**row,'phone':result['dedupPhone']})
    if rid:db.execute('INSERT INTO businesses VALUES(?,?,0)',(rid,json.dumps(row,ensure_ascii=False)))
    else:rid=db.execute('SELECT root FROM identities WHERE identity=?',(w.identity('qlever',row['source_id'],'DE'),)).fetchone()[0]
    db.execute('INSERT INTO observed VALUES(?,?,?)',(raw['uri'],rid,status))
  if source.execute('SELECT count(*) FROM observations WHERE uri<=?',(offset,)).fetchone()[0]%10000==0:print(json.dumps({'stage':'reconcile','last':offset}),flush=True)
 worker.close();source.close()
 # Immutable source observations include all aliases/conflicting contacts for audit.
 obs=root/'source-observations.ndjson.gz'
 if not obs.exists():
  src=sqlite3.connect(root/'germany.sqlite')
  with gzip.open(obs,'wt') as out:
   for (payload,) in src.execute('SELECT payload FROM observations ORDER BY uri'):out.write(payload+'\n')
  src.close()
 # Exact city membership, vectorized; the full city inventory remains denominator.
 inventory=json.loads((root/'inventory.json').read_text());area_by_key={}
 for item in json.loads((root/'download-map.json').read_text()):
  if str(item['file']).endswith('.json'):
   for area in json.loads(Path(item['file']).read_text()).get('areas',[]):area_by_key[area['city_key']]=area
 for area in json.loads((root/'new-municipal-areas.json').read_text()):
  assert area['city_key'] not in area_by_key;area_by_key[area['city_key']]=area
 keys=list(area_by_key);tree=shapely.STRtree([shape(area_by_key[key]['geometry']) for key in keys]);counts=collections.defaultdict(collections.Counter);sources=collections.defaultdict(collections.Counter);metrics=collections.Counter();categories=collections.defaultdict(set);cur=db.execute('SELECT root,payload,baseline FROM businesses ORDER BY root')
 while batch:=cur.fetchmany(2000):
  rows=[json.loads(p) for rid,p,b in batch];points=shapely.points([r['longitude'] for r in rows],[r['latitude'] for r in rows]);pairs=tree.query(points,predicate='intersects');memberships=collections.defaultdict(list)
  for i,j in zip(*pairs):
   r=rows[i];co=counts[keys[j]];co['planned']+=1;co['active']+=batch[i][2];co['new']+=not batch[i][2];co['phone']+=bool(r.get('phone'));co['website']+=bool(r.get('website'));co['address']+=bool(r.get('address'));sources[keys[j]][r['source']]+=1;categories[keys[j]].add(r['category']);memberships[int(i)].append(keys[j])
  changes=[]
  for i,(r,(rid,_,baseline)) in enumerate(zip(rows,batch)):
   metrics['baseline_unique' if baseline else 'new_unique']+=1
   for k in ('phone','website','address'):metrics[('baseline_' if baseline else 'new_')+k]+=bool(r.get(k))
   if not baseline:
    r['verified_city_keys']=sorted(memberships[i]);r['verified_area_ids']=sorted({area_by_key[key]['id'] for key in memberships[i]})
    metrics['new_with_city_polygon' if memberships[i] else 'new_city_pending']+=1
    changes.append((json.dumps(r,ensure_ascii=False),rid))
  with db:db.executemany('UPDATE businesses SET payload=? WHERE root=?',changes)
 normalized_file=root/'new-unique.ndjson'
 with normalized_file.open('w') as out:
  for (payload,) in db.execute('SELECT payload FROM businesses WHERE baseline=0 ORDER BY root'):out.write(payload+'\n')
 columns={**w.NORMALIZED_COLUMNS,'osm_tags':'VARCHAR','source_values':'VARCHAR','matched_niches':'VARCHAR[]','verified_city_keys':'VARCHAR[]'}
 dest=root/'de-osm-new.parquet';types=','.join("'"+k+"':'"+v+"'" for k,v in columns.items())
 c.execute("CREATE TEMP TABLE output AS SELECT * FROM read_json(?,format='newline_delimited',columns={"+types+"})",[str(normalized_file)])
 c.execute('COPY output TO ? (FORMAT PARQUET,COMPRESSION ZSTD)',[str(dest)])
 coverage=[];before=collections.Counter();after=collections.Counter();active=collections.Counter()
 for city in inventory:
  key=city['city_key'];has=key in area_by_key;co=counts[key];old=city['unique_supported'];planned=co['planned'] if has else None;live=co['active'] if has else None
  row={'city_key':key,'name':city['name'],'state_code':city['state_code'],'before':old,'active_recount':live,'with_new_staged':planned,'new_unique_in_polygon':co['new'] if has else None,'phones':co['phone'] if has else None,'websites':co['website'] if has else None,'addresses':co['address'] if has else None,'category_count':len(categories[key]),'polygon_confirmed':has,'new_polygon':has and old is None,'sources':dict(sources[key]),'status':'geography_pending' if not has else 'target_met_staged' if planned>=50 else 'sources_consulted_below_target','next_action':'confirm_published_municipal_identity' if not has else 'approve_archive_adapter_before_osm_activation' if planned>=50 else 'complement_other_licensed_regional_sources'}
  coverage.append(row)
  for n in (50,100,200):
   before[str(n)]+=old is not None and old>=n;after[str(n)]+=planned is not None and planned>=n;active[str(n)]+=live is not None and live>=n
 (root/'coverage.json').write_text(json.dumps(coverage,ensure_ascii=False,indent=2))
 with (root/'coverage.csv').open('w') as out:
  writer=csv.DictWriter(out,fieldnames=list(coverage[0]));writer.writeheader();writer.writerows({**r,'sources':json.dumps(r['sources'])} for r in coverage)
 outcomes=dict(db.execute('SELECT status,count(*) FROM observed GROUP BY status').fetchall());summary={'country':'DE','inventoryCities':len(inventory),'beforeReadySourceRecords':412340,'beforeLegacySourceRecords':len(json.loads((root/'legacy-de.json').read_text())),'legacyReconciliation':index.done('legacy-de'),'sourceScan':report,'reconciliation':outcomes,'companies':dict(metrics),'thresholdsBefore':dict(before),'thresholdsActiveRecount':dict(active),'thresholdsWithNewStaged':dict(after),'cityGeometryConfirmed':len(keys),'cityGeometryPending':len(inventory)-len(keys),'newMunicipalPolygons':len(json.loads((root/'new-municipal-areas.json').read_text())),'sourceContactsVerified':False,'newOSMServingState':'staging_pending_archive_adapter','elapsedReconciliationSeconds':round(time.monotonic()-started,3),'parquetBytes':dest.stat().st_size,'sourceArchiveBytes':obs.stat().st_size,'baselineUnmodified':True,'newParquetSha256':w.sha(dest),'sourceArchiveSha256':w.sha(obs)}
 (root/'reconciliation-report.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2));print(json.dumps(summary,ensure_ascii=False),flush=True);db.close();c.close()
if __name__=='__main__':main()

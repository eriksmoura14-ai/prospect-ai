"""Build a versioned geographic serving index without deleting source assets.
Only coordinate indexes are materialized in operator memory; company records
stream through bounded DuckDB storage. Every input record is retained once.
"""
import argparse,hashlib,heapq,json,re,time
from pathlib import Path
import duckdb,numpy as np

def hits(cities,bounds):
 if not len(cities):return np.zeros(0,dtype=np.int16)
 w,s,e,n=bounds
 return ((cities[:,0]<=e)&(cities[:,2]>=w)&(cities[:,1]<=n)&(cities[:,3]>=s)).astype(np.int16)

def plan(points,codes,cities,target=25000,maximum=8):
 """Morton intervals are disjoint. Stop subdividing before a known app city's
 bbox would require more files than the existing eight-file reader budget."""
 cities=np.asarray(cities,dtype=float).reshape((-1,4))
 def bounds(a,b):
  p=points[a:b];return [float(p[:,0].min()),float(p[:,1].min()),float(p[:,0].max()),float(p[:,1].max())]
 root={'start':0,'end':len(points),'bounds':bounds(0,len(points))};counts=hits(cities,root['bounds']);queue=[(-len(points),0,root)];leaves=[];sequence=0
 while queue:
  _,_,node=heapq.heappop(queue);a,b=node['start'],node['end']
  if b-a<=target:leaves.append(node);continue
  middle=(a+b)//2;cut=int(np.searchsorted(codes,codes[middle],side='left'))
  if cut<=a:cut=int(np.searchsorted(codes,codes[middle],side='right'))
  if not a<cut<b:leaves.append(node);continue
  left={'start':a,'end':cut,'bounds':bounds(a,cut)};right={'start':cut,'end':b,'bounds':bounds(cut,b)}
  updated=counts-hits(cities,node['bounds'])+hits(cities,left['bounds'])+hits(cities,right['bounds'])
  if len(updated) and updated.max()>maximum:leaves.append(node);continue
  counts=updated
  for child in [left,right]:sequence+=1;heapq.heappush(queue,(-(child['end']-child['start']),sequence,child))
 leaves.sort(key=lambda r:r['start'])
 if sum(r['end']-r['start'] for r in leaves)!=len(points):raise RuntimeError('serving_partition_loss')
 return leaves,{'knownAreas':len(cities),'maximumFilesPerKnownArea':int(counts.max()) if len(counts) else 0,'files':len(leaves)}

def verify(db,inputs,assets):
 """Check every field, not only counts. Repartitioning is never new discovery.
 Hash aggregates are an integrity check alongside original SHA-256 receipts;
 they are not an assertion that the publisher verified these businesses."""
 original=[r['file'] for r in inputs];serving=[r['file'] for r in assets]
 columns=[r[0] for r in db.execute('DESCRIBE SELECT * FROM read_parquet(?,union_by_name=true)',[original]).fetchall()]
 expressions=[('CAST("source_id" AS VARCHAR)' if c=='source_id' else '"'+c.replace('"','""')+'"') for c in columns]
 query='SELECT count(*),sum(h::HUGEINT)::VARCHAR,bit_xor(h)::VARCHAR FROM (SELECT hash('+','.join(expressions)+') AS h FROM read_parquet(?,union_by_name=true))'
 before=db.execute(query,[original]).fetchone();after=db.execute(query,[serving]).fetchone()
 if before!=after:raise RuntimeError('serving_record_field_integrity_mismatch')
 return {'records':before[0],'allFieldsRetained':True,'hashSum':before[1],'hashXor':before[2]}

def main():
 p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--root',required=True);p.add_argument('--areas',action='append',required=True);p.add_argument('--target-rows',type=int,default=25000);args=p.parse_args();root=Path(args.root);root.mkdir(parents=True,exist_ok=True);start=time.monotonic()
 if not 10000<=args.target_rows<=200000:raise ValueError('serving_row_budget')
 inputs=json.loads(Path(args.input).read_text());files=[]
 for item in inputs:
  file=Path(item['file']);assert file.is_file() and hashlib.file_digest(file.open('rb'),'sha256').hexdigest()==item['sha256'];files.append(str(file))
 fingerprint=hashlib.sha256(json.dumps([(r['id'],r['sha256']) for r in inputs],sort_keys=True).encode()).hexdigest();checkpoint=root/'input-checkpoint.json'
 if checkpoint.exists() and json.loads(checkpoint.read_text())['sha256']!=fingerprint:raise RuntimeError('serving_inputs_changed_use_new_version_directory')
 cities={}
 for filename in args.areas:
  for line in Path(filename).open():
   row=json.loads(line);s,n,w,e=row['bounds'];cities.setdefault(row['country_code'],[]).append([w,s,e,n])
 db=duckdb.connect(str(root/'serving.duckdb'),config={'memory_limit':'512MB','threads':'1','temp_directory':str(root/'spill'),'max_temp_directory_size':'3GB','preserve_insertion_order':'false'})
 if not db.execute("SELECT count(*) FROM information_schema.tables WHERE table_name='serving_data'").fetchone()[0]:
  # Standard 16-bit Morton spread, vectorized by DuckDB; no extension download.
  db.execute('CREATE OR REPLACE MACRO spread1(v) AS ((v | (v << 8)) & 16711935)');db.execute('CREATE OR REPLACE MACRO spread2(v) AS ((spread1(v) | (spread1(v) << 4)) & 252645135)');db.execute('CREATE OR REPLACE MACRO spread3(v) AS ((spread2(v) | (spread2(v) << 2)) & 858993459)');db.execute('CREATE OR REPLACE MACRO spread4(v) AS ((spread3(v) | (spread3(v) << 1)) & 1431655765)')
  db.execute("CREATE TABLE serving_data AS SELECT * REPLACE(CAST(source_id AS VARCHAR) AS source_id), (spread4(CAST(floor((longitude+180)/360*65535) AS UBIGINT)) | (spread4(CAST(floor((latitude+90)/180*65535) AS UBIGINT)) << 1)) AS __catalog_morton FROM read_parquet(?,union_by_name=true) ORDER BY country_code,__catalog_morton,source_id",[files])
  checkpoint.write_text(json.dumps({'sha256':fingerprint,'inputs':[(r['id'],r['sha256']) for r in inputs]}))
 total,distinct,invalid=db.execute("SELECT count(*),count(DISTINCT source_id),count(*) FILTER(WHERE country_code IS NULL OR latitude IS NULL OR longitude IS NULL OR NOT latitude BETWEEN -90 AND 90 OR NOT longitude BETWEEN -180 AND 180) FROM serving_data").fetchone()
 if total!=distinct or invalid or total!=sum(int(r['records']) for r in inputs):raise RuntimeError('serving_input_identity_or_coordinate_mismatch')
 assets=[];country_reports=[]
 for cc,n in db.execute('SELECT country_code,count(*) FROM serving_data GROUP BY 1 ORDER BY 1').fetchall():
  if not re.fullmatch('[A-Z]{2}',cc):raise ValueError('invalid_source_country')
  arrays=[];cur=db.execute('SELECT longitude,latitude,__catalog_morton FROM serving_data WHERE country_code=? ORDER BY __catalog_morton,source_id',[cc])
  while True:
   rows=cur.fetchmany(50000)
   if not rows:break
   arrays.append(np.asarray(rows,dtype=float))
  coordinates=np.concatenate(arrays);del arrays
  leaves,metrics=plan(coordinates[:,:2],coordinates[:,2],cities.get(cc,[]),args.target_rows)
  for index,leaf in enumerate(leaves):
   destination=root/(cc+'-'+str(index).zfill(4)+'.parquet');a,b=leaf['start'],leaf['end'];low=int(coordinates[a,2]);high=int(coordinates[b-1,2])
   if not destination.exists():
    tmp=destination.with_suffix('.partial.parquet');db.execute("COPY (SELECT * EXCLUDE(__catalog_morton) FROM serving_data WHERE country_code=? AND __catalog_morton BETWEEN ? AND ? ORDER BY source_id) TO '"+str(tmp).replace("'","''")+"' (FORMAT PARQUET,COMPRESSION ZSTD,ROW_GROUP_SIZE 5000)",[cc,low,high]);tmp.replace(destination)
   count=db.execute('SELECT count(*) FROM read_parquet(?)',[str(destination)]).fetchone()[0]
   if count!=b-a:raise RuntimeError('serving_shard_record_mismatch')
   digest=hashlib.file_digest(destination.open('rb'),'sha256').hexdigest();size=destination.stat().st_size
   if size>256*1024*1024:raise RuntimeError('serving_shard_byte_budget')
   key='snapshots/serving-20261026/'+cc+'/'+digest+'.parquet';assets.append({'id':'serving-v2-'+cc+'-'+str(index).zfill(4)+'-'+digest[:16],'file':str(destination),'key':key,'url':'https://br-frosty-voice-b55arvzl.storage.c-7.us-east-2.aws.neon.tech/prospect-public-catalog/'+key,'sha256':digest,'bytes':size,'records':count,'countries':[cc],'bounds':leaf['bounds'],'source':'overture','release':'2026-10-21.0','state':'staging','license':{'id':'CDLA-Permissive-2.0 AND Apache-2.0 AND CC0-1.0','attribution':'Overture Maps Foundation; original per-record provenance/licenses and IDs unchanged'}})
  country_reports.append({'country':cc,'records':n,**metrics});(root/'serving-manifest.json').write_text(json.dumps({'version':2,'inputFingerprint':fingerprint,'oldAssets':[r['id'] for r in inputs],'assets':assets,'countries':country_reports,'complete':False},indent=2));print(json.dumps(country_reports[-1]),flush=True)
 integrity=verify(db,inputs,assets)
 result={'version':2,'inputFingerprint':fingerprint,'oldAssets':[r['id'] for r in inputs],'assets':assets,'countries':country_reports,'complete':True,'records':total,'newBusinesses':0,'integrity':integrity,'bytes':sum(r['bytes'] for r in assets),'elapsedMs':round((time.monotonic()-start)*1000),'sourceFilesPreserved':True}
 (root/'serving-manifest.json').write_text(json.dumps(result,indent=2));print(json.dumps({k:v for k,v in result.items() if k not in ('assets','oldAssets')}),flush=True)
if __name__=='__main__':main()

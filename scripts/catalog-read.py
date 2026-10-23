"""Bounded public immutable Parquet reader. No database credentials accepted.
Download cache is size/hash verified; full polygon filtering precedes pagination.
"""
import hashlib,json,os,re,shutil,sys,time,resource
from pathlib import Path
from urllib.parse import urlsplit
import duckdb,requests,shapely
from shapely.geometry import shape

ORIGIN='https://br-frosty-voice-b55arvzl.storage.c-7.us-east-2.aws.neon.tech/prospect-public-catalog/'
MAX_CACHE=512*1024*1024
def cached(asset,root,session):
 url=asset['url'];digest=asset['sha256'];size=int(asset['bytes'])
 if not url.startswith(ORIGIN) or urlsplit(url).query or not re.fullmatch('[a-f0-9]{64}',digest) or not 0<size<=256*1024*1024:raise ValueError('asset_policy')
 dest=root/(digest+'.parquet')
 if dest.exists():
  if dest.stat().st_size==size and hashlib.file_digest(dest.open('rb'),'sha256').hexdigest()==digest:os.utime(dest,None);return str(dest)
  dest.unlink()
 entries=sorted(root.glob('*.parquet'),key=lambda f:f.stat().st_mtime);used=sum(f.stat().st_size for f in entries)
 while entries and used+size>MAX_CACHE:
  item=entries.pop(0);used-=item.stat().st_size;item.unlink()
 if used+size>MAX_CACHE or shutil.disk_usage(root).free<size+256*1024*1024:raise RuntimeError('cache_budget')
 part=dest.with_suffix('.partial');h=hashlib.sha256();n=0
 try:
  with session.get(url,stream=True,timeout=(10,60),allow_redirects=False) as response:
   if response.status_code!=200:raise RuntimeError('asset_unavailable')
   with part.open('wb') as out:
    for block in response.iter_content(1024*1024):
     n+=len(block)
     if n>size:raise RuntimeError('asset_size')
     h.update(block);out.write(block)
  if n!=size or h.hexdigest()!=digest:raise RuntimeError('asset_integrity')
  part.replace(dest)
 finally:
  if part.exists():part.unlink()
 return str(dest)

def query(spec,files):
 limit=spec['limit'];assert isinstance(limit,int) and 1<=limit<=3000
 geometry=shape(spec['geometry']);assert geometry.is_valid and not geometry.is_empty
 shapely.prepare(geometry);s,n,w,e=spec['bounds'];assert list(geometry.bounds)==[w,s,e,n] or all(abs(a-b)<1e-5 for a,b in zip(geometry.bounds,[w,s,e,n]))
 c=duckdb.connect(config={'memory_limit':'128MB','threads':'1','autoinstall_known_extensions':'false','autoload_known_extensions':'false','enable_object_cache':'false'})
 params=[files,spec['countryCode'],w,e,s,n,spec['categories'],spec['categories'],spec['categories'],spec['categories'],spec.get('after','')]
 sql="""SELECT * FROM read_parquet(?,union_by_name=true) WHERE country_code=? AND longitude BETWEEN ? AND ? AND latitude BETWEEN ? AND ?
 AND (list_has_any(category_hierarchy,?) OR list_contains(?,primary_category) OR list_has_any(alternate_categories,?) OR list_contains(?,basic_category)) AND source_id>?
 QUALIFY row_number() OVER(PARTITION BY source_id ORDER BY discovered_at)=1 ORDER BY source_id"""
 cursor=c.execute(sql,params);columns=[d[0] for d in c.description];result=[];seen=0
 while len(result)<=limit:
  batch=cursor.fetchmany(256)
  if not batch:break
  for values in batch:
   row=dict(zip(columns,values));seen+=1
   if shapely.intersects_xy(geometry,row['longitude'],row['latitude']):result.append(row)
   if len(result)>limit:break
 more=len(result)>limit;result=result[:limit]
 c.close();return {'rows':result,'truncated':more,'next':result[-1]['source_id'] if more else None,'metrics':{'polygonCandidates':seen,'files':len(files)}}

def main():
 spec=json.loads(sys.stdin.read(3*1024*1024));root=Path(os.environ.get('CATALOG_CACHE_DIR','/tmp/prospect-catalog-cache'));root.mkdir(parents=True,exist_ok=True)
 if len(spec['assets'])>8:raise ValueError('asset_count')
 with requests.Session() as session:files=[cached(asset,root,session) for asset in spec['assets']]
 result=query(spec,files) if files else {'rows':[],'truncated':False,'next':None,'metrics':{'files':0}}
 result['metrics']['peakRssKiB']=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
 out=json.dumps(result,ensure_ascii=False,default=str)
 if len(out.encode())>8*1024*1024:raise RuntimeError('output_budget')
 print(out)
if __name__=='__main__':
 try:main()
 except Exception:print(json.dumps({'error':'catalog_read_unavailable'}));sys.exit(1)

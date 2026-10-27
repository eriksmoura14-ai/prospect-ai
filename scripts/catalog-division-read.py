"""Finite country extraction from one reviewed Overture division partition.

Requests keeps the inherited proxy and TLS. DuckDB uses only a loopback range
gateway with an aggregate byte/deadline budget. No worldwide geometry download.
The immutable publisher asset and completed ranges are cached for resumption.
"""
import argparse,hashlib,json,re,threading,time,shutil
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
import duckdb,requests

RELEASE='2026-10-21.0'
SELECTED_COLUMNS={'id','division_id','names','country','region','subtype','class','is_land','is_territorial','admin_level','sources','bbox','geometry'}

def cached_windows(rows,source):
 """Identify candidate offline windows with all selected column chunks cached.
 A cached country column alone does not establish that geometry was fetched.
 This is a column-availability plan; the actual offline read remains the final
 check because a reader can request padding between physical column chunks.
 """
 groups={}
 for row in rows:
  root=re.split(r'[,\.]',row['path_in_schema'])[0].strip()
  if root not in SELECTED_COLUMNS:continue
  groups.setdefault(row['row_group_id'],[]).append(row)
 windows=[];first=0
 for identity,columns in sorted(groups.items()):
  count=columns[0]['row_group_num_rows'];available=True
  roots={re.split(r'[,\.]',v['path_in_schema'])[0].strip() for v in columns}
  if roots!=SELECTED_COLUMNS:available=False
  for row in columns:
   start=row.get('dictionary_page_offset') or row['data_page_offset'];size=row['total_compressed_size']
   if not available:break
   if size<=0 or source.cache(start,start+size-1) is None:available=False
  if available:
   if windows and windows[-1]['lastRow']==first-1:windows[-1]['lastRow']=first+count-1;windows[-1]['groups'].append(identity)
   else:windows.append({'firstRow':first,'lastRow':first+count-1,'groups':[identity]})
  first+=count
 return windows

class RangeSource:
 def __init__(self,asset,root,maximum=128*1024*1024,seconds=180,offline=False,layer='division_area'):
  self.url=asset['url'];self.size=asset['size'];u=urlsplit(self.url)
  if layer not in ('division_area','division') or u.scheme!='https' or u.netloc!='overturemaps-us-west-2.s3.us-west-2.amazonaws.com' or not u.path.startswith('/release/'+RELEASE+'/theme=divisions/type='+layer+'/') or not re.fullmatch(r'part-\d{5}-[a-f0-9-]+\.zstd\.parquet',u.path.rsplit('/',1)[-1]) or u.query or u.fragment:raise ValueError('unreviewed_division_asset')
  if type(self.size) is not int or not 1<=self.size<900*1024*1024:raise ValueError('asset_budget')
  self.root=Path(root);self.root.mkdir(parents=True,exist_ok=True);self.maximum=maximum;self.deadline=time.monotonic()+seconds;self.received=0;self.reused=0;self.calls=0;self.errors=[];self.lock=threading.Lock();self.offline=offline
  self.ranges=[];self.validated=set()
  for p in self.root.iterdir():
   if re.fullmatch(r'\d+-\d+',p.name) and p.with_suffix('.json').exists():
    start,end=map(int,p.name.split('-'))
    if p.stat().st_size==end-start+1:self.ranges.append((start,end,p))
 def cache(self,start,end):
  cursor=start;pieces=[]
  while cursor<=end:
   choices=sorted((v for v in self.ranges if v[0]<=cursor<=v[1]),key=lambda v:v[1],reverse=True);found=False
   for first,last,path in choices:
    metadata=json.loads(path.with_suffix('.json').read_text())
    if metadata['url']!=self.url:continue
    if path not in self.validated:
     with path.open('rb') as file:digest=hashlib.file_digest(file,'sha256').hexdigest()
     if digest!=metadata['sha256']:continue
     self.validated.add(path)
    stop=min(last,end)
    with path.open('rb') as file:file.seek(cursor-first);pieces.append(file.read(stop-cursor+1))
    cursor=stop+1;found=True;break
   if not found:return None
  return b''.join(pieces)
 def request(self,start,end):
  if not 0<=start<=end<self.size or end-start+1>32*1024*1024:raise RuntimeError('range_budget')
  if time.monotonic()>self.deadline:raise RuntimeError('division_deadline')
  p=self.root/(str(start)+'-'+str(end));meta=p.with_suffix('.json');body=self.cache(start,end)
  if body is not None:self.reused+=len(body);return body
  if self.offline:raise RuntimeError('division_offline_cache_miss:'+str(start)+'-'+str(end))
  with self.lock:
   if self.received+end-start+1>self.maximum:raise RuntimeError('division_byte_budget')
   if shutil.disk_usage(self.root).free<end-start+1+256*1024*1024:raise RuntimeError('division_disk_budget')
   self.received+=end-start+1
  with requests.get(self.url,headers={'Range':f'bytes={start}-{end}','Accept-Encoding':'identity','User-Agent':'ProspectAI-reviewed-division-reader/1.0'},timeout=(10,30),allow_redirects=False,stream=True) as r:
   if r.status_code!=206:raise RuntimeError('division_http_'+str(r.status_code))
   if r.headers.get('Content-Range')!=f'bytes {start}-{end}/{self.size}' or int(r.headers.get('Content-Length',0))!=end-start+1:raise RuntimeError('division_invalid_range')
   chunks=[];received=0
   for block in r.iter_content(65536):
    received+=len(block)
    if received>end-start+1 or time.monotonic()>self.deadline:raise RuntimeError('division_response_budget')
    chunks.append(block)
   body=b''.join(chunks)
   if len(body)!=end-start+1:raise RuntimeError('division_invalid_range')
  p.write_bytes(body);meta.write_text(json.dumps({'url':self.url,'sha256':hashlib.sha256(body).hexdigest()}));self.ranges.append((start,end,p));self.validated.add(p);self.calls+=1;return body
 def metrics(self):return {'receivedBytes':self.received,'cachedBytesReused':self.reused,'requests':self.calls,'maximumBytes':self.maximum,'source':self.url}

def main():
 p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--assets',required=True);p.add_argument('--asset',required=True);p.add_argument('--country',required=True);p.add_argument('--state');p.add_argument('--offline',action='store_true');p.add_argument('--probe',action='store_true');p.add_argument('--metadata',action='store_true');p.add_argument('--cached-plan',action='store_true');p.add_argument('--country-index',action='store_true');p.add_argument('--include-counties',action='store_true');p.add_argument('--first-row',type=int);p.add_argument('--last-row',type=int);a=p.parse_args()
 if not re.fullmatch('[A-Z]{2}',a.country):raise ValueError('invalid_country')
 if a.state and not re.fullmatch('[A-Z0-9-]{1,8}',a.state):raise ValueError('invalid_subdivision')
 if (a.first_row is None)!=(a.last_row is None) or a.first_row is not None and not 0<=a.first_row<=a.last_row<100000000:raise ValueError('invalid_row_window')
 assets=[v for v in json.loads(Path(a.assets).read_text()) if v['id']==a.asset and v['theme']=='divisions-stac']
 if len(assets)!=1:raise ValueError('one_reviewed_asset_required')
 root=Path(a.root);root.mkdir(parents=True,exist_ok=True);source=RangeSource(assets[0],root/('ranges-'+a.asset),offline=a.offline or a.cached_plan);started=time.monotonic()
 class Gateway(BaseHTTPRequestHandler):
  def log_message(self,*args):pass
  def do_HEAD(self):
   self.send_response(200);self.send_header('Content-Length',source.size);self.send_header('Accept-Ranges','bytes');self.end_headers()
  def do_GET(self):
   try:
    m=re.fullmatch(r'bytes=(\d*)-(\d*)',self.headers.get('Range',''))
    if not m:raise RuntimeError('range_required')
    first,last=m.groups();start=int(first) if first else source.size-int(last);end=int(last) if first and last else source.size-1;body=source.request(start,end)
    self.send_response(206);self.send_header('Content-Length',len(body));self.send_header('Content-Range',f'bytes {start}-{end}/{source.size}');self.end_headers();self.wfile.write(body)
   except Exception as e:source.errors.append(str(e));self.send_error(503,'Stopped by source or resource budget')
 server=ThreadingHTTPServer(('127.0.0.1',0),Gateway);threading.Thread(target=server.serve_forever,daemon=True).start()
 db=duckdb.connect(config={'memory_limit':'512MB','threads':'1','autoinstall_known_extensions':'false','autoload_known_extensions':'false'});timer=threading.Timer(180,db.interrupt);timer.start()
 try:
  db.execute('LOAD httpfs');db.execute('SET http_timeout=35;SET http_retries=0;SET enable_http_metadata_cache=true')
  url='http://127.0.0.1:'+str(server.server_address[1])+'/division.parquet'
  if a.country_index:
   values=db.execute('SELECT country,subtype,count(*) AS sourceRows FROM read_parquet(?) WHERE is_territorial=true GROUP BY country,subtype ORDER BY country,subtype',[url]).fetchall()
   index={'assetId':a.asset,'release':RELEASE,'license':'ODbL-1.0','countrySubtypeCounts':[{'country':v[0],'subtype':v[1],'sourceRows':v[2]} for v in values],'transport':source.metrics(),'businessCoverage':False,'geometryColumnsRead':False};(root/('country-index-'+a.asset+'.json')).write_text(json.dumps(index,indent=2));print(json.dumps({'assetId':a.asset,'countrySubtypePairs':len(values),'transport':source.metrics(),'businessCoverage':False}),flush=True)
  elif a.cached_plan:
   values=db.execute('SELECT row_group_id,row_group_num_rows,path_in_schema,data_page_offset,dictionary_page_offset,total_compressed_size FROM parquet_metadata(?)',[url]).fetchall();columns=[v[0] for v in db.description];rows=[dict(zip(columns,v)) for v in values]
   plan={'assetId':a.asset,'windows':cached_windows(rows,source),'transport':source.metrics(),'actualOfflineReadStillRequired':True,'doesNotEstablishCountryCompleteness':True};(root/('cached-plan-'+a.asset+'.json')).write_text(json.dumps(plan,indent=2));print(json.dumps(plan),flush=True)
  elif a.metadata:
   values=db.execute("SELECT row_group_id,row_group_num_rows,path_in_schema,stats_min_value,stats_max_value,data_page_offset,dictionary_page_offset,total_compressed_size FROM parquet_metadata(?) WHERE path_in_schema IN ('country','region','geometry','id')",[url]).fetchall();columns=[v[0] for v in db.description];rows=[dict(zip(columns,v)) for v in values];(root/('row-groups-'+a.asset+'.json')).write_text(json.dumps(rows));print(json.dumps({'groups':len({v['row_group_id'] for v in rows}),'transport':source.metrics()}))
  elif a.probe:
   columns=db.execute('DESCRIBE SELECT * FROM read_parquet(?)',[url]).fetchall();print(json.dumps({'columns':columns,'transport':source.metrics()}),flush=True)
  else:
   window='-rows'+str(a.first_row)+'-'+str(a.last_row) if a.first_row is not None else ''
   output=root/(a.country+('-'+a.state if a.state else '')+window+('-with-counties' if a.include_counties else '')+'-'+a.asset+'.parquet');temporary=output.with_suffix('.partial.parquet')
   if temporary.exists():temporary.unlink() # Unpublished partial copy only.
   state_filter=' AND region=?' if a.state else ''
   row_filter=' AND file_row_number BETWEEN ? AND ?' if a.first_row is not None else ''
   types="('locality','localadmin','county')" if a.include_counties else "('locality','localadmin')"
   db.execute("COPY (SELECT id,division_id,names,country,region,subtype,class,is_land,is_territorial,admin_level,sources,bbox,geometry FROM read_parquet(?,file_row_number=true) WHERE country=? AND subtype IN "+types+" AND is_territorial=true"+state_filter+row_filter+") TO '"+str(temporary).replace("'","''")+"' (FORMAT PARQUET,COMPRESSION ZSTD,ROW_GROUP_SIZE 2048)",[url,a.country]+([a.country+'-'+a.state] if a.state else [])+([a.first_row,a.last_row] if a.first_row is not None else []));temporary.replace(output)
   count=db.execute('SELECT count(*) FROM read_parquet(?)',[str(output)]).fetchone()[0]
   report={'country':a.country,'assetId':a.asset,'records':count,'file':str(output),'bytes':output.stat().st_size,'sha256':hashlib.file_digest(output.open('rb'),'sha256').hexdigest(),'transport':source.metrics(),'elapsedMs':round((time.monotonic()-started)*1000),'sourceRelease':RELEASE,'license':'ODbL-1.0','exhaustive':False}
   output.with_name(output.stem+'-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
 except Exception:
  if source.errors:raise RuntimeError(source.errors[0])
  raise
 finally:timer.cancel();db.close();server.shutdown();server.server_close()
if __name__=='__main__':main()

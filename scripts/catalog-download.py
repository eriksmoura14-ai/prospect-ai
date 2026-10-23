"""One publisher-approved Overture regional partition, finite and resumable.
No credentials. Inherited proxy and TLS remain enabled. No request retries.
"""
import concurrent.futures,hashlib,json,os,sys,time,re
from pathlib import Path
from urllib.parse import urlsplit
import requests
import shutil
import argparse
parser=argparse.ArgumentParser();parser.add_argument('--region',required=True);args=parser.parse_args();ROOT=Path(args.region)
asset=json.loads((ROOT/'source-asset.json').read_text())
source=asset['assets']['aws'];url=source['href'];size=int(source['file:size'])
assert re.fullmatch('[0-9]{5}',asset['id']) and size<900*1024*1024
parsed=urlsplit(url)
assert parsed.scheme=='https' and parsed.netloc=='overturemaps-us-west-2.s3.us-west-2.amazonaws.com' and parsed.path.startswith('/release/2026-10-21.0/theme=places/type=place/') and not parsed.query
assert parsed.path.rsplit('/',1)[-1].startswith('part-'+asset['id']+'-') and parsed.path.endswith('.parquet')
existing=ROOT/'download-report.json';completed=ROOT/'regional-source.parquet'
if existing.exists() and completed.exists():
 previous=json.loads(existing.read_text())
 if previous['url']==url and previous['bytes']==completed.stat().st_size==size and hashlib.file_digest(completed.open('rb'),'sha256').hexdigest()==previous['sha256']:
  print(json.dumps({'reusedCompleteDownload':True,'assetId':asset['id'],'bytes':size,'sha256':previous['sha256']}));sys.exit(0)
if shutil.disk_usage(ROOT).free<size*2+512*1024*1024:raise RuntimeError('download_disk_budget')
chunks=ROOT/'download-chunks';chunks.mkdir(exist_ok=True)
block=16*1024*1024;started=time.monotonic();deadline=started+900
received=0
def get(index):
 start=index*block;end=min(size,start+block)-1;p=chunks/str(index)
 if p.exists() and p.stat().st_size==end-start+1:return index,True,0
 if time.monotonic()>deadline:raise RuntimeError('download_time_budget')
 headers={'Range':f'bytes={start}-{end}','Accept-Encoding':'identity','User-Agent':'ProspectAI-bounded-catalog/1.0 (+https://github.com/eriksmoura14-ai/prospect-ai)'}
 with requests.get(url,headers=headers,stream=True,timeout=(5,40),allow_redirects=False) as r:
  if r.status_code!=206:raise RuntimeError('download_http_'+str(r.status_code))
  assert r.headers.get('Content-Range')==f'bytes {start}-{end}/{size}' and int(r.headers.get('Content-Length',0))==end-start+1
  part=p.with_suffix('.part');n=0
  with part.open('wb') as out:
   for data in r.iter_content(1024*1024):
    n+=len(data)
    if n>end-start+1 or time.monotonic()>deadline:raise RuntimeError('download_budget')
    out.write(data)
  assert n==end-start+1
  part.replace(p)
 return index,False,n
try:
 count=(size+block-1)//block;done=[]
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  for index,cached,n in pool.map(get,range(count)):
   done.append(index);received+=n
   assert received<=900*1024*1024
   (ROOT/'download-checkpoint.json').write_text(json.dumps({'completedChunks':done,'chunks':count,'receivedThisRun':received,'expectedBytes':size}))
   if len(done)%4==0 or len(done)==count:print(json.dumps({'downloadChunks':len(done),'totalChunks':count,'verifiedBytes':sum((chunks/str(i)).stat().st_size for i in done),'expectedBytes':size}),flush=True)
 output=ROOT/'regional-source.parquet';digest=hashlib.sha256()
 with output.open('wb') as out:
  for i in range(count):
   with (chunks/str(i)).open('rb') as f:
    for data in iter(lambda:f.read(1024*1024),b''):out.write(data);digest.update(data)
 assert output.stat().st_size==size
 for p in chunks.iterdir():p.unlink()
 result={'source':'Overture Maps Foundation','release':'2026-10-21.0','assetId':asset['id'],'assetBounds':asset['bbox'],'url':url,'bytes':size,'sha256':digest.hexdigest(),'receivedThisRun':received,'elapsedMs':round((time.monotonic()-started)*1000),'maxNetworkBytes':900*1024*1024,'maxSeconds':900,'concurrency':2}
 (ROOT/'download-report.json').write_text(json.dumps(result));print(json.dumps(result),flush=True)
except Exception as error:
 print(json.dumps({'error':type(error).__name__,'reason':str(error)[:180]}),flush=True);sys.exit(1)

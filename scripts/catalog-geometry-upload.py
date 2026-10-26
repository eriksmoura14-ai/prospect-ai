"""Upload only reviewed, bounded public geometry chunks. Signed URLs arrive on
stdin, never in logs. Two connections, durable per-file completion checkpoint."""
import concurrent.futures,hashlib,json,sys,time
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit
import requests

def main():
    cfg=json.loads(sys.stdin.readline());root=Path(cfg['root']);items=cfg['uploads'];assert len(items)<=200
    checkpoint=root/'geometry-upload-checkpoint.json';completed=json.loads(checkpoint.read_text()) if checkpoint.exists() else {};start=time.monotonic()
    def upload(item):
        file=Path(item['file']).resolve();assert str(file).startswith('/workspace/') and file.is_file() and file.stat().st_size<=2*1024*1024
        sha=hashlib.file_digest(file.open('rb'),'sha256').hexdigest();assert sha==item['sha256']
        url=urlsplit(item['signedUrl']);assert url.scheme=='https' and url.hostname=='br-frosty-voice-b55arvzl.storage.c-7.us-east-2.aws.neon.tech' and url.path.startswith('/prospect-public-catalog/geography/')
        public=urlunsplit((url.scheme,url.netloc,url.path,'',''))
        if completed.get(item['key'])==sha:return item['key'],sha,True
        with file.open('rb') as body:
            response=requests.put(item['signedUrl'],data=body,headers=item.get('headers',{}),timeout=(10,60),allow_redirects=False)
        if response.status_code not in (200,201,204):raise RuntimeError('geometry_upload_http_'+str(response.status_code))
        with requests.get(public,stream=True,timeout=(10,30),allow_redirects=False) as response:
            response.raise_for_status();digest=hashlib.sha256();size=0
            for block in response.iter_content(65536):
                size+=len(block)
                if size>file.stat().st_size:raise RuntimeError('geometry_verification_size')
                digest.update(block)
            if size!=file.stat().st_size or digest.hexdigest()!=sha:raise RuntimeError('geometry_verification_hash')
        return item['key'],sha,False
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for key,sha,reused in pool.map(upload,items):
            completed[key]=sha;checkpoint.write_text(json.dumps(completed,sort_keys=True))
            if len(completed)%8==0 or len(completed)==len(items):print(json.dumps({'verifiedGeometryFiles':len(completed),'totalFiles':len(items),'resumed':reused}),flush=True)
    print(json.dumps({'geometryUploadsComplete':len(items),'elapsedMs':round((time.monotonic()-start)*1000)}),flush=True)
if __name__=='__main__':
    try:main()
    except Exception as e:print(json.dumps({'error':type(e).__name__,'detail':str(e) if isinstance(e,RuntimeError) else 'bounded_geometry_publication_failed'}),flush=True);sys.exit(1)

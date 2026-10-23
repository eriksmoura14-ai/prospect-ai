"""Upload one known public catalog artifact. Signed URL arrives on stdin only."""
import hashlib,json,sys,time
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit
import requests
try:
 cfg=json.loads(sys.stdin.readline());p=Path(cfg['file']).resolve();u=urlsplit(cfg['url'])
 assert str(p).startswith('/workspace/') and p.is_file() and p.stat().st_size<=1024*1024*1024
 assert u.scheme=='https' and u.hostname.endswith('.storage.c-7.us-east-2.aws.neon.tech') and not u.username
 digest=hashlib.file_digest(p.open('rb'),'sha256').hexdigest();assert digest==cfg['sha256']
 began=time.monotonic()
 with p.open('rb') as body:r=requests.put(cfg['url'],data=body,headers=cfg.get('headers',{}),timeout=(10,180),allow_redirects=False)
 if r.status_code not in (200,201,204):raise RuntimeError('upload_http_'+str(r.status_code))
 public=urlunsplit((u.scheme,u.netloc,u.path,'',''))
 check=requests.get(public,headers={'Range':'bytes=0-7'},timeout=(5,20),allow_redirects=False)
 assert check.status_code==206 and len(check.content)==8
 print(json.dumps({'uploaded':True,'url':public,'bytes':p.stat().st_size,'sha256':digest,'elapsedMs':round((time.monotonic()-began)*1000),'publicRangeVerified':True}),flush=True)
except Exception as e:
 print(json.dumps({'uploaded':False,'error':type(e).__name__,'detail':str(e) if isinstance(e,RuntimeError) else 'upload_or_integrity_check_failed'}),flush=True);sys.exit(1)

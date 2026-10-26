"""Bounded upload of content-addressed public shards. Signed URLs on stdin only.
Two concurrent transfers; durable receipts skip completed immutable objects.
"""
import concurrent.futures,hashlib,json,subprocess,sys,time
from pathlib import Path

def main():
 cfg=json.loads(sys.stdin.readline());root=Path(cfg['root']);manifest=json.loads((root/'serving-manifest.json').read_text())
 if not manifest.get('complete') or not manifest.get('integrity',{}).get('allFieldsRetained'):raise ValueError('unverified_serving_manifest')
 signed={r['id']:r for r in cfg['uploads']};checkpoint=root/'upload-checkpoint.json'
 done=json.loads(checkpoint.read_text()) if checkpoint.exists() else {};pending=[]
 for a in manifest['assets']:
  if done.get(a['id'],{}).get('sha256')==a['sha256']:continue
  u=signed[a['id']]
  if u['sha256']!=a['sha256'] or Path(u['file']).resolve()!=Path(a['file']).resolve():raise ValueError('upload_manifest_mismatch')
  pending.append(u)
 def upload(u):
  for attempt in range(3):
   r=subprocess.run([sys.executable,str(Path(__file__).with_name('catalog-upload.py'))],input=json.dumps(u),text=True,capture_output=True,timeout=210)
   try:result=json.loads(r.stdout)
   except ValueError:result={}
   if not r.returncode and result.get('uploaded'):return u['id'],result
   if attempt<2:time.sleep((5,15)[attempt])
  return u['id'],None
 failed=[]
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  futures=[pool.submit(upload,u) for u in pending]
  for future in concurrent.futures.as_completed(futures):
   identity,result=future.result()
   if result is None:failed.append(identity);continue
   done[identity]=result;temporary=checkpoint.with_suffix('.partial');temporary.write_text(json.dumps(done));temporary.replace(checkpoint)
   if len(done)%20==0:print(json.dumps({'uploaded':len(done),'total':len(manifest['assets'])}),flush=True)
 print(json.dumps({'uploaded':len(done),'complete':len(done)==len(manifest['assets']),'failed':failed}),flush=True)
 if failed:sys.exit(1)
if __name__=='__main__':main()

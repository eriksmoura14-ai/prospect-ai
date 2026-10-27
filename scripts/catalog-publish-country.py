"""Resume one prepared country publication; never fetch new business sources.

Private selectors stay local. Public checkpoints bind every completed step to
the exact business, geometry and coverage files. Existing catalogs are retained.
"""
import argparse,fcntl,hashlib,json,os,re,subprocess,sys
from pathlib import Path
from urllib.parse import urlsplit
import requests

ORIGIN='https://br-frosty-voice-b55arvzl.storage.c-7.us-east-2.aws.neon.tech/prospect-public-catalog/'
SCRIPTS=Path(__file__).resolve().parent

def digest(path):
 with Path(path).open('rb') as file:return hashlib.file_digest(file,'sha256').hexdigest()

def validate(root,asset,geometry,upload,geo_upload,database):
 if not asset['url'].startswith(ORIGIN+'snapshots/') or asset['url']!=ORIGIN+asset['key']:raise ValueError('unapproved_public_asset')
 file=Path(asset['file']).resolve()
 if file!=root/'new-country-businesses.parquet' or file.stat().st_size!=asset['bytes'] or digest(file)!=asset['sha256']:raise ValueError('prepared_business_integrity')
 if not 0<asset['bytes']<=64*1024*1024 or len(asset['countries'])!=1 or geometry['country']!=asset['countries'][0]:raise ValueError('country_publication_budget_or_identity')
 target=urlsplit(upload['url']);public=urlsplit(asset['url'])
 if (target.scheme,target.netloc,target.path)!=(public.scheme,public.netloc,public.path) or Path(upload['file']).resolve()!=file or upload['sha256']!=asset['sha256']:raise ValueError('signed_asset_identity')
 planned={v['key']:v for v in geometry['uploads']};signed={v['key']:v for v in geo_upload['uploads']}
 if len(signed)!=len(geo_upload['uploads']) or planned.keys()!=signed.keys() or Path(geo_upload['root']).resolve()!=root:raise ValueError('signed_geometry_inventory')
 for manifest in geometry['manifests']:
  if manifest['payload']['countryCode']!=asset['countries'][0] or not manifest['id'].startswith('geometry-v1:'+asset['countries'][0]+':'):raise ValueError('geometry_country_identity')
 for key,item in planned.items():
  signed_item=signed[key];p=Path(item['file']).resolve();u=urlsplit(signed_item['signedUrl']);expected=urlsplit(item['url'])
  if not item['url'].startswith(ORIGIN+'geography/') or (u.scheme,u.netloc,u.path)!=(expected.scheme,expected.netloc,expected.path):raise ValueError('signed_geometry_origin')
  if Path(signed_item['file']).resolve()!=p or signed_item['sha256']!=item['sha256'] or p.stat().st_size!=item['bytes'] or digest(p)!=item['sha256']:raise ValueError('prepared_geometry_integrity')
 db=urlsplit(database['url'])
 if db.username!='catalog_ops_owner' or db.path!='/catalog_ops' or not db.hostname.endswith('.neon.tech'):raise ValueError('isolated_public_catalog_required')
 with (root/'coverage-updates.ndjson').open() as coverage:
  for line in coverage:
   if not json.loads(line)['city_key'].startswith(asset['countries'][0]+':'):raise ValueError('coverage_country_identity')
 for selector in ['published-asset.json']:
  previous=root/selector
  if previous.exists() and json.loads(previous.read_text())!=asset:raise ValueError('existing_asset_must_be_preserved')
 return hashlib.sha256(json.dumps({'asset':asset,'geometry':geometry,'coverageSha256':digest(root/'coverage-updates.ndjson')},sort_keys=True,separators=(',',':')).encode()).hexdigest()

def database_room(database,asset):
 host=urlsplit(database['url']).hostname
 response=requests.post('https://'+host+'/sql',headers={'Neon-Connection-String':database['url'],'Neon-Raw-Text-Output':'false','Neon-Array-Mode':'false'},json={'query':'SELECT pg_database_size(current_database()) AS bytes,(SELECT to_jsonb(a) FROM catalog_assets a WHERE id=$1) AS existing','params':[asset['id']]},timeout=(10,30),allow_redirects=False)
 if response.status_code!=200:raise RuntimeError('database_preflight_http_'+str(response.status_code))
 data=response.json();rows=data.get('rows',[])
 if not rows:raise RuntimeError('database_preflight_failed')
 value=rows[0]['bytes'] if isinstance(rows[0],dict) else rows[0][0]
 if int(value)>=220*1024*1024:raise RuntimeError('operations_database_budget')
 existing=rows[0].get('existing') if isinstance(rows[0],dict) else rows[0][1]
 if isinstance(existing,str):existing=json.loads(existing)
 if existing and (any(str(existing[key])!=str(asset[key]) for key in ['url','sha256','bytes','records']) or existing['countries']!=asset['countries'] or existing['state']!='ready'):raise RuntimeError('existing_catalog_asset_conflict')
 return existing

def verify_remote(asset):
 sha=hashlib.sha256();size=0
 with requests.get(asset['url'],stream=True,timeout=(10,60),allow_redirects=False) as response:
  if response.status_code!=200:raise RuntimeError('remote_integrity_http_'+str(response.status_code))
  for block in response.iter_content(131072):
   size+=len(block)
   if size>asset['bytes']:raise RuntimeError('remote_integrity_size')
   sha.update(block)
 if size!=asset['bytes'] or sha.hexdigest()!=asset['sha256']:raise RuntimeError('remote_integrity_sha256')

def run(script,arguments,config):
 result=subprocess.run([sys.executable,str(SCRIPTS/script),*arguments],input=json.dumps(config)+'\n',capture_output=True,text=True,timeout=900)
 if result.returncode:
  detail=''
  for line in result.stdout.splitlines():
   try:value=json.loads(line).get('detail','')
   except (ValueError,AttributeError):continue
   if re.fullmatch(r'[a-zA-Z0-9_.:-]{1,160}',str(value)):detail=':'+value
  raise RuntimeError('publication_step_failed:'+script+detail)
 return result.stdout

def ensure_uploaded(asset,config):
 # A successful PUT can outlive the process that should have checkpointed it.
 # Reuse an existing immutable object; the next step verifies its full SHA-256.
 response=requests.head(asset['url'],timeout=(10,30),allow_redirects=False)
 if response.status_code==200:
  if response.headers.get('Content-Length') and int(response.headers['Content-Length'])!=asset['bytes']:raise RuntimeError('existing_remote_asset_size_conflict')
  return
 if response.status_code!=404:raise RuntimeError('asset_presence_http_'+str(response.status_code))
 run('catalog-upload.py',[],config)

def save(path,data):
 tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(data,indent=2));os.replace(tmp,path)

def main():
 p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--database-config',required=True);p.add_argument('--asset-config',required=True);p.add_argument('--geometry-config',required=True);p.add_argument('--check-only',action='store_true');p.add_argument('--geography-only',action='store_true');a=p.parse_args();root=Path(a.root).resolve()
 asset=json.loads((root/'publication-plan-asset.json').read_text());geometry=json.loads((root/'geometry-publication.json').read_text());upload=json.loads(Path(a.asset_config).read_text());geo_upload=json.loads(Path(a.geometry_config).read_text());database=json.loads(Path(a.database_config).read_text())
 fingerprint=validate(root,asset,geometry,upload,geo_upload,database)
 if a.geography_only and not (root/'published-asset.json').exists():raise ValueError('geography_update_requires_existing_frozen_asset')
 if a.check_only:print(json.dumps({'country':asset['countries'][0],'preparedFilesVerified':True,'fingerprint':fingerprint,'networkCalls':0}));return
 with (root/'publication.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  checkpoint=root/('geography-publication-'+fingerprint[:16]+'.json' if a.geography_only else 'publication-checkpoint.json');state=json.loads(checkpoint.read_text()) if checkpoint.exists() else {'fingerprint':fingerprint,'completed':[]}
  if state['fingerprint']!=fingerprint:raise RuntimeError('changed_publication_requires_separate_checkpoint')
  existing=database_room(database,asset)
  if a.geography_only and not existing:raise RuntimeError('geography_update_requires_registered_asset')
  steps=[('asset_uploaded',lambda:ensure_uploaded(asset,upload)),('asset_remote_sha256',lambda:verify_remote(asset)),('geometry_uploaded_and_verified',lambda:run('catalog-geometry-upload.py',[],geo_upload)),('geometry_registered',lambda:run('catalog-ops.py',['geometry_manifest','--root',str(root)],{**database,'manifests':geometry['manifests']})),('asset_registered',lambda:run('catalog-ops.py',['asset','--root',str(root)],{**database,'asset':asset})),('coverage_saved',lambda:run('catalog-ops.py',['coverage','--root',str(root)],{**database,'externalGeometry':True})),('queue_refreshed',lambda:run('catalog-ops.py',['queue','--root',str(root)],{**database,'minimumOnly':True}))]
  if a.geography_only:steps=[v for v in steps if v[0] not in ('asset_uploaded','asset_registered')]
  for name,action in steps:
   if name in state['completed']:continue
   database_room(database,asset);action();state['completed'].append(name);save(checkpoint,state)
   if name=='asset_registered':save(root/'published-asset.json',asset)
   print(json.dumps({'country':asset['countries'][0],'completedStep':name}),flush=True)
  if 'asset_registered' in state['completed']:save(root/'published-asset.json',asset)
  print(json.dumps({'country':asset['countries'][0],'publicationComplete':True,'continuousWorkerConfigured':False}),flush=True)

if __name__=='__main__':
 try:main()
 except Exception as error:
  print(json.dumps({'publicationComplete':False,'error':type(error).__name__,'detail':str(error) if isinstance(error,(ValueError,RuntimeError)) else 'publication_stopped_checkpoint_preserved'}),flush=True);sys.exit(1)

"""Reversible serving-index publication in the isolated public catalog only.
Credentials arrive on stdin. Source assets and original identifiers are retained.
Activate only after the bbox-aware backend has passed its deployment checks.
"""
import argparse,hashlib,json,sys
from pathlib import Path
from urllib.parse import urlsplit
import requests

def record_budget(manifest,inputs):
 assets=manifest['assets'];old=manifest['oldAssets']
 if len(set(r['id'] for r in inputs+assets))!=len(inputs)+len(assets) or old!=[r['id'] for r in inputs] or sum(int(r['records']) for r in inputs)!=manifest['records'] or sum(int(r['records']) for r in assets)!=manifest['records']:raise ValueError('record_identity_budget')
 return [{'id':r['id'],'sha256':r['sha256'],'records':int(r['records'])} for r in inputs+assets]

def main():
 p=argparse.ArgumentParser();p.add_argument('action',choices=['stage','activate']);p.add_argument('--root',required=True);a=p.parse_args();root=Path(a.root)
 cfg=json.loads(sys.stdin.readline());url=cfg['url'];host=urlsplit(url).hostname
 if not host or not host.endswith('.neon.tech'):raise ValueError('public_database_required')
 m=json.loads((root/'serving-manifest.json').read_text());inputs=json.loads((root/'input-assets.json').read_text());done=json.loads((root/'upload-checkpoint.json').read_text())
 if not m.get('complete') or not m.get('integrity',{}).get('allFieldsRetained') or m.get('newBusinesses')!=0:raise ValueError('serving_verification_required')
 assets=m['assets'];old=m['oldAssets']
 expected=record_budget(m,inputs)
 for r in assets:
  if not r['id'].startswith('serving-v2-') or done.get(r['id'],{}).get('sha256')!=r['sha256'] or done[r['id']]['bytes']!=r['bytes']:raise ValueError('upload_receipt_required')
  w,s,e,n=r['bounds']
  if not -180<=w<=e<=180 or not -90<=s<=n<=90:raise ValueError('asset_bounds')
 session=requests.Session()
 def sql(query,params=()):
  response=session.post('https://'+host+'/sql',headers={'Neon-Connection-String':url,'Neon-Raw-Text-Output':'false','Neon-Array-Mode':'false'},json={'query':query,'params':list(params)},timeout=(10,60),allow_redirects=False)
  if response.status_code!=200:raise RuntimeError('public_database_http_'+str(response.status_code))
  data=response.json()
  if 'error' in data:raise RuntimeError('public_database_statement_rejected')
  return data['rows']
 database=sql('SELECT current_database() AS name,pg_database_size(current_database()) AS bytes')[0]
 if database['name']!='catalog_ops':raise ValueError('isolated_public_catalog_database_required')
 if int(database['bytes'])>220*1024*1024:raise RuntimeError('operations_database_budget')
 if a.action=='stage':
  for start in range(0,len(assets),50):
   rows=[{**r,'state':'staging'} for r in assets[start:start+50]]
   sql("""INSERT INTO catalog_assets(id,url,sha256,bytes,records,countries,bounds,source,release,license,state)
    SELECT id,url,sha256,bytes,records,countries,bounds,source,release,license,'staging'
    FROM jsonb_to_recordset($1::jsonb) AS r(id text,url text,sha256 text,bytes bigint,records bigint,countries text[],bounds jsonb,source text,release text,license jsonb)
    ON CONFLICT(id) DO NOTHING""",[json.dumps(rows,separators=(',',':'))])
  print(json.dumps({'staged':len(assets),'activeSourceAssetsUnchanged':True}));return
 if cfg.get('bboxReaderLive') is not True:raise ValueError('verify_bbox_reader_deployment_before_activation')
 new=[r['id'] for r in assets]
 receipt={'id':'serving-v2:'+m['inputFingerprint'],'sourceAssets':inputs,'servingAssets':[{k:r[k] for k in ('id','sha256','records','bounds','bytes')} for r in assets],'records':m['records'],'newBusinesses':0,'integrity':m['integrity'],'sourceAssetsPreserved':True}
 digest=hashlib.sha256(json.dumps(receipt,sort_keys=True,separators=(',',':')).encode()).hexdigest()
 result=sql("""WITH expected AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS r(id text,sha256 text,records bigint)),
  checked AS (SELECT count(*)=$2::int AS ok FROM expected e JOIN catalog_assets a ON a.id=e.id AND a.sha256=e.sha256 AND a.records=e.records AND a.state IN ('ready','staging','retired')),
  changed AS (UPDATE catalog_assets SET state=CASE WHEN id=ANY($3::text[]) THEN 'ready' ELSE 'retired' END
   WHERE id IN (SELECT id FROM expected) AND (SELECT ok FROM checked) RETURNING id),
  receipt AS (INSERT INTO catalog_manifests(id,payload,sha256) SELECT $4,$5::jsonb,$6 FROM checked WHERE ok ON CONFLICT(id) DO NOTHING RETURNING id)
  SELECT (SELECT count(*) FROM changed) AS switched,(SELECT ok FROM checked) AS verified""",[json.dumps(expected),len(expected),new,receipt['id'],json.dumps(receipt),digest])
 if not result[0]['verified'] or int(result[0]['switched'])!=len(expected):raise RuntimeError('atomic_asset_switch_rejected')
 (root/'activation-receipt.json').write_text(json.dumps({'manifest':receipt['id'],'records':m['records'],'sourceAssetsRetained':old,'activeServingAssets':new},indent=2))
 print(json.dumps({'activeFiles':len(new),'records':m['records'],'originalAssetsPreserved':len(old),'newBusinesses':0}))
if __name__=='__main__':main()

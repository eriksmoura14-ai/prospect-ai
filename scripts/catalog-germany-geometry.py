"""Prepare reviewed municipal manifests, reusing ONLY exactly equal polygons.
Legacy manifests remain immutable. v2 is ignored by the existing production
reader until the reviewed application change is deployed. No source activation.
"""
import argparse,gzip,hashlib,importlib.util,json
from pathlib import Path
import shapely
from shapely.geometry import shape

def module(name,file):
 s=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
p=module('de_geo_publisher','catalog-world-publish.py');w=p.w

def prepare(root):
 areas=json.loads((root/'audited-municipal-areas.json').read_text());bykey={a['city_key']:a for a in areas};geoms={k:shape(a['geometry']) for k,a in bykey.items()};states={};reused=set();uploads=[]
 for a in areas:
  state=a['city_key'].split(':')[1];states.setdefault(state,{'version':1,'countryCode':'DE','stateCode':state,'municipalIdentityVerified':True,'municipalIdentities':{},'parts':[]})['municipalIdentities'][str(a['city_id'])]={'AGS':a['source_metadata']['AGS'],'source':a['source_metadata']['uri']}
 inputs=json.loads((root/'download-map.json').read_text())
 published=json.loads((root/'germany-publication.json').read_text())
 verified=json.loads((root/'germany-upload-receipt.json').read_text())
 for asset in published['uploads']:
  if asset['kind']!='geometry' or verified.get(asset['key'])!=asset['sha256']:continue
  data=json.loads((root/asset['file']).read_text())
  inputs.append({'metadata':{k:asset[k] for k in ('url','bytes','sha256')}|{'cityIds':[a['city_id'] for a in data['areas']]},'file':str(root/asset['file'])})
 for item in inputs:
  if not item['file'].endswith('.json'):continue
  data=json.loads(Path(item['file']).read_text());ids=[]
  for old in data.get('areas',[]):
   key=old['city_key']
   if key in geoms and key not in reused and shape(old['geometry']).equals(geoms[key]):ids.append(old['city_id']);reused.add(key)
  if ids:
   state=data['stateCode'];states[state]['parts'].append({**item['metadata'],'cityIds':ids})
 pending={}
 for a in areas:
  if a['city_key'] not in reused:pending.setdefault(a['city_key'].split(':')[1],[]).append(a)
 for state,rows in pending.items():
  chunks=[];chunk=[]
  for row in rows:
   if len(json.dumps({'version':1,'countryCode':'DE','stateCode':state,'areas':chunk+[row]},ensure_ascii=False,separators=(',',':')).encode())>1900000:
    if not chunk:raise ValueError('strict_geometry_row_budget')
    chunks.append(chunk);chunk=[]
   chunk.append(row)
  if chunk:chunks.append(chunk)
  for n,chunk in enumerate(chunks):
   file='de-strict-'+state+'-'+str(n)+'.json.gz';data={'version':1,'countryCode':'DE','stateCode':state,'areas':chunk};decoded=json.dumps(data,ensure_ascii=False,separators=(',',':')).encode();path=root/file;path.write_bytes(gzip.compress(decoded,compresslevel=9,mtime=0));sha=w.sha(path);key='geography/20261123/de-municipal-v2/'+state+'-'+sha[:16]+'.json.gz'
   item={'file':file,'key':key,'url':w.ORIGIN+key,'bytes':path.stat().st_size,'sha256':sha,'contentType':'application/gzip','kind':'strict-geometry','encoding':'gzip-json','decodedBytes':len(decoded),'decodedSha256':hashlib.sha256(decoded).hexdigest()}
   uploads.append(item);states[state]['parts'].append({k:item[k] for k in ('url','bytes','sha256','encoding','decodedBytes','decodedSha256')}|{'cityIds':[r['city_id'] for r in chunk]})
 manifests=[]
 for state,payload in sorted(states.items()):
  assert len(payload['parts'])<=200
  ids=[i for part in payload['parts'] for i in part['cityIds']];assert len(ids)==len(set(ids))==len(payload['municipalIdentities'])
  manifests.append({'id':'geometry-municipal-v2:DE:'+state,'payload':payload})
 plan={'country':'DE','states':len(states),'municipalScopes':len(areas),'exactOldPolygonsReused':len(reused),'newGeometryRows':len(areas)-len(reused),'uploads':uploads,'manifests':manifests,'productionCodeRequired':True,'sourceAssetsActivated':False}
 w.save(root/'strict-geometry-publication.json',plan);print(json.dumps({k:v for k,v in plan.items() if k not in ('uploads','manifests')}|{'newObjects':len(uploads),'newBytes':sum(x['bytes'] for x in uploads)}))

def publish(root,config,selectors,capacity):
 plan=json.loads((root/'strict-geometry-publication.json').read_text());cap=json.loads(Path(capacity).read_text());receipt=root/'strict-geometry-upload-receipt.json';done=json.loads(receipt.read_text()) if receipt.exists() else {};total=sum(a['bytes'] for a in plan['uploads'] if done.get(a['key'])!=a['sha256'])
 for used,maximum in (('transferUsed','transferLimit'),('storageUsed','storageLimit')):
  if not 0<=cap[used]<=cap[maximum]<=5000000000:raise ValueError('free_quota_evidence_required')
 if cap['transferUsed']+2*total+50*1024*1024>cap['transferLimit'] or cap['storageUsed']+total+50*1024*1024>cap['storageLimit']:raise RuntimeError('strict_geometry_free_quota_checkpoint_preserved')
 db=p.Database(p.private(config));db.room();signed=p.private(selectors)
 for item in plan['uploads']:
  if done.get(item['key'])==item['sha256']:continue
  p.upload_and_verify(root,item,signed[item['key']]);done[item['key']]=item['sha256'];w.save(receipt,done)
 for row in plan['manifests']:
  digest=hashlib.sha256(json.dumps(row['payload'],sort_keys=True,separators=(',',':')).encode()).hexdigest()
  db.sql('INSERT INTO catalog_manifests(id,payload,sha256) VALUES($1,$2::jsonb,$3) ON CONFLICT(id) DO NOTHING',[row['id'],json.dumps(row['payload']),digest])
  actual=db.sql('SELECT sha256 FROM catalog_manifests WHERE id=$1',[row['id']])
  if actual!=[{'sha256':digest}]:raise RuntimeError('strict_geometry_manifest_conflict')
 w.save(root/'strict-geometry-durable-receipt.json',{'verifiedNewObjects':len(done),'strictStateManifests':len(plan['manifests']),'scopes':plan['municipalScopes'],'legacyManifestsChanged':False,'businessSourcesActivated':False,'databaseBytes':db.room()})
 print(json.dumps({'verifiedNewObjects':len(done),'strictStateManifests':len(plan['manifests']),'sourceAssetsActivated':False}))
def main():
 ap=argparse.ArgumentParser();ap.add_argument('phase',choices=['prepare','publish']);ap.add_argument('--root',required=True);ap.add_argument('--database-config');ap.add_argument('--selectors');ap.add_argument('--capacity');a=ap.parse_args();root=Path(a.root)
 if a.phase=='prepare':prepare(root)
 else:publish(root,a.database_config,a.selectors,a.capacity)
if __name__=='__main__':main()

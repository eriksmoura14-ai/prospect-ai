"""Prepare/retain Germany data without activating source files in production.
Uses finite immutable keys, remote full hashes, existing quotas and staging only.
Private presigned selectors/SQL config are local mode 0600 inputs, never outputs.
"""
import argparse,hashlib,importlib.util,json,mimetypes
from pathlib import Path

def module(name,file):
 s=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
p=module('germany_publisher','catalog-world-publish.py');w=p.w
PREFIX='operations/20261123/germany-v1/'
def item(root,file,kind):
 path=root/file;sha=w.sha(path);key=PREFIX+path.stem+'-'+sha[:16]+''.join(path.suffixes)
 return {'file':file,'key':key,'url':w.ORIGIN+key,'bytes':path.stat().st_size,'sha256':sha,'kind':kind,'contentType':'application/octet-stream'}
def prepare(root):
 report=json.loads((root/'reconciliation-report.json').read_text());assert report['sourceScan']['complete']
 uploads=[item(root,'de-osm-new.parquet','businesses'),item(root,'source-observations.ndjson.gz','observations'),item(root,'coverage.csv','coverage')]
 business=uploads[0];business.update({'id':'germany-osm-v1-'+business['sha256'][:24],'records':report['companies']['new_unique'],'countries':['DE'],'bounds':None,'source':'qlever','release':'osm-qlever-collected-2026-11-23','license':{'id':'ODbL-1.0','url':'https://opendatacommons.org/licenses/odbl/1-0/','attribution':'© OpenStreetMap contributors; retrieved via QLever','shareAlike':True}})
 inventory={r['city_key']:r for r in json.loads((root/'inventory.json').read_text())};states={}
 for area in json.loads((root/'new-municipal-areas.json').read_text()):
  state=inventory[area['city_key']]['state_code'];states.setdefault(state,[]).append(area)
 originals={x['id']:x for x in json.loads((root/'geometry-manifests.json').read_text())};manifests=[]
 for state,areas in sorted(states.items()):
  identity='geometry-v1:DE:'+state;old=originals.get(identity);payload=json.loads(json.dumps(old['payload'])) if old else {'version':1,'countryCode':'DE','stateCode':state,'parts':[]}
  chunks=[];chunk=[]
  for area in areas:
   candidate={'version':1,'countryCode':'DE','stateCode':state,'areas':chunk+[area]}
   if len(json.dumps(candidate,ensure_ascii=False,separators=(',',':')).encode())>1900000:
    if not chunk:raise ValueError('geometry_row_budget')
    chunks.append(chunk);chunk=[]
   chunk.append(area)
  if chunk:chunks.append(chunk)
  for n,chunk in enumerate(chunks):
   file='de-municipal-'+state+'-'+str(n)+'.json';data={'version':1,'countryCode':'DE','stateCode':state,'areas':chunk};(root/file).write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')))
   a=item(root,file,'geometry');uploads.append(a);payload['parts'].append({k:a[k] for k in ('url','bytes','sha256')}|{'cityIds':[r['city_id'] for r in chunk]})
  if len(payload['parts'])>200:raise ValueError('geometry_part_budget')
  manifests.append({'id':identity,'payload':payload,'previousPayloadSha256':hashlib.sha256(json.dumps(old['payload'],sort_keys=True,separators=(',',':')).encode()).hexdigest() if old else None})
 (root/'geometry-plan.json').write_text(json.dumps({'manifests':manifests,'productionGeographyModified':False},ensure_ascii=False,separators=(',',':')))
 uploads.append(item(root,'geometry-plan.json','geometry-plan'))
 reportitem=item(root,'reconciliation-report.json','report');uploads.append(reportitem)
 strict=root/'strict-scope-report.json'
 if strict.exists():
  summary={k:v for k,v in json.loads(strict.read_text()).items() if k!='mismatches'}
  w.save(root/'strict-scope-summary.json',summary)
  uploads.extend([item(root,'strict-municipal-coverage.csv','strict-coverage'),item(root,'strict-scope-summary.json','strict-summary')])
  if (root/'real-data-smoke-strict.json').exists():uploads.append(item(root,'real-data-smoke-strict.json','strict-search-tests'))
 manifest={'version':1,'country':'DE','paidServicesEnabled':False,'servingState':'staging','codeDeploymentRequiredBeforeActivation':True,'existingAssetsModified':False,'productionGeographyModified':False,'uploads':uploads,'geometryManifestsForReview':manifests}
 manifest['legacyCoverageIsNotMunicipalProof']=True
 manifest['strictMunicipalCoverageAvailable']=strict.exists()
 w.save(root/'germany-publication.json',manifest);return manifest

def publish(root,config,selectors,capacity):
 manifest=json.loads((root/'germany-publication.json').read_text());limit=json.loads(Path(capacity).read_text())
 for used,maximum in (('transferUsed','transferLimit'),('storageUsed','storageLimit')):
  if not 0<=limit[used]<=limit[maximum]<=5000000000:raise ValueError('free_quota_evidence_required')
 receiptfile=root/'germany-upload-receipt.json';done=json.loads(receiptfile.read_text()) if receiptfile.exists() else {}
 total=sum(r['bytes'] for r in manifest['uploads'] if done.get(r['key'])!=r['sha256'])
 if limit['transferUsed']+2*total+50*1024*1024>limit['transferLimit']:raise RuntimeError('free_transfer_reserve_checkpoint_preserved')
 if limit['storageUsed']+total+50*1024*1024>limit['storageLimit']:raise RuntimeError('free_storage_reserve_checkpoint_preserved')
 db=p.Database(p.private(config));db.room();before=json.loads((root/'before-assets.json').read_text())
 current={r['id']:r for r in db.sql('SELECT id,url,sha256,bytes,records,countries,bounds,source,release,license,state FROM catalog_assets ORDER BY id')}
 for row in before:
  if row!=current.get(row['id']):raise RuntimeError('original_asset_changed_no_publication')
 signed=p.private(selectors)
 for asset in manifest['uploads']:
  if done.get(asset['key'])==asset['sha256']:continue
  p.upload_and_verify(root,asset,signed[asset['key']]);done[asset['key']]=asset['sha256'];w.save(receiptfile,done)
  print(json.dumps({'uploadedAndRemoteHashVerified':asset['file'],'bytes':asset['bytes']}),flush=True)
 business=[a for a in manifest['uploads'] if a['kind']=='businesses'];p.register(db,business,state='staging')
 # Save a discoverable durable operator receipt. Do not replace active geography.
 summary={k:v for k,v in manifest.items() if k!='geometryManifestsForReview'};summary['geometryPlan']={'url':next(a['url'] for a in manifest['uploads'] if a['kind']=='geometry-plan'),'active':False}
 digest=hashlib.sha256(json.dumps(summary,sort_keys=True,separators=(',',':')).encode()).hexdigest()
 identity='germany-scan-v1:20261123:'+digest[:16]
 db.sql('INSERT INTO catalog_manifests(id,payload,sha256) VALUES($1,$2::jsonb,$3) ON CONFLICT(id) DO NOTHING',[identity,json.dumps(summary),digest])
 result={'remoteHashVerifiedObjects':len(done),'newStagingRows':sum(a['records'] for a in business),'oldAssetRowsPreserved':len(before),'databaseBytes':db.room(),'productionCodeModified':False,'productionAssetsActivated':False,'productionGeographyModified':False}
 w.save(root/'germany-durable-receipt.json',result);print(json.dumps(result),flush=True)

def main():
 ap=argparse.ArgumentParser();ap.add_argument('phase',choices=['prepare','publish']);ap.add_argument('--root',required=True);ap.add_argument('--database-config');ap.add_argument('--selectors');ap.add_argument('--capacity');a=ap.parse_args();root=Path(a.root)
 if a.phase=='prepare':
  m=prepare(root);print(json.dumps({'objects':len(m['uploads']),'bytes':sum(x['bytes'] for x in m['uploads']),'businesses':m['uploads'][0]['records'],'servingState':m['servingState']}))
 else:publish(root,a.database_config,a.selectors,a.capacity)
if __name__=='__main__':main()

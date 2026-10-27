import hashlib,importlib.util,json,sys,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('country_publisher',Path(__file__).resolve().parents[1]/'scripts/catalog-publish-country.py');publisher=importlib.util.module_from_spec(spec);spec.loader.exec_module(publisher)

class PublicationSafety(unittest.TestCase):
 def setUp(self):
  response=type('Missing',(),{'status_code':404,'headers':{}})()
  p=patch.object(publisher.requests,'head',return_value=response);p.start();self.addCleanup(p.stop)
 def fixture(self,root):
  data=root/'new-country-businesses.parquet';data.write_bytes(b'fictional-file-for-control-flow-only')
  sha=hashlib.sha256(data.read_bytes()).hexdigest();key='snapshots/test/ch-'+sha+'.parquet'
  asset={'id':'fixture-ch','file':str(data),'key':key,'url':publisher.ORIGIN+key,'sha256':sha,'bytes':data.stat().st_size,'records':1,'countries':['CH']}
  g=root/'geometry.json';g.write_text('{}');gsha=hashlib.sha256(g.read_bytes()).hexdigest();gkey='geography/test/CH/'+gsha+'.json'
  item={'key':gkey,'url':publisher.ORIGIN+gkey,'file':str(g),'sha256':gsha,'bytes':2};geometry={'country':'CH','uploads':[item],'manifests':[]}
  upload={'file':str(data),'sha256':sha,'url':asset['url']+'?fixture-only'};geo_upload={'root':str(root),'uploads':[{**item,'signedUrl':item['url']+'?fixture-only'}]}
  database={'url':'postgresql://catalog_ops_owner:fixture@fixture.neon.tech/catalog_ops'}
  (root/'coverage-updates.ndjson').write_text('{"city_key":"CH:ZH:1"}\n')
  for name,value in [('publication-plan-asset.json',asset),('geometry-publication.json',geometry),('upload.json',upload),('geo-upload.json',geo_upload),('database.json',database)]:
   (root/name).write_text(json.dumps(value))
  usage={'projectId':publisher.capacity.PROJECT,'planFingerprint':publisher.capacity.fingerprint(asset,geometry,(root/'coverage-updates.ndjson').read_bytes()),'observedAtUnix':int(time.time()),'databaseBytes':1,'dataTransferBytes':0,'dataTransferQuotaBytes':5_000_000_000,'unreportedTransferBytes':0}
  (root/'capacity.json').write_text(json.dumps(usage))
  return asset,geometry,upload,geo_upload,database
 def arguments(self,root):
  return ['catalog-publish-country.py','--root',str(root),'--database-config',str(root/'database.json'),'--asset-config',str(root/'upload.json'),'--geometry-config',str(root/'geo-upload.json'),'--capacity-config',str(root/'capacity.json')]
 def test_missing_capacity_snapshot_stops_before_database_or_upload(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);self.fixture(root)
   with patch.object(sys,'argv',self.arguments(root)[:-2]),patch.object(publisher,'database_room',side_effect=AssertionError('network reached')),patch.object(publisher,'run',side_effect=AssertionError('upload reached')):
    with self.assertRaisesRegex(RuntimeError,'fresh_capacity_config_required'):publisher.main()
 def test_transfer_budget_stops_before_database_or_upload(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);self.fixture(root);p=root/'capacity.json';usage=json.loads(p.read_text());usage['dataTransferBytes']=4_999_999_999;p.write_text(json.dumps(usage))
   with patch.object(sys,'argv',self.arguments(root)),patch.object(publisher,'database_room',side_effect=AssertionError('network reached')),patch.object(publisher,'run',side_effect=AssertionError('upload reached')):
    with self.assertRaisesRegex(RuntimeError,'capacity_blocked:transfer_budget'):publisher.main()
   self.assertFalse((root/'publication-checkpoint.json').exists())
 def test_mismatched_signed_target_and_customer_database_are_rejected(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);a,g,u,gu,db=self.fixture(root)
   with self.assertRaisesRegex(ValueError,'signed_asset_identity'):publisher.validate(root,a,g,{**u,'url':'https://example.com/elsewhere'},gu,db)
   with self.assertRaisesRegex(ValueError,'isolated_public_catalog'):publisher.validate(root,a,g,u,gu,{'url':'postgresql://customer:fixture@fixture.neon.tech/customer_accounts'})
 def test_modified_prepared_data_invalidates_a_checkpoint(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);a,g,u,gu,db=self.fixture(root);before=publisher.validate(root,a,g,u,gu,db)
   (root/'coverage-updates.ndjson').write_text('{"city_key":"CH:ZH:1","changed":true}\n');self.assertNotEqual(before,publisher.validate(root,a,g,u,gu,db))
   Path(a['file']).write_bytes(b'altered')
   with self.assertRaisesRegex(ValueError,'business_integrity'):publisher.validate(root,a,g,u,gu,db)
 def test_foreign_coverage_and_existing_frozen_asset_cannot_be_replaced(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);a,g,u,gu,db=self.fixture(root)
   (root/'coverage-updates.ndjson').write_text('{"city_key":"CA:ON:1"}\n')
   with self.assertRaisesRegex(ValueError,'coverage_country_identity'):publisher.validate(root,a,g,u,gu,db)
   (root/'coverage-updates.ndjson').write_text('{"city_key":"CH:ZH:1"}\n');(root/'published-asset.json').write_text(json.dumps({**a,'id':'previous-immutable-asset'}))
   with self.assertRaisesRegex(ValueError,'existing_asset_must_be_preserved'):publisher.validate(root,a,g,u,gu,db)
 def test_database_budget_and_asset_collision_stop_before_any_upload(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);a,g,u,gu,db=self.fixture(root)
   class Response:
    status_code=200
    def __init__(self,row):self.row=row
    def json(self):return {'rows':[self.row]}
   with patch.object(publisher.requests,'post',return_value=Response({'bytes':220*1024*1024,'existing':None})):
    with self.assertRaisesRegex(RuntimeError,'operations_database_budget'):publisher.database_room(db,a)
   conflict={**a,'state':'ready','sha256':'different'}
   with patch.object(publisher.requests,'post',return_value=Response({'bytes':1024,'existing':conflict})):
    with self.assertRaisesRegex(RuntimeError,'existing_catalog_asset_conflict'):publisher.database_room(db,a)
 def test_remote_failure_never_activates_a_country_and_resumption_skips_upload(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);self.fixture(root);calls=[]
   def run(script,args,config):calls.append((script,args));return '{}'
   with patch.object(sys,'argv',self.arguments(root)),patch.object(publisher,'database_room'),patch.object(publisher,'run',side_effect=run),patch.object(publisher,'verify_remote',side_effect=RuntimeError('remote_integrity_http_503')):
    with self.assertRaisesRegex(RuntimeError,'503'):publisher.main()
   self.assertEqual(calls,[('catalog-upload.py',[])]);self.assertFalse((root/'published-asset.json').exists())
   calls.clear()
   with patch.object(sys,'argv',self.arguments(root)),patch.object(publisher,'database_room'),patch.object(publisher,'run',side_effect=run),patch.object(publisher,'verify_remote'):
    publisher.main();publisher.main()
   self.assertEqual([script for script,args in calls],['catalog-geometry-upload.py','catalog-ops.py','catalog-ops.py','catalog-ops.py','catalog-ops.py'])
   operations=[args[0] for script,args in calls if script=='catalog-ops.py'];self.assertEqual(operations,['geometry_manifest','asset','coverage','queue'])
   self.assertTrue((root/'published-asset.json').exists())
 def test_check_only_never_uses_network_or_mutates_publication(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);self.fixture(root)
   with patch.object(sys,'argv',self.arguments(root)+['--check-only']),patch.object(publisher.requests,'head',side_effect=AssertionError('network reached')),patch.object(publisher,'database_room',side_effect=AssertionError('network reached')),patch.object(publisher,'run',side_effect=AssertionError('mutated')):publisher.main()
   self.assertFalse((root/'publication-checkpoint.json').exists());self.assertFalse((root/'published-asset.json').exists())
 def test_geography_update_preserves_business_bytes_and_original_publication_checkpoint(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);a,*rest=self.fixture(root);(root/'published-asset.json').write_text(json.dumps(a));original='{"originalPublication":true}';(root/'publication-checkpoint.json').write_text(original);before=(root/'published-asset.json').read_bytes();calls=[]
   with patch.object(sys,'argv',self.arguments(root)+['--geography-only']),patch.object(publisher,'database_room'),patch.object(publisher,'verify_remote'),patch.object(publisher,'run',side_effect=lambda script,args,cfg:calls.append((script,args)) or '{}'):publisher.main()
   self.assertFalse(any(script=='catalog-upload.py' or args and args[0]=='asset' for script,args in calls));self.assertEqual((root/'published-asset.json').read_bytes(),before);self.assertEqual((root/'publication-checkpoint.json').read_text(),original);self.assertEqual(len(list(root.glob('geography-publication-*.json'))),1)
 def test_existing_remote_object_is_verified_instead_of_overwritten(self):
  response=type('Existing',(),{'status_code':200,'headers':{'Content-Length':'4'}})()
  with patch.object(publisher.requests,'head',return_value=response),patch.object(publisher,'run',side_effect=AssertionError('overwritten')):
   publisher.ensure_uploaded({'url':publisher.ORIGIN+'snapshots/fixture','bytes':4},{})
   with self.assertRaisesRegex(RuntimeError,'size_conflict'):publisher.ensure_uploaded({'url':publisher.ORIGIN+'snapshots/fixture','bytes':5},{})
 def test_operator_errors_keep_safe_codes_and_do_not_leak_private_urls(self):
  result=type('Failed',(),{'returncode':1,'stdout':'{"detail":"database_http_503"}\n'})()
  with patch.object(publisher.subprocess,'run',return_value=result):
   with self.assertRaisesRegex(RuntimeError,'database_http_503'):publisher.run('catalog-ops.py',[],{})
  result.stdout='{"detail":"https://private.example/?secret=fixture"}\n'
  with patch.object(publisher.subprocess,'run',return_value=result):
   with self.assertRaises(RuntimeError) as error:publisher.run('catalog-ops.py',[],{})
  self.assertNotIn('secret',str(error.exception));self.assertNotIn('private.example',str(error.exception))

if __name__=='__main__':unittest.main()

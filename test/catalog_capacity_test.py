import importlib.util,json,tempfile,unittest
from pathlib import Path

spec=importlib.util.spec_from_file_location('capacity',Path(__file__).resolve().parents[1]/'scripts/catalog-capacity.py');capacity=importlib.util.module_from_spec(spec);spec.loader.exec_module(capacity)

class CapacitySafety(unittest.TestCase):
 def fixture(self,root):
  asset={'bytes':100,'id':'fictional-fixture'};geometry={'uploads':[{'key':'geo/fixture','sha256':'a'*64,'bytes':200}]};coverage=b'fixture only'
  (root/'publication-plan-asset.json').write_text(json.dumps(asset));(root/'geometry-publication.json').write_text(json.dumps(geometry));(root/'coverage-updates.ndjson').write_bytes(coverage)
  return {'projectId':capacity.PROJECT,'planFingerprint':capacity.fingerprint(asset,geometry,coverage),'observedAtUnix':1000,'databaseBytes':100,'dataTransferBytes':4_900_000_000,'dataTransferQuotaBytes':5_000_000_000,'unreportedTransferBytes':0}
 def assess(self,root,usage,**kwargs):return capacity.assess(root,usage,now=1000,free_bytes=1024**3,**kwargs)
 def test_counts_upload_full_verification_geometry_and_application_reserve(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);r=self.assess(root,self.fixture(root));self.assertTrue(r['allowed']);self.assertEqual(r['remainingPublicationTransferBytes'],600+2*1024*1024);self.assertEqual(r['transferApplicationReserveBytes'],50*1024*1024)
 def test_known_unreported_io_is_reserved_even_if_provider_counter_lags(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);u=self.fixture(root);u['unreportedTransferBytes']=50*1024*1024;r=self.assess(root,u);self.assertFalse(r['allowed']);self.assertIn('transfer_budget_with_application_reserve',r['blockers'])
 def test_stale_future_wrong_project_and_reused_other_plan_are_rejected(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);u=self.fixture(root)
   for changes in [{'observedAtUnix':1001},{'observedAtUnix':0},{'projectId':'another-project'},{'planFingerprint':'b'*64}]:
    with self.subTest(changes=changes):
     # Use a late clock for the old snapshot only.
     with self.assertRaises(ValueError):capacity.assess(root,{**u,**changes},now=5000 if changes=={'observedAtUnix':0} else 1000,free_bytes=1024**3)
 def test_quota_cannot_increase_and_invalid_usage_is_rejected(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);u=self.fixture(root)
   for changes in [{'dataTransferQuotaBytes':5_000_000_001},{'dataTransferBytes':-1},{'unreportedTransferBytes':True},{'databaseBytes':None}]:
    with self.subTest(changes=changes):
     with self.assertRaises(ValueError):self.assess(root,{**u,**changes})
 def test_existing_database_guard_and_local_disk_reserve_are_enforced(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);u=self.fixture(root);r=self.assess(root,{**u,'databaseBytes':capacity.DATABASE_GUARD});self.assertIn('operations_database_budget',r['blockers']);r=capacity.assess(root,u,now=1000,free_bytes=capacity.DISK_RESERVE-1);self.assertIn('local_disk_reserve',r['blockers'])
 def test_resume_only_budgets_unfinished_and_hash_verified_geometry(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);u=self.fixture(root);(root/'publication-checkpoint.json').write_text(json.dumps({'fingerprint':u['planFingerprint'],'completed':['asset_uploaded','asset_remote_sha256']}));(root/'geometry-upload-checkpoint.json').write_text(json.dumps({'geo/fixture':'a'*64}));r=self.assess(root,u);self.assertEqual(r['remainingPublicationTransferBytes'],2*1024*1024)
   (root/'geometry-upload-checkpoint.json').write_text(json.dumps({'geo/fixture':'b'*64}));self.assertEqual(self.assess(root,u)['pendingGeometryDecodedBytes'],200)
 def test_geography_only_never_reserves_business_upload_but_verifies_original(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);r=self.assess(root,self.fixture(root),geography_only=True);self.assertEqual(r['assetUploadBytes'],0);self.assertEqual(r['assetVerificationBytes'],100)
 def test_changed_checkpoint_or_coverage_cannot_reuse_a_budget(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);u=self.fixture(root);(root/'publication-checkpoint.json').write_text(json.dumps({'fingerprint':'changed','completed':[]}))
   with self.assertRaisesRegex(ValueError,'checkpoint_mismatch'):self.assess(root,u)
   (root/'publication-checkpoint.json').unlink();(root/'coverage-updates.ndjson').write_text('changed')
   with self.assertRaisesRegex(ValueError,'plan_mismatch'):self.assess(root,u)

if __name__=='__main__':unittest.main()

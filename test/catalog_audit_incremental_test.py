import importlib.util,unittest
from pathlib import Path

spec=importlib.util.spec_from_file_location('incremental',Path(__file__).resolve().parents[1]/'scripts/catalog-audit-incremental.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class IncrementalProof(unittest.TestCase):
 def test_csv_json_and_nullable_counts_keep_the_ndjson_data_types(self):
  row={'city_key':'FI:01:1','city_id':'001','unique_supported':'','source_rows':'0','category_count':'2','sources':'[{"source":"overture","rows":0}]','limitations':'[]','review_id':''};decoded=m.decode_export_row(row)
  self.assertIsNone(decoded['unique_supported']);self.assertEqual(decoded['source_rows'],0);self.assertEqual(decoded['category_count'],2);self.assertEqual(decoded['sources'][0]['rows'],0);self.assertEqual(decoded['limitations'],[]);self.assertIsNone(decoded['review_id']);self.assertEqual(decoded['city_id'],'001')
 def test_missing_location_is_distinct_from_zero_companies(self):
  row={'city_key':'GB:NFK:1','unique_supported':None,'source_rows':None,'category_count':None,'association_status':'pending','coverage_status':'location_pending'}
  self.assertNotEqual(m.canonical(row),m.canonical({**row,'unique_supported':0}))
  self.assertEqual(m.canonical(row),m.canonical({**row,'unique_supported':''}))
 def test_database_and_all_country_fingerprints_must_match(self):
  local={'GB':{'cities':3,'min50':1,'fingerprint':'abc'}};proof={'database':'catalog_ops','countries':[{'country_code':'GB','cities':3,'min50':1,'fingerprint':'abc'}]};m.verified(local,proof)
  for change in ({'fingerprint':'changed'},{'cities':4},{'min50':2}):
   with self.assertRaisesRegex(ValueError,'fingerprint_mismatch'):m.verified(local,{**proof,'countries':[{**proof['countries'][0],**change}]})
  with self.assertRaisesRegex(ValueError,'country_identity'):m.verified(local,{**proof,'countries':[]})
  with self.assertRaisesRegex(ValueError,'isolated_public'):m.verified(local,{**proof,'database':'private_auth'})
 def test_ambiguous_fingerprint_delimiters_are_rejected(self):
  with self.assertRaises(ValueError):m.canonical({'city_key':'GB:NFK:1|2'})
 def test_retired_source_requires_exact_active_serving_repartition(self):
  asset={'id':'original','sha256':'abc','records':10};leaf={'id':'spatial','sha256':'def','records':10};proof={'assets':[{**asset,'state':'retired'},{**leaf,'state':'ready'}]}
  self.assertFalse(m.published_asset(asset,proof))
  receipt={'sourceAssets':[asset],'servingAssets':[leaf],'records':10,'newBusinesses':0,'integrity':{'allFieldsRetained':True}};proof['servingManifests']=[receipt];self.assertTrue(m.published_asset(asset,proof))
  for field,value in [('state','staging'),('sha256','changed'),('records',9)]:
   bad={**proof,'assets':[proof['assets'][0],{**proof['assets'][1],field:value}]};self.assertFalse(m.published_asset(asset,bad))

if __name__=='__main__':unittest.main()

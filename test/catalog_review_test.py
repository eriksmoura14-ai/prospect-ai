import copy,importlib.util,unittest
from pathlib import Path
s=importlib.util.spec_from_file_location('review',Path(__file__).resolve().parents[1]/'scripts/catalog-review.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class BelowTargetReview(unittest.TestCase):
 def example(self):return {'cityKey':'FR:55:1','name':'Fictional test locality','decision':'audited_below_target','uniqueSupported':0,'reason':'uninhabited_locality_with_documented_sources','sourcesExhausted':False,'limitations':['Available sources are not a universal census'],'sources':[{'kind':'official_locality_registry','url':'https://official.example/localities','license':'Etalab-2.0','outcome':'success','population':0},{'kind':'official_business_registry','url':'https://official.example/businesses','license':'Etalab-2.0','outcome':'success','measure':'active_legal_units','count':1},{'kind':'business_catalog','url':'https://source.example/catalog','license':'CDLA-Permissive-2.0','outcome':'success','count':0}]}
 def test_audit_does_not_mean_target_met_or_all_sources_exhausted(self):
  r=self.example();self.assertEqual(m.validate(r)['uniqueSupported'],0)
  with self.assertRaises(ValueError):m.validate({**r,'sourcesExhausted':True})
  with self.assertRaises(ValueError):m.validate({**r,'uniqueSupported':50})
 def test_empty_catalog_or_failed_registry_is_not_sufficient(self):
  r=self.example();r['sources'][1]['outcome']='temporary_failure'
  with self.assertRaises(ValueError):m.validate(r)
  r=self.example();r['sources']=r['sources'][:2]
  with self.assertRaises(ValueError):m.validate(r)
 def test_legal_units_cannot_be_claimed_as_establishment_counts(self):
  r=self.example();r['reason']='documented_establishment_register_below_target'
  with self.assertRaises(ValueError):m.validate(r)
  r['sources'][1]['measure']='active_establishments';self.assertIs(m.validate(r),r)
 def test_population_and_reusable_public_evidence_are_required(self):
  r=self.example();r['sources'][0]['population']=120
  with self.assertRaises(ValueError):m.validate(r)
  r=self.example();r['sources'][1]['url']='https://secret:credential@official.example/businesses'
  with self.assertRaises(ValueError):m.validate(r)
if __name__=='__main__':unittest.main()

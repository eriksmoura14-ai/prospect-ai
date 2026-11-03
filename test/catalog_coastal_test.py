import collections,importlib.util,unittest
from pathlib import Path
from shapely.geometry import box,Polygon,mapping

s=importlib.util.spec_from_file_location('coastal',Path(__file__).resolve().parents[1]/'scripts/catalog-coastal-recovery.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)

class CoastalProof(unittest.TestCase):
 def area(self,geometry=None):return {'id':'reviewed-town','country_code':'FI','license':{'id':'ODbL-1.0'},'geometry':mapping(geometry or box(2,2,4,4))}
 def test_coarse_map_rejection_never_authorizes_a_buffer_or_nearest_city(self):
  index=m.ReviewedAreas([self.area()],'FI');self.assertEqual(index.proof({'country_code':'FI','latitude':3,'longitude':3}),['reviewed-town']);self.assertEqual(index.proof({'country_code':'FI','latitude':3,'longitude':4.00001}),[])
 def test_country_holes_and_invalid_coordinates_remain_rejected(self):
  index=m.ReviewedAreas([self.area(Polygon([(0,0),(4,0),(4,4),(0,4)],holes=[[(1,1),(3,1),(3,3),(1,3)]]))],'FI')
  for row in [{'country_code':'SE','latitude':.5,'longitude':.5},{'country_code':'FI','latitude':2,'longitude':2},{'country_code':'FI','latitude':float('nan'),'longitude':1},{'country_code':'FI','latitude':1,'longitude':float('inf')}]:self.assertEqual(index.proof(row),[])
 def test_foreign_or_unreviewed_area_cannot_authorize_recovery(self):
  for area in [{**self.area(),'country_code':'SE'},{**self.area(),'license':{'id':'unknown'}}]:
   with self.assertRaises(ValueError):m.ReviewedAreas([area],'FI')

class CanonicalDeltaHistory(unittest.TestCase):
 def test_preexisting_duplicate_observations_survive_canonical_seeding(self):
  counts={'town':collections.Counter(unique=49,source_rows=49)};sources={'town':collections.Counter(overture=49)};inventory=[{'key':'FI:X:1','admin_id':'town'}];old=[{'city_key':'FI:X:1','unique_supported':49,'source_rows':52,'sources':[{'source':'overture','rows':52}]}]
  m.country.restore_observation_history(counts,sources,inventory,old);self.assertEqual(counts['town']['unique'],49);self.assertEqual(counts['town']['source_rows'],52);self.assertEqual(sources['town']['overture'],52)
 def test_changed_scope_or_lost_existing_business_aborts_delta(self):
  inventory=[{'key':'FI:X:1','admin_id':'town'}];old=[{'city_key':'FI:X:1','unique_supported':50,'source_rows':52,'sources':[{'source':'overture','rows':52}]}]
  with self.assertRaisesRegex(ValueError,'canonical_coverage_changed'):m.country.restore_observation_history({'town':collections.Counter(unique=49,source_rows=49)},{'town':collections.Counter(overture=49)},inventory,old)

if __name__=='__main__':unittest.main()

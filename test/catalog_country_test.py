import importlib.util,unittest
from pathlib import Path
from shapely.geometry import box
s=importlib.util.spec_from_file_location('country',Path(__file__).resolve().parents[1]/'scripts/catalog-country.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
o=importlib.util.spec_from_file_location('ops',Path(__file__).resolve().parents[1]/'scripts/catalog-ops.py');ops=importlib.util.module_from_spec(o);o.loader.exec_module(ops)
class CountryCrosswalk(unittest.TestCase):
 def test_name_state_and_anchor_all_required(self):
  city={'name':'São José','stateCode':'AA','longitude':1,'latitude':1}
  target={'name':'Sao Jose','geom':box(0,0,2,2)}
  self.assertEqual(m.match_city(city,[target],{'AA':box(-1,-1,3,3)}),[target])
  self.assertEqual(m.match_city({**city,'stateCode':'BB'},[target],{'AA':box(-1,-1,3,3)}),[])
  self.assertEqual(m.match_city({**city,'longitude':5},[target],{'AA':box(-1,-1,3,3)}),[])
  self.assertEqual(m.match_city(city,[{**target,'name':'Other'}],{'AA':box(-1,-1,3,3)}),[])
 def test_homonyms_in_other_states_do_not_match(self):
  city={'name':'Springfield','stateCode':'AA','longitude':1,'latitude':1}
  correct={'name':'Springfield','geom':box(0,0,2,2)};other={'name':'Springfield','geom':box(5,5,7,7)}
  self.assertEqual(m.match_city(city,[other,correct],{'AA':box(-1,-1,3,3)}),[correct])
 def test_holes_preserved(self):
  g=m.polygon({'type':'Polygon','coordinates':[[[0,0],[4,0],[4,4],[0,4],[0,0]],[[1,1],[3,1],[3,3],[1,3],[1,1]]]})
  city={'name':'Example','stateCode':'AA','longitude':2,'latitude':2}
  self.assertEqual(m.match_city(city,[{'name':'Example','geom':g}],{'AA':box(-1,-1,5,5)}),[])
 def test_reviewed_state_collision_is_not_silently_overwritten(self):
  self.assertEqual(m.state_code('MX',{'shapeID':'31927357B79016588373767','shapeName':'Distrito Federal','shapeISO':'MX-MEX'}),'CMX')
  self.assertEqual(m.state_code('MX',{'shapeID':'other','shapeName':'Mexico','shapeISO':'MX-MEX'}),'MEX')
 def test_current_numeric_state_registry_can_match_reviewed_historical_iso(self):
  props={'shapeID':'fixture','shapeName':'Alta Verapaz','shapeISO':'GT-AV'}
  registry=[{'countryCode':'GT','stateCode':'16','stateName':'Alta Verapaz '}]
  self.assertEqual(m.state_code('GT',props,registry),'16')
  self.assertEqual(m.state_code('GT',props,registry+[{'countryCode':'GT','stateCode':'99','stateName':'Alta Verapaz'}]),'AV')
 def test_reviewed_local_alias_keeps_the_state_and_point_requirements(self):
  city={'name':'Chahal Guatemala','countryCode':'GT','stateCode':'16','longitude':1,'latitude':1};a={'name':'Chahal','geom':box(0,0,2,2)}
  self.assertEqual(m.match_city(city,[a],{'16':box(-1,-1,3,3)}),[a])
  self.assertEqual(m.match_city({**city,'longitude':8},[a],{'16':box(-1,-1,3,3)}),[])
 def test_spanish_provinces_use_reviewed_names_not_autonomous_communities(self):
  registry=[{'countryCode':'ES','stateCode':'VI','stateName':'Araba'},{'countryCode':'ES','stateCode':'B','stateName':'Barcelona'}]
  self.assertEqual(m.state_code('ES',{'shapeName':'Alava','shapeISO':''},registry),'VI')
  self.assertEqual(m.state_code('ES',{'shapeName':'Barcelona','shapeISO':''},registry),'B')
  self.assertIsNone(m.state_code('ES',{'shapeName':'Cataluña/Catalunya','shapeISO':''},registry))
 def test_italian_crosswalk_uses_provinces_and_requires_unique_identity(self):
  registry=[{'countryCode':'IT','stateCode':'TO','stateName':'Turin'},{'countryCode':'IT','stateCode':'BZ','stateName':'South Tyrol'}]
  props={'shapeName':'Torino','shapeISO':''}
  self.assertEqual(m.state_code('IT',props,registry),'TO')
  self.assertEqual(m.state_code('IT',{'shapeName':'Bolzano','shapeISO':''},registry),'BZ')
  self.assertIsNone(m.state_code('IT',{'shapeName':'Piemonte','shapeISO':''},registry))
  self.assertIsNone(m.state_code('IT',props,registry+[{'countryCode':'IT','stateCode':'99','stateName':'Turin'}]))
class CoverageCheckpoints(unittest.TestCase):
 def row(self,status,count):return {'coverage_status':status,'unique_supported':count,'sources':[{'source':'overture','rows':50,'release':'2026-10-21.0'}],'limitations':['source description']}
 def test_older_country_checkpoint_can_resume_without_an_association_field(self):
  row=ops.external_coverage(self.row('partial',49));self.assertEqual(row['association_status'],'licensed_polygon_archive');self.assertEqual(row['unique_supported'],49);self.assertEqual(row['coverage_status'],'partial')
 def test_pending_city_is_unknown_and_cannot_be_reported_as_zero(self):
  row=ops.external_coverage(self.row('location_pending',None));self.assertNotIn('association_status',row)
  with self.assertRaises(ValueError):ops.external_coverage(self.row('location_pending',0))
 def test_fewer_than_fifty_cannot_mark_target_met(self):
  with self.assertRaises(ValueError):ops.external_coverage(self.row('target_met',49))
  self.assertEqual(ops.external_coverage(self.row('target_met',50))['unique_supported'],50)
if __name__=='__main__':unittest.main()

import importlib.util,unittest
from pathlib import Path
from shapely.geometry import box
s=importlib.util.spec_from_file_location('country',Path(__file__).resolve().parents[1]/'scripts/catalog-country.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
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
if __name__=='__main__':unittest.main()

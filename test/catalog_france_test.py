import importlib.util,unittest,tempfile,json
from types import SimpleNamespace
from pathlib import Path
from shapely.geometry import box
s=importlib.util.spec_from_file_location('france',Path(__file__).resolve().parents[1]/'scripts/catalog-france.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class OfficialFrenchIdentity(unittest.TestCase):
 def test_paris_department_alias_is_explicit_and_does_not_change_other_codes(self):
  self.assertEqual(m.department('75C'),'75');self.assertEqual(m.department('01'),'01')
 def test_other_territory_sources_are_not_attributed_to_ign(self):
  self.assertTrue(m.eligible({'code':'01001','departement':'01'}));self.assertTrue(m.eligible({'code':'2A004','departement':'2A'}))
  self.assertFalse(m.eligible({'code':'98801','departement':'988'}));self.assertFalse(m.eligible({'code':'01001','departement':'02'}))
 def test_exact_official_department_and_anchor_required(self):
  city={'countryCode':'FR','stateCode':'01','name':'Saint-Étienne','latitude':1,'longitude':1};target={'geom':box(0,0,2,2)};lookup={('01','saint etienne'):[target]}
  self.assertEqual(m.match(city,lookup),[target]);self.assertEqual(m.match({**city,'stateCode':'02'},lookup),[]);self.assertEqual(m.match({**city,'longitude':3},lookup),[])
 def test_only_documented_parent_district_overlap_can_count_for_both(self):
  parent={'id':'FR:INSEE:2026:75056','country_code':'FR','kind':'municipality'};child={'id':'FR:INSEE:2026:75101','country_code':'FR','kind':'municipal_district','source_metadata':{'authority':'IGN ADMIN EXPRESS / DINUM 2026','parent_admin_id':parent['id']}}
  self.assertEqual(set(m.country.confirmed_admin_ids([child,parent])),{parent['id'],child['id']})
  self.assertEqual(m.country.confirmed_admin_ids([parent,{**parent,'id':'other'}]),[])
  self.assertEqual(m.country.confirmed_admin_ids([parent,{**child,'source_metadata':{}}]),[])
 def test_wrong_registry_coordinate_can_be_corrected_only_for_unique_official_identity(self):
  city={'countryCode':'FR','stateCode':'04','name':'Mezel','latitude':45.75,'longitude':3.24};target={'geom':box(5,43,7,45)};lookup={('04','mezel'):[target]}
  self.assertEqual(m.resolve(city,lookup,False),([],False));self.assertEqual(m.resolve(city,lookup,True),([target],True))
  self.assertEqual(m.resolve(city,{('04','mezel'):[target,{'geom':box(7,43,8,45)}]},True),([],False))
 def test_public_manifest_discloses_a_registry_coordinate_conflict(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);area={'id':'FR:INSEE:2026:04120','kind':'municipality','source':'IGN','vintage':'2026','license':{'id':'Etalab-2.0'},'bounds':[43,45,5,7],'area_key':'a'*64,'geometry':{'type':'Polygon','coordinates':[[[5,43],[7,43],[7,45],[5,45],[5,43]]]}}
   city={'id':1,'key':'FR:04:1','name':'Mezel','stateCode':'04','stateName':'Alpes-de-Haute-Provence','admin_id':area['id'],'association_status':'official_unique_name_department_registry_coordinate_conflict'}
   (root/'admin-areas.ndjson').write_text(json.dumps(area)+'\n');(root/'mapped-inventory.ndjson').write_text(json.dumps(city)+'\n')
   m.country.geometry(SimpleNamespace(root=str(root),country='FR'));payload=json.loads((root/'geometry-publication.json').read_text())['manifests'][0]['payload']
   self.assertEqual(payload['registryCoordinateConflictCityIds'],[1]);self.assertIn('INSEE',payload['boundaryIdentity']);self.assertNotIn('anchor confirmed',payload['boundaryIdentity'])
if __name__=='__main__':unittest.main()

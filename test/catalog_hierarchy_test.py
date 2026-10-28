import importlib.util,unittest
from pathlib import Path

spec=importlib.util.spec_from_file_location('hierarchy',Path(__file__).resolve().parents[1]/'scripts/catalog-hierarchy.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
SOURCE=[{'dataset':'OpenStreetMap','license':'ODbL-1.0','record_id':'fictional-fixture-only'}]

def node(identity,name,subtype,region='GB-ENG',country='GB',local_type='county'):
 return {'id':identity,'names':{'primary':name},'subtype':subtype,'region':region,'country':country,'local_type':{'en':local_type},'sources':SOURCE}

class PublishedAdministrativeHierarchy(unittest.TestCase):
 def fixture(self):
  roots=[node('uk','United Kingdom','country'),node('eng','England','region'),node('norfolk','Norfolk','county'),node('suffolk','Suffolk','county')]
  state={'countryCode':'GB','stateCode':'NFK','iso':'GB-NFK','name':'Norfolk','type':'two-tier county','id':1};proof,error=m.resolve_state(state,roots);self.assertIsNone(error)
  town={**node('town','Town','locality'),'parent_division_id':'norfolk','hierarchies':[[{'division_id':'uk','subtype':'country'},{'division_id':'eng','subtype':'region'},{'division_id':'norfolk','subtype':'county'},{'division_id':'town','subtype':'locality'}]]}
  area={'country':'GB','region':'GB-ENG','division_id':'town','subtype':'locality'}
  return roots,state,proof,town,area
 def test_county_is_proven_despite_sources_broader_region_code(self):
  roots,state,proof,town,area=self.fixture();result=m.ancestry_proof(area,town,state,proof);self.assertEqual(result['divisionId'],'norfolk');self.assertEqual(result['registryISO'],'GB-NFK');self.assertEqual(result['sourceRegionISO'],'GB-ENG')
 def test_name_match_in_another_state_or_country_never_reassigns_city(self):
  roots,state,proof,town,area=self.fixture();other={**state,'stateCode':'SFK','iso':'GB-SFK','name':'Suffolk'};wrong,error=m.resolve_state(other,roots);self.assertIsNone(m.ancestry_proof(area,town,other,wrong));self.assertIsNone(m.ancestry_proof({**area,'country':'US'},town,state,proof))
 def test_inconsistent_default_parent_or_disputed_hierarchy_is_pending(self):
  roots,state,proof,town,area=self.fixture();self.assertIsNone(m.ancestry_proof(area,{**town,'parent_division_id':'suffolk'},state,proof))
  alternative=[*town['hierarchies'][0]];alternative[2]={'division_id':'suffolk','subtype':'county'}
  self.assertIsNone(m.ancestry_proof(area,{**town,'hierarchies':[town['hierarchies'][0],alternative]},state,proof))
 def test_unknown_country_root_or_changed_city_identity_is_rejected(self):
  roots,state,proof,town,area=self.fixture();foreign=[*town['hierarchies'][0]];foreign[0]={'division_id':'foreign','subtype':'country'};self.assertIsNone(m.ancestry_proof(area,{**town,'hierarchies':[foreign]},state,proof));self.assertIsNone(m.ancestry_proof({**area,'division_id':'another-city'},town,state,proof))
 def test_duplicate_subdivision_names_and_unreviewed_sources_are_not_guessed(self):
  roots,state,proof,town,area=self.fixture();value,error=m.resolve_state(state,[*roots,node('another-norfolk','Norfolk','county')]);self.assertIsNone(value);self.assertEqual(error,'subdivision_not_unique')
  bad=[{**r,'sources':[{'dataset':'unreviewed','license':'unknown'}]} if r['id']=='norfolk' else r for r in roots];value,error=m.resolve_state(state,bad);self.assertIsNone(value);self.assertEqual(error,'subdivision_source_requires_review')
 def test_published_short_name_does_not_accept_historical_or_conditional_alias(self):
  self.assertEqual(m.labels({'names':{'primary':'Current','rules':[{'variant':'alternate','value':'Historical'},{'variant':'short','value':'Conditional','between':[1,2]},{'variant':'short','value':'Short'}]}}),{'current','short'})
 def test_first_level_iso_identity_wins_over_county_homonym(self):
  state={'countryCode':'US','stateCode':'GA','iso':'US-GA','name':'Georgia','type':'state'};r=[node('us','United States','country',country='US'),node('state','Georgia','region','US-GA','US','state'),node('county','Georgia','county','US-VT','US','county')];proof,error=m.resolve_state(state,r);self.assertIsNone(error);self.assertEqual(proof['divisionId'],'state')
 def test_county_formal_city_suffix_keeps_registry_type_constraint(self):
  state={'countryCode':'GB','stateCode':'ABE','iso':'GB-ABE','name':'Aberdeen','type':'council area'};r=[node('uk','United Kingdom','country'),node('aberdeen','Aberdeen City','county','GB-SCT')];proof,error=m.resolve_state(state,r);self.assertIsNone(error);self.assertEqual(proof['divisionId'],'aberdeen');self.assertIsNone(m.resolve_state({**state,'type':'province'},r)[0])
 def test_formal_administrative_descriptors_preserve_distinct_proper_names(self):
  state={'countryCode':'GB','stateCode':'STH','iso':'GB-STH','name':'City of Southampton','type':'unitary authority'};r=[node('uk','United Kingdom','country'),node('southampton','Southampton','county'),node('other','North Southampton','county')];proof,error=m.resolve_state(state,r);self.assertIsNone(error);self.assertEqual(proof['divisionId'],'southampton')
  self.assertIsNone(m.resolve_state({**state,'name':'South'},r)[0])

if __name__=='__main__':unittest.main()

import gzip,importlib.util,json,tempfile,unittest
from pathlib import Path
from shapely.geometry import Polygon
ROOT=Path(__file__).resolve().parents[1]
def load(name,file):
 s=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
b=load('de_boundaries_test','catalog-germany-boundaries.py');s=load('de_scan_test','catalog-germany-scan.py');r=load('de_reconcile_test','catalog-germany-reconcile.py')
def candidate(name='Bernau',ags='12060020',level='8',uri='https://www.openstreetmap.org/relation/1',**extra):
 return {k:{'value':v} for k,v in dict(name=name,ags=ags,level=level,poi=uri,**extra).items()}
class Germany(unittest.TestCase):
 def test_real_cochem_scope_excludes_business_in_neighbouring_municipality(self):
  from shapely.geometry import shape,Point
  f=json.loads(gzip.decompress((ROOT/'test/fixtures/de-cochem-scope.json.gz').read_bytes()))
  point=Point(f['business']['longitude'],f['business']['latitude']);old=shape(f['legacyGeometry']);municipality=shape(f['municipalGeometry'])
  self.assertEqual(f['municipal_AGS'],'07135020');self.assertTrue(old.covers(point));self.assertFalse(municipality.covers(point));self.assertTrue(municipality.covers(Point(*f['cityAnchor'])))
  self.assertGreater(old.area/municipality.area,10)
 def test_whole_country_and_constant_predicates(self):
  q=s.candidate_query('shop',['bakery']);self.assertIn('relation/51477',q);self.assertIn('Key:shop',q);self.assertNotIn('city',q)
  detail=s.details_query(['https://www.openstreetmap.org/node/1']);self.assertEqual(detail.count('VALUES ?poi'),2)
  with self.assertRaises(ValueError):s.details_query(['https://other.example/node/1'])
 def test_no_district_or_state_as_municipality(self):
  self.assertIsNone(b.municipal(candidate(ags='12060',level='6')))
  self.assertIsNone(b.municipal(candidate(ags='12060020',level='6')))
  self.assertIsNone(b.municipal(candidate(name='Bremen',ags='04011000',level='4')))
  self.assertEqual(b.municipal(candidate(name='Berlin',ags='11000000',level='4')),('BE','11000000'))
 def test_exact_alias_and_state_and_ambiguity(self):
  city={'name':'Bernau bei Berlin','state_code':'BB','country_code':'DE','unique_supported':None}
  source=candidate(official='Bernau bei Berlin')
  self.assertEqual(len(b.match_plan([city],[source])),1)
  self.assertEqual(b.match_plan([{**city,'state_code':'BY'}],[source]),[])
  self.assertEqual(b.match_plan([city],[candidate()]),[])
  self.assertEqual(b.match_plan([city],[source,{**source,'poi':{'value':'https://www.openstreetmap.org/relation/2'}}]),[])
 def test_location_is_not_bbox_center_and_rejects_ambiguity(self):
  x,y,method=r.location({'geometries':['POLYGON((10 50,12 50,12 51,11 51,11 52,10 52,10 50))']})
  self.assertTrue(Polygon([(10,50),(12,50),(12,51),(11,51),(11,52),(10,52)]).covers(__import__('shapely').Point(x,y)))
  self.assertEqual(method,'source_geometry_point_on_surface')
  with self.assertRaises(ValueError):r.location({'geometries':['POINT(10 50)','POINT(11 50)']})
 def test_osm_family_identity_matches_existing_transports(self):
  self.assertEqual(r.w.identity('qlever','node/12','DE'),r.w.identity('geofabrik','node:12','DE'))
  self.assertNotEqual(r.w.identity('qlever','node/12','DE'),r.w.identity('qlever','way/12','DE'))
if __name__=='__main__':unittest.main()

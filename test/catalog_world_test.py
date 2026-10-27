import importlib.util,tempfile,unittest,json,hashlib
from pathlib import Path
from unittest.mock import patch
from shapely.geometry import Polygon,MultiPolygon,box

def module(name,file):
 spec=importlib.util.spec_from_file_location(name,Path(__file__).resolve().parents[1]/'scripts'/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
world=module('world','catalog-world-boundaries.py');remote=module('division_reader','catalog-division-read.py');ops=module('queue_budgets','catalog-ops.py')
planner=module('source_planner','catalog-source-plan.py')
class RegionalSourcePlan(unittest.TestCase):
 def test_all_longitude_partitions_are_required_not_only_capital_tile(self):
  country=box(2.5,50.7,6.8,53.6)
  tiles=[{'id':'west','bbox':[0,40,4.383,60]},{'id':'east','bbox':[4.383,40,15,60]},{'id':'outside','bbox':[16,40,25,60]}]
  self.assertEqual([r['id'] for r in planner.required_parts(country,tiles)],['west','east'])
 def test_disconnected_territories_use_actual_polygon_not_envelope(self):
  country=MultiPolygon([box(-65,17,-64,18),box(3,51,7,54)])
  tiles=[{'id':'island','bbox':[-66,16,-63,19]},{'id':'mainland','bbox':[0,50,10,55]},{'id':'empty_between','bbox':[-40,30,-30,40]}]
  self.assertEqual([r['id'] for r in planner.required_parts(country,tiles)],['island','mainland'])
class WorldIdentity(unittest.TestCase):
 def test_source_common_names_keep_country_subdivision_and_polygon_constraints(self):
  city={'countryCode':'DE','stateCode':'BY','name':'Munich','latitude':1,'longitude':1};area={'geom':box(0,0,2,2)}
  lookup={('DE-BY',name):[area] for name in world.names({'primary':'München','common':{'en':'Munich'}})}
  self.assertEqual(world.candidates(city,lookup),[area])
  self.assertEqual(world.candidates({**city,'countryCode':'US'},lookup),[])
  self.assertEqual(world.candidates({**city,'stateCode':'BW'},lookup),[])
  self.assertEqual(world.candidates({**city,'longitude':3},lookup),[])
 def test_holes_and_ambiguous_names_never_pick_a_neighbour(self):
  city={'countryCode':'DE','stateCode':'BY','name':'Example','latitude':2,'longitude':2};hole=Polygon([(0,0),(4,0),(4,4),(0,4)],holes=[[(1,1),(3,1),(3,3),(1,3)]])
  self.assertEqual(world.candidates(city,{('DE-BY','example'):[{'geom':hole}]}),[])
  areas=[{'geom':box(0,0,3,3)},{'geom':box(1,1,4,4)}]
  self.assertEqual(len(world.candidates(city,{('DE-BY','example'):areas})),2)
 def test_queue_materialization_preserves_the_storage_guard(self):
  self.assertEqual(ops.queue_slots(200*1024*1024,49000),250)
  self.assertEqual(ops.queue_slots(200*1024*1024,49999),1)
  self.assertEqual(ops.queue_slots(200*1024*1024,50000),0)
  self.assertEqual(ops.queue_slots(220*1024*1024,100),0)
  self.assertEqual(ops.queue_slots(220*1024*1024-8192,100),2)
class Transport(unittest.TestCase):
 def test_validated_ranges_support_offline_subranges_and_reject_corruption(self):
  with tempfile.TemporaryDirectory() as root:
   asset={'url':'https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/release/2026-10-21.0/theme=divisions/type=division_area/part-00002-abcd.zstd.parquet','size':100}
   p=Path(root)/'0-9';p.write_bytes(b'0123456789');p.with_suffix('.json').write_text(json.dumps({'url':asset['url'],'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}))
   with patch.object(remote.requests,'get',side_effect=AssertionError('network reached')):
    source=remote.RangeSource(asset,root,offline=True);self.assertEqual(source.request(2,5),b'2345');self.assertEqual(source.metrics()['requests'],0)
    with self.assertRaisesRegex(RuntimeError,'offline_cache_miss'):source.request(9,11)
    p.write_bytes(b'corrupted!')
    with self.assertRaisesRegex(RuntimeError,'offline_cache_miss'):remote.RangeSource(asset,root,offline=True).request(0,1)
 def test_unapproved_sources_and_oversized_ranges_never_reach_network(self):
  with tempfile.TemporaryDirectory() as root:
   with self.assertRaises(ValueError):remote.RangeSource({'url':'https://example.com/foreign.parquet','size':20},root)
   asset={'url':'https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/release/2026-10-21.0/theme=divisions/type=division_area/part-00002-abcd.zstd.parquet','size':100}
   source=remote.RangeSource(asset,root,maximum=10)
   with patch.object(remote.requests,'get',side_effect=AssertionError('network reached')):
    with self.assertRaises(RuntimeError):source.request(0,19)
    with self.assertRaises(RuntimeError):source.request(-1,2)
 def test_range_validation_precedes_body_and_never_retries_503(self):
  with tempfile.TemporaryDirectory() as root:
   asset={'url':'https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/release/2026-10-21.0/theme=divisions/type=division_area/part-00002-abcd.zstd.parquet','size':100}
   class Response:
    status_code=503;headers={}
    def __enter__(self):return self
    def __exit__(self,*args):pass
    def iter_content(self,*args):raise AssertionError('body consumed')
   with patch.object(remote.requests,'get',return_value=Response()) as request:
    with self.assertRaisesRegex(RuntimeError,'division_http_503'):remote.RangeSource(asset,root).request(0,1)
    self.assertEqual(request.call_count,1)
class ImmutableCountryAsset(unittest.TestCase):
 def test_geography_recount_preserves_original_bytes_and_all_record_fields(self):
  import duckdb
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);original=root/'original.parquet';temporary=root/'recount.parquet';db=duckdb.connect()
   db.execute("COPY (SELECT 'a' AS source_id,'Town Cafe' AS name,'12345678' AS phone UNION ALL SELECT 'b','Bakery','98765432') TO ? (FORMAT PARQUET)",[str(original)])
   before=original.read_bytes();(root/'published-asset.json').write_text(json.dumps({'bytes':len(before),'sha256':hashlib.sha256(before).hexdigest()}))
   target="'"+str(temporary).replace("'","''")+"'"
   db.execute('COPY (SELECT * FROM read_parquet(?) ORDER BY source_id DESC) TO '+target+' (FORMAT PARQUET)',[str(original)])
   self.assertTrue(world.country.freeze_output(db,root,temporary,original));self.assertEqual(original.read_bytes(),before);self.assertFalse(temporary.exists())
   db.execute("COPY (SELECT * REPLACE('changed phone' AS phone) FROM read_parquet(?)) TO "+target+" (FORMAT PARQUET)",[str(original)])
   with self.assertRaisesRegex(RuntimeError,'separate_asset'):world.country.freeze_output(db,root,temporary,original)
   self.assertEqual(original.read_bytes(),before);db.close()
if __name__=='__main__':unittest.main()

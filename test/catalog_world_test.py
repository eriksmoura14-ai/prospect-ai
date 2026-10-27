import importlib.util,tempfile,unittest,json,hashlib
from pathlib import Path
from unittest.mock import patch
from shapely.geometry import Polygon,MultiPolygon,box,mapping

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
 def test_slovenian_published_settlement_variants_do_not_relax_other_country_or_state_filters(self):
  value={'primary':'Sečovlje / Siccole (naselje)'};aliases=world.names(value,'SI');self.assertIn('secovlje',aliases);self.assertIn('siccole',aliases);self.assertNotIn('secovlje',world.names(value,'SK'))
  city={'countryCode':'SI','stateCode':'090','name':'Sečovlje','longitude':1,'latitude':1};a={'geom':box(0,0,2,2),'kind':'locality'};lookup={('SI-090',name):[a] for name in aliases};self.assertEqual(world.candidates(city,lookup),[a]);self.assertEqual(world.candidates({**city,'stateCode':'001'},lookup),[])
 def test_explicit_registry_district_is_not_a_fallback_for_an_ordinary_town(self):
  city={'countryCode':'SK','stateCode':'BL','name':'Okres Malacky','latitude':1,'longitude':1};county={'id':'county','kind':'county','geom':box(0,0,2,2)};town={'id':'town','kind':'locality','geom':box(0,0,2,2)}
  self.assertEqual(world.candidates(city,{('SK-BL','okres malacky'):[county,town]}),[county])
  self.assertEqual(world.candidates({**city,'name':'Malacky'},{('SK-BL','malacky'):[county,town]}),[town])
  self.assertEqual(world.candidates(city,{('SK-BL','malacky'):[county,town]}),[county])
  self.assertEqual(world.candidates(city,{('SK-BL','malacky'):[county],('SK-BL','okres malacky'):[county]}),[county])
  self.assertFalse(world.scope_matches({**city,'countryCode':'US'},county))
 def test_reviewed_district_and_contained_city_keep_both_requested_scopes(self):
  child={'id':'town','kind':'locality','country_code':'SK','state_code':'BL','name':'Malacky','geometry':mapping(box(1,1,2,2))};parent={'id':'district','kind':'county','country_code':'SK','state_code':'BL','name':'okres Malacky','geometry':mapping(box(0,0,3,3)),'source_metadata':{'scope_policy':'explicit_registry_okres_district'}}
  self.assertEqual(set(world.country.confirmed_admin_ids([child,parent])),{'town','district'})
  cached={a['id']:world.country.polygon(a['geometry']) for a in [child,parent]};self.assertEqual(set(world.country.confirmed_admin_ids([child,parent],cached)),{'town','district'})
  self.assertEqual(world.country.confirmed_admin_ids([child,{**parent,'source_metadata':{}}]),[])
  self.assertEqual(world.country.confirmed_admin_ids([child,{**parent,'state_code':'BC'}]),[])
  self.assertEqual(world.country.confirmed_admin_ids([child,{**parent,'geometry':mapping(box(1.5,1.5,3,3))}]),[])
  self.assertEqual(set(world.country.confirmed_admin_ids([{**child,'geometry':mapping(box(-1,-1,4,4))},parent])),{'town','district'})
 def test_danish_municipality_is_available_only_for_the_explicit_kommune_option(self):
  city={'countryCode':'DK','stateCode':'82','name':'Aarhus Kommune','latitude':1,'longitude':1};area={'id':'municipality','kind':'county','geom':box(0,0,2,2)}
  self.assertEqual(world.candidates(city,{('DK-82','aarhus kommune'):[area]}),[area])
  self.assertEqual(world.candidates({**city,'name':'Aarhus'},{('DK-82','aarhus'):[area]}),[])
  self.assertEqual(world.candidates({**city,'countryCode':'SE'},{('SE-82','aarhus kommune'):[area]}),[])
 def test_danish_dual_membership_needs_reviewed_label_level_state_and_containment(self):
  town={'id':'town','kind':'locality','country_code':'DK','state_code':'82','name':'Aarhus','geometry':mapping(box(1,1,2,2))};municipality={'id':'municipality','kind':'county','country_code':'DK','state_code':'82','name':'Aarhus Kommune','geometry':mapping(box(0,0,3,3)),'source_metadata':{'scope_policy':'explicit_registry_danish_municipality','admin_level':2,'verified_municipality_labels':['aarhus kommune']}}
  self.assertEqual(set(world.country.confirmed_admin_ids([town,municipality])),{'town','municipality'})
  for changed in ({'state_code':'83'},{'source_metadata':{}},{'geometry':mapping(box(1.5,1.5,3,3))}):self.assertEqual(world.country.confirmed_admin_ids([town,{**municipality,**changed}]),[])
 def test_confirmed_scope_is_preserved_when_new_sources_add_an_ambiguous_name(self):
  previous={'admin_id':'original'};area={'id':'original','country_code':'CZ','state_code':'20','geom':box(0,0,2,2)};old={'original':{**{k:v for k,v in area.items() if k!='geom'},'geometry':mapping(area['geom'])}}
  other={**area,'id':'another','geom':box(0,0,3,3)}
  self.assertIs(world.preserve_mapping(previous,old,[other,area]),area)
  self.assertIsNone(world.preserve_mapping({},old,[other,area]))
  with self.assertRaisesRegex(ValueError,'not_reproduced'):world.preserve_mapping(previous,old,[other])
  with self.assertRaisesRegex(ValueError,'identity_changed'):world.preserve_mapping(previous,old,[{**area,'geom':box(0,0,4,4)}])
 def test_unique_populated_place_inside_homonymous_localadmin_keeps_the_narrower_scope(self):
  city={'countryCode':'AR','stateCode':'K','name':'Example'};locality={'id':'place','kind':'locality','geom':box(1,1,2,2)};admin={'id':'municipality','kind':'localadmin','geom':box(0,0,3,3)}
  self.assertIs(world.contained_named_locality(city,[admin,locality]),locality)
  self.assertIsNone(world.contained_named_locality(city,[admin,locality,{**locality,'id':'another-place'}]))
  self.assertIsNone(world.contained_named_locality(city,[{**admin,'geom':box(1.5,1.5,3,3)},locality]))
  self.assertIsNone(world.contained_named_locality(city,[{**admin,'kind':'county'},locality]))
  self.assertIsNone(world.contained_named_locality({'countryCode':'DK','name':'Example Kommune'},[admin,locality]))
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
class GeographicWriteBatching(unittest.TestCase):
 def manifest(self,state):
  return {'id':'geometry-v1:GB:'+state,'payload':{'version':1,'countryCode':'GB','stateCode':state,'parts':[{'url':'https://br-frosty-voice-b55arvzl.storage.c-7.us-east-2.aws.neon.tech/prospect-public-catalog/geography/fixture.json','sha256':'a'*64,'bytes':123}]}}
 def test_many_subdivisions_keep_their_identity_and_use_bounded_batches(self):
  items=[self.manifest(str(i)) for i in range(106)];batches=ops.geometry_manifest_batches(items)
  self.assertEqual([len(v) for v in batches],[50,50,6]);self.assertEqual([v['id'] for b in batches for v in b],[v['id'] for v in items])
  self.assertTrue(all(row['payload']==item['payload'] for row,item in zip([r for b in batches for r in b],items)))
 def test_duplicate_or_unapproved_last_manifest_rejects_the_whole_request(self):
  first=self.manifest('A');last=self.manifest('B');last['payload']['parts'][0]['url']='https://unapproved.example/geography.json'
  with self.assertRaisesRegex(ValueError,'manifest_part'):ops.geometry_manifest_batches([first,last])
  with self.assertRaisesRegex(ValueError,'manifest_identity'):ops.geometry_manifest_batches([first,first])
 def test_individual_manifest_cannot_exceed_the_request_byte_budget(self):
  item=self.manifest('A');item['payload']['untrustedNotes']='x'*(3*1024*1024)
  with self.assertRaisesRegex(ValueError,'batch_budget'):ops.geometry_manifest_batches([item])
class Transport(unittest.TestCase):
 def test_country_windows_preserve_physical_offsets_without_borrowing_neighbouring_rows(self):
  index={'complete':True,'release':remote.RELEASE,'rowGroups':[{'firstRow':0,'lastRow':9,'selectedCompressedBytes':123,'countries':{'BR':{'locality':3}}},{'firstRow':10,'lastRow':29,'selectedCompressedBytes':456,'countries':{'AR':{'locality':2,'county':5}}},{'firstRow':30,'lastRow':39,'selectedCompressedBytes':789,'countries':{'AR':{'region':1}}}]}
  self.assertEqual(remote.country_row_windows(index,'AR'),[{'firstRow':10,'lastRow':29,'rows':2,'selectedCompressedBytes':456}])
  self.assertEqual(remote.country_row_windows(index,'AR',('locality','county'))[0]['rows'],7)
  self.assertEqual(remote.country_row_windows(index,'UY'),[])
  with self.assertRaises(ValueError):remote.country_row_windows({**index,'complete':False},'AR')
 def test_hierarchy_layer_requires_explicit_opt_in_and_remains_on_reviewed_public_source(self):
  with tempfile.TemporaryDirectory() as root:
   asset={'url':'https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/release/2026-10-21.0/theme=divisions/type=division/part-00000-abcd.zstd.parquet','size':100}
   with self.assertRaises(ValueError):remote.RangeSource(asset,root)
   self.assertEqual(remote.RangeSource(asset,root,layer='division').size,100)
   with self.assertRaises(ValueError):remote.RangeSource(asset,root,layer='unreviewed_table')
 def test_cached_country_column_is_insufficient_without_geometry_and_provenance(self):
  rows=[{'row_group_id':0,'row_group_num_rows':10,'path_in_schema':c,'data_page_offset':i*10+1,'dictionary_page_offset':None,'total_compressed_size':2} for i,c in enumerate(sorted(remote.SELECTED_COLUMNS))]
  class Cached:
   def cache(self,first,last):return b'xx'
  self.assertEqual(remote.cached_windows(rows,Cached()),[{'firstRow':0,'lastRow':9,'groups':[0]}])
  country_only=[r for r in rows if r['path_in_schema']=='country']
  self.assertEqual(remote.cached_windows(country_only,Cached()),[])
  missing=next(r['data_page_offset'] for r in rows if r['path_in_schema']=='geometry')
  class Partial:
   def cache(self,first,last):return None if first==missing else b'xx'
  self.assertEqual(remote.cached_windows(rows,Partial()),[])
 def test_cached_windows_keep_real_row_offsets_across_uncached_groups(self):
  rows=[{'row_group_id':g,'row_group_num_rows':10+g,'path_in_schema':c,'data_page_offset':g*1000+i*10+1,'dictionary_page_offset':None,'total_compressed_size':2} for g in range(4) for i,c in enumerate(sorted(remote.SELECTED_COLUMNS))]
  class Partial:
   def cache(self,first,last):return None if 1000<=first<2000 else b'xx'
  self.assertEqual(remote.cached_windows(rows,Partial()),[{'firstRow':0,'lastRow':9,'groups':[0]},{'firstRow':21,'lastRow':45,'groups':[2,3]}])
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

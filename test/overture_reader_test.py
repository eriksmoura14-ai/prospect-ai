"""Real DuckDB/Parquet/range reads, fictional records, mocked outbound HTTP."""
import importlib.util,json,os,re,struct,tempfile,unittest,shutil,platform
from pathlib import Path
from unittest.mock import patch
import duckdb
spec=importlib.util.spec_from_file_location("regional_reader",Path(__file__).resolve().parents[1]/"scripts/overture-region.py")
reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)

class ReaderTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.env=patch.dict(os.environ,{"OVERTURE_CACHE_DIR":str(self.root)});self.env.start()
        self.requests=[]
    def tearDown(self):self.env.stop();self.temp.cleanup()
    def prepare(self,status="open",confidence=.9):
        con=duckdb.connect();file=self.root/"fixture.parquet"
        geometry=struct.pack("<BIdd",1,1,1.123,1.456).hex()
        con.execute("""CREATE TABLE places AS SELECT 'fictional-id' AS id, {'primary':'Fictional Cafe'} AS names,
          {'xmin':1.123,'ymin':1.456,'xmax':1.123,'ymax':1.456} AS bbox,
          {'primary':'restaurant','hierarchy':['food_and_drink','restaurant'],'alternates':[]::VARCHAR[]} AS taxonomy,
          'restaurant' AS basic_category, ['+12125550100'] AS phones,['https://fixture.example/'] AS websites,
          [{'freeform':'Main 1','country':'US','locality':'Fixture'}] AS addresses,
          ?::DOUBLE AS confidence,[{'dataset':'meta','record_id':'fixture'}] AS sources,? AS operating_status,
          from_hex(?) AS geometry,'unrelated-private-field' AS unrelated""",[confidence,status,geometry])
        con.execute("COPY places TO '"+str(file).replace("'","''")+"' (FORMAT PARQUET)");con.close()
        self.data=file.read_bytes()
        self.url=f"https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/release/{reader.RELEASE}/theme=places/type=place/part-fixture.parquet"
        (self.root/f"{reader.RELEASE}-places-stac.json").write_text(json.dumps([{'bbox':[0,0,2,2],'assets':{'aws':{'href':self.url,'file:size':len(self.data)}}}]))
    def response(self,url,headers=None,**kwargs):
        self.assertEqual(url,self.url);self.requests.append(headers['Range'])
        start,end=map(int,re.fullmatch(r'bytes=(\d+)-(\d+)',headers['Range']).groups())
        data=self.data[start:end+1]
        class Response:
            status_code=206
            headers={'Content-Length':str(len(data)),'Content-Range':f'bytes {start}-{end}/{len(self.data)}'}
            def iter_content(self,size):yield data
            def close(self):pass
        return Response()
    def run_extract(self,**options):
        with patch.object(reader.requests,'get',side_effect=self.response):return reader.extract({'bounds':[0,2,0,2],'categories':['restaurant'],'maxBytes':1024*1024,'maxRows':10,**options})
    def test_real_parquet_range_filter_preserves_exact_point_and_public_columns(self):
        self.prepare();result=self.run_extract()
        self.assertEqual(len(result['rows']),1);self.assertEqual(result['rows'][0]['geometry']['coordinates'],[1.123,1.456])
        self.assertNotIn('unrelated',result['rows'][0]);self.assertGreater(result['metrics']['bytes'],0)
        self.assertLessEqual(result['metrics']['bytes'],1024*1024);self.assertTrue(self.requests)
    def test_city_polygon_is_applied_before_the_row_limit(self):
        self.prepare()
        file=self.root/'fixture.parquet';con=duckdb.connect()
        con.execute('CREATE TABLE places AS SELECT * FROM read_parquet(?)',[str(file)])
        geometry=struct.pack('<BIdd',1,1,.2,1.5).hex()
        con.execute("""INSERT INTO places BY NAME SELECT * REPLACE('inside-city' AS id,
          {'xmin':.2,'ymin':1.5,'xmax':.2,'ymax':1.5} AS bbox,from_hex(?) AS geometry) FROM places""",[geometry])
        con.execute("COPY places TO '"+str(file).replace("'","''")+"' (FORMAT PARQUET)");con.close()
        self.data=file.read_bytes()
        cache=self.root/f'{reader.RELEASE}-places-stac.json';items=json.loads(cache.read_text())
        items[0]['assets']['aws']['file:size']=len(self.data);cache.write_text(json.dumps(items))
        # Both records are in the envelope; the first is in the excluded corner
        # of this L-shaped municipality. A bbox-only LIMIT 1 loses the city.
        geometry={'type':'Polygon','coordinates':[[[0,0],[2,0],[2,.5],[.5,.5],[.5,2],[0,2],[0,0]]]}
        before=self.run_extract(maxRows=1)
        after=self.run_extract(maxRows=1,geometry=geometry)
        self.assertEqual(before['rows'][0]['id'],'fictional-id')
        self.assertTrue(before['truncated'])
        self.assertEqual([r['id'] for r in after['rows']],['inside-city'])
        self.assertFalse(after['truncated'])
    def test_polygon_holes_islands_and_boundaries(self):
        geometry={'type':'MultiPolygon','coordinates':[
          [[[0,0],[1,0],[1,1],[0,1],[0,0]],[[.2,.2],[.4,.2],[.4,.4],[.2,.4],[.2,.2]]],
          [[[1.5,1.5],[2,1.5],[2,2],[1.5,2],[1.5,1.5]]]]}
        covers=reader.polygon_filter(geometry,[0,2,0,2])
        point=lambda x,y:struct.pack('<BIdd',1,1,x,y)
        self.assertFalse(covers(point(.3,.3)))
        self.assertTrue(covers(point(.2,.3)))
        self.assertTrue(covers(point(0,.5)))
        self.assertTrue(covers(point(1.8,1.8)))
        self.assertFalse(covers(point(1.2,1.2)))
    def test_invalid_polygon_never_requests_source(self):
        with patch.object(reader.requests,'get') as request:
            for geometry in ({'type':'Point','coordinates':[1,1]},
              {'type':'Polygon','coordinates':[[[0,0],[1,0],[1,1],[0,1]]]},
              {'type':'Polygon','coordinates':[[[0,0],[3,0],[3,1],[0,0]]]}):
                with self.assertRaises(ValueError):reader.extract({'bounds':[0,2,0,2],'categories':['restaurant'],'geometry':geometry})
            request.assert_not_called()
    def test_closed_and_low_confidence_records_are_filtered(self):
        self.prepare(status='permanently_closed');self.assertEqual(self.run_extract()['rows'],[])
    def test_extension_survives_a_different_runtime_home(self):
        self.prepare()
        system='linux_'+{'x86_64':'amd64','aarch64':'arm64'}[platform.machine()]
        directory=Path('v1.4.4')/system
        extension=Path.home()/'.duckdb/extensions'/directory/'httpfs.duckdb_extension'
        target=self.root/'build-artifact-extensions'/directory/'httpfs.duckdb_extension'
        target.parent.mkdir(parents=True);shutil.copyfile(extension,target)
        runtime_home=self.root/'different-runtime-home';runtime_home.mkdir()
        with patch.dict(os.environ,{'HOME':str(runtime_home),'DUCKDB_EXTENSION_DIRECTORY':str(self.root/'build-artifact-extensions')}):
            self.assertEqual(len(self.run_extract()['rows']),1)
    def test_budget_refuses_remote_body_before_exceeding_limit(self):
        self.prepare()
        with self.assertRaises(Exception):self.run_extract(maxBytes=1)
        self.assertEqual(self.requests,[])
    def test_invalid_world_bounds_and_unapproved_category_make_no_request(self):
        with patch.object(reader.requests,'get') as request:
            with self.assertRaises(ValueError):reader.extract({'bounds':[-90,90,-180,180],'categories':['restaurant']})
            with self.assertRaises(ValueError):reader.extract({'bounds':[0,2,0,2],'categories':["restaurant'); DROP TABLE places;"]})
            request.assert_not_called()
    def test_catalog_cannot_redirect_reader_to_private_networks(self):
        self.prepare()
        path=self.root/f"{reader.RELEASE}-places-stac.json"
        data=json.loads(path.read_text());data[0]['assets']['aws']['href']='http://169.254.169.254/latest/meta-data'
        path.write_text(json.dumps(data))
        with patch.object(reader.requests,'get') as request:
            with self.assertRaises(reader.BudgetError):reader.extract({'bounds':[0,2,0,2],'categories':['restaurant']})
            request.assert_not_called()

if __name__=='__main__':unittest.main()

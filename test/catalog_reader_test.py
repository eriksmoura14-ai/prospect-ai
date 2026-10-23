import importlib.util,tempfile,unittest
from pathlib import Path
import duckdb
spec=importlib.util.spec_from_file_location('reader',Path(__file__).resolve().parents[1]/'scripts/catalog-read.py');reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)
class PolygonPagination(unittest.TestCase):
 def test_holes_and_limits_before_pagination(self):
  with tempfile.TemporaryDirectory() as tmp:
   file=str(Path(tmp)/'fixture.parquet');c=duckdb.connect()
   c.execute("CREATE TABLE data(source_id VARCHAR,country_code VARCHAR,longitude DOUBLE,latitude DOUBLE,primary_category VARCHAR,category_hierarchy VARCHAR[],alternate_categories VARCHAR[],basic_category VARCHAR,discovered_at VARCHAR)")
   # First sorted records are inside a hole, outside the polygon, wrong-country,
   # or wrong-segment. They must not consume the page size or hide later POIs.
   c.executemany('INSERT INTO data VALUES(?,?,?,?,?,?,?,?,?)',[(i,cc,x,y,cat,[cat],[],cat,'2026-10-01') for i,cc,x,y,cat in [('01','US',1,1,'bakery'),('02','US',1.8,1.8,'bakery'),('03','CA',.1,.1,'bakery'),('04','US',.1,.1,'restaurant'),('05','US',.1,.1,'bakery'),('06','US',.2,.2,'bakery'),('07','US',.3,.3,'bakery')]])
   c.execute("COPY data TO '"+file+"' (FORMAT PARQUET)");c.close()
   geom={'type':'Polygon','coordinates':[[[0,0],[2,0],[2,.5],[.5,.5],[.5,2],[0,2],[0,0]],[[.05,.8],[.2,.8],[.2,1.2],[.05,1.2],[.05,.8]]]}
   s={'limit':2,'countryCode':'US','geometry':geom,'bounds':[0,2,0,2],'categories':['bakery']}
   first=reader.query(s,[file]);self.assertEqual([r['source_id'] for r in first['rows']],['05','06']);self.assertTrue(first['truncated'])
   second=reader.query({**s,'after':first['next']},[file]);self.assertEqual([r['source_id'] for r in second['rows']],['07']);self.assertFalse(second['truncated'])
 def test_download_refuses_unapproved_origin(self):
  with tempfile.TemporaryDirectory() as tmp:
   with self.assertRaises(ValueError):reader.cached({'url':'http://127.0.0.1/','sha256':'a'*64,'bytes':1},Path(tmp),None)
if __name__=='__main__':unittest.main()

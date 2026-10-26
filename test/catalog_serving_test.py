import importlib.util,unittest,tempfile
from pathlib import Path
import numpy as np
s=importlib.util.spec_from_file_location('serving',Path(__file__).resolve().parents[1]/'scripts/catalog-serving.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
p=importlib.util.spec_from_file_location('publish',Path(__file__).resolve().parents[1]/'scripts/catalog-serving-publish.py');publisher=importlib.util.module_from_spec(p);p.loader.exec_module(publisher)
class ServingPartitions(unittest.TestCase):
 def test_publication_accepts_postgres_bigint_strings_and_rejects_record_loss(self):
  old=[{'id':'source-a','sha256':'a'*64,'records':'100'}];new=[{'id':'serving-b','sha256':'b'*64,'records':100}]
  manifest={'assets':new,'oldAssets':['source-a'],'records':100}
  self.assertEqual([r['records'] for r in publisher.record_budget(manifest,old)],[100,100])
  with self.assertRaisesRegex(ValueError,'record_identity'):publisher.record_budget({**manifest,'assets':[{**new[0],'records':99}]},old)
  with self.assertRaisesRegex(ValueError,'record_identity'):publisher.record_budget({**manifest,'assets':[{**new[0],'id':'source-a'}]},old)
 def test_every_record_stays_in_exactly_one_interval(self):
  points=np.array([[i,i/2] for i in range(32)],dtype=float);codes=np.arange(32)
  leaves,metrics=m.plan(points,codes,[],target=3)
  self.assertEqual([i for p in leaves for i in range(p['start'],p['end'])],list(range(32)))
  self.assertGreater(metrics['files'],1)
 def test_large_known_city_keeps_existing_eight_file_budget(self):
  points=np.array([[i,i/2] for i in range(32)],dtype=float)
  leaves,metrics=m.plan(points,np.arange(32),[[-1,-1,40,40]],target=1,maximum=8)
  self.assertEqual(metrics['maximumFilesPerKnownArea'],8);self.assertEqual(len(leaves),8);self.assertEqual(sum(p['end']-p['start'] for p in leaves),32)
 def test_duplicate_coordinate_codes_do_not_loop_or_drop_records(self):
  leaves,_=m.plan(np.array([[1.,1.]]*40),np.zeros(40),[[0,0,2,2]],target=1)
  self.assertEqual(len(leaves),1);self.assertEqual(leaves[0]['end'],40)
 def test_bbox_overlap_includes_boundary_points(self):
  np.testing.assert_array_equal(m.hits(np.array([[0,0,1,1],[2,2,3,3]]),[1,1,2,2]),[1,1])
 def test_all_record_fields_checked_independently_of_file_order(self):
  with tempfile.TemporaryDirectory() as folder:
   db=m.duckdb.connect();original=str(Path(folder)/'original.parquet');new=str(Path(folder)/'new.parquet')
   db.execute("COPY (SELECT 'fixture-'||range::VARCHAR AS source_id, 'original public label' AS name FROM range(20)) TO ? (FORMAT PARQUET)",[original])
   db.execute("COPY (SELECT * FROM read_parquet(?) ORDER BY source_id DESC) TO '"+new.replace("'","''")+"' (FORMAT PARQUET)",[original])
   self.assertTrue(m.verify(db,[{'file':original}],[{'file':new}])['allFieldsRetained'])
   db.execute("COPY (SELECT source_id,'changed field' AS name FROM read_parquet(?)) TO '"+new.replace("'","''")+"' (FORMAT PARQUET)",[original])
   with self.assertRaisesRegex(RuntimeError,'field_integrity'):m.verify(db,[{'file':original}],[{'file':new}])
   db.close()
if __name__=='__main__':unittest.main()

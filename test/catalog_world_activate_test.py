import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('world_activate',Path(__file__).parents[1]/'scripts/catalog-world-activate.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class AtomicActivation(unittest.TestCase):
    def geography_plan(self,root,n=2):
        items=[{'id':'geometry-v1:BR:'+str(i),'payload':{'parts':[{'url':'new-'+str(i)}]},'previousPayloadSha256':None} for i in range(n)]
        (root/'geometry-publication.json').write_text(json.dumps({'uploads':[{'key':'verified','sha256':'a'*64}],'manifests':items}))
        (root/'published-geography.json').write_text(json.dumps({'verified':'a'*64}))
        return items

    def geometry_database(self):
        class DB:
            def __init__(self):self.rows={};self.reads=0;self.writes=0;self.conflict=False
            def room(self):return 100
            def sql(self,query,params):
                if query.startswith('SELECT id,payload'):
                    self.reads+=1
                    return [self.rows[k] for k in params[0] if k in self.rows]
                if query.startswith('WITH proposed'):
                    self.writes+=1;result=[]
                    for item in json.loads(params[0]):
                        if self.conflict:
                            self.conflict=False;continue
                        self.rows[item['id']]={k:item[k] for k in ('id','payload','sha256')};result.append({'id':item['id']})
                    return result
                raise AssertionError(query)
        return DB()

    def test_geometry_batches_preserve_identities_and_bound_round_trips(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);items=self.geography_plan(root,52);db=self.geometry_database()
            self.assertEqual(m.geography(db,root),52)
            self.assertEqual((db.reads,db.writes),(3,3))
            self.assertEqual(set(db.rows),{x['id'] for x in items})
            self.assertEqual(m.geography(db,root),52)
            self.assertEqual((db.reads,db.writes),(3,3))

    def test_changed_geometry_blocks_entire_batch_before_writes(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);items=self.geography_plan(root);db=self.geometry_database()
            db.rows[items[1]['id']]={'id':items[1]['id'],'payload':{'parts':[{'url':'unexpected'}]},'sha256':'b'*64}
            with self.assertRaisesRegex(RuntimeError,'geometry_changed'):
                m.geography(db,root)
            self.assertEqual(db.writes,0)

    def test_partial_compare_and_swap_can_resume_without_rewriting_applied_rows(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);self.geography_plan(root);db=self.geometry_database();db.conflict=True
            with self.assertRaisesRegex(RuntimeError,'compare_and_swap'):
                m.geography(db,root)
            self.assertEqual(len(db.rows),1)
            self.assertEqual(m.geography(db,root),2)
            self.assertEqual(len(db.rows),2)

    def prepare(self,root,records=110,verified=True):
        old={'id':'old','sha256':'a'*64,'records':100}
        new={'id':'world-v1-serving-new','sha256':'b'*64,'records':records,'key':'new'}
        manifest={'bundles':[{'assets':[new]}],'retireAssetIds':['old'],
            'report':{'newUniqueBusinesses':10},'servingRepartitionProofs':[{'integrity':{'allFieldsRetained':True}}]}
        manifest['baselineFingerprint']=m.p.hashlib.sha256(json.dumps([('old','a'*64,100)],sort_keys=True).encode()).hexdigest()
        (root/'publication.json').write_text(json.dumps(manifest))
        (root/'catalog-snapshot.json').write_text(json.dumps({'assets':[old]}))
        (root/'published-businesses.json').write_text(json.dumps({'new':'b'*64} if verified else {}))
        return manifest

    def database(self):
        class DB:
            mutated=False
            def room(self):return 100
            def sql(self,query,params=()):
                if query.startswith('SELECT payload FROM catalog_manifests'):return []
                if 'AS n FROM jsonb_to_recordset' in query:return [{'n':1}]
                if query.startswith('WITH expected'):
                    self.mutated=True
                    return [{'verified':True,'switched':2}]
                raise AssertionError(query)
        return DB()

    def test_serving_repartition_counts_only_ten_new_companies_not_110(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);manifest=self.prepare(root);db=self.database()
            m.assets(db,root,manifest)
            receipt=json.loads((root/'world-activation-receipt.json').read_text())
            self.assertEqual(receipt['newUniqueBusinesses'],10)
            self.assertEqual(receipt['finalCanonicalRows'],110)
            self.assertEqual(receipt['originalObjectsDeleted'],0)
            self.assertTrue(db.mutated)

    def test_lost_original_record_blocks_atomic_switch(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);manifest=self.prepare(root,records=109);db=self.database()
            with self.assertRaisesRegex(ValueError,'record_budget'):m.assets(db,root,manifest)
            self.assertFalse(db.mutated)

    def test_unverified_upload_blocks_activation(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);manifest=self.prepare(root,verified=False);db=self.database()
            with self.assertRaisesRegex(ValueError,'upload_verification'):m.assets(db,root,manifest)
            self.assertFalse(db.mutated)


if __name__=='__main__':unittest.main()

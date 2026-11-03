import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('world_activate',Path(__file__).parents[1]/'scripts/catalog-world-activate.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class AtomicActivation(unittest.TestCase):
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

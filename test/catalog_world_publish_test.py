import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('world_publish',Path(__file__).parents[1]/'scripts/catalog-world-publish.py')
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ImmutablePublication(unittest.TestCase):
    def test_wrong_database_is_rejected_before_network(self):
        for url in ['postgresql://catalog_ops_owner:x@x.neon.tech/customers','postgresql://owner:x@x.neon.tech/catalog_ops']:
            with self.assertRaisesRegex(ValueError,'isolated_public_catalog'):
                m.Database({'url':url})

    def test_private_selectors_never_allow_world_readable_files(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'selector';p.write_text('{"url":"private"}');p.chmod(0o644)
            with self.assertRaisesRegex(ValueError,'mode_0600'):m.private(p)
            p.chmod(0o600);self.assertEqual(m.private(p)['url'],'private')

    def test_original_asset_loss_blocks_publication(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);(root/'catalog-snapshot.json').write_text(json.dumps({'assets':[{'id':'old','sha256':'a'*64,'records':100}]}))
            class DB:
                def sql(self,*a):return [{'n':0}]
            with self.assertRaisesRegex(RuntimeError,'original_catalog_changed'):
                m.baseline_preserved(DB(),root,{})

    def test_unreviewed_origin_and_oversize_rejected(self):
        item={'url':'https://unrelated.example/a','key':'snapshots/20261103/world-v1/a','file':'a','sha256':'a'*64,'bytes':10}
        with self.assertRaisesRegex(ValueError,'origin'):m.validate_item(item,'businesses')
        item['url']=m.w.ORIGIN+item['key'];item['bytes']=33*1024*1024
        with self.assertRaisesRegex(ValueError,'size_budget'):m.validate_item(item,'businesses')


if __name__=='__main__':unittest.main()

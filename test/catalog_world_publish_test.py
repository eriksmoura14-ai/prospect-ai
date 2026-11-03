import importlib.util
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, MagicMock

spec=importlib.util.spec_from_file_location('world_publish',Path(__file__).parents[1]/'scripts/catalog-world-publish.py')
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ImmutablePublication(unittest.TestCase):
    def test_second_operator_cannot_race_shared_checkpoint_or_disk(self):
        with tempfile.TemporaryDirectory() as t:
            first=m.operator_lock(t)
            try:
                with self.assertRaisesRegex(RuntimeError,'operator_already_running'):
                    m.operator_lock(t)
            finally:first.close()
            m.operator_lock(t).close()

    def test_transient_storage_failure_reserves_bounded_transfer(self):
        with tempfile.TemporaryDirectory() as t:
            item={'bytes':100,'storedBytes':25}
            with patch.object(m,'upload_once',side_effect=[RuntimeError('immutable_item_upload_http_502'),'verified']) as upload, patch.object(m.time,'sleep'):
                self.assertEqual(m.upload_and_verify(Path(t),item,{}),'verified')
            self.assertEqual(upload.call_count,2)
            self.assertEqual(json.loads((Path(t)/'storage-retry-budget.json').read_text())['reservedBytes'],50)

    def test_existing_remote_object_is_hashed_without_reupload(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);(root/'business.parquet').write_bytes(b'data')
            item={'file':'business.parquet','bytes':4,'sha256':hashlib.sha256(b'data').hexdigest(),
                  'url':m.w.ORIGIN+'immutable.parquet','key':'immutable.parquet'}
            response=MagicMock();response.status_code=200;response.iter_content.return_value=[b'data'];response.__enter__.return_value=response
            head=MagicMock();head.status_code=200
            with patch.object(m.requests,'head',return_value=head),patch.object(m.requests,'get',return_value=response),patch.object(m.requests,'request') as put:
                self.assertEqual(m.upload_once(root,item,{'url':item['url']+'?signed-test'}),'immutable.parquet')
            put.assert_not_called()

    def test_retry_reservation_cannot_silently_exceed_hard_cap(self):
        with tempfile.TemporaryDirectory() as t:
            (Path(t)/'storage-retry-budget.json').write_text(json.dumps({'reservedBytes':0,'maximumBytes':1024*1024*1024}))
            with patch.object(m,'upload_once',side_effect=RuntimeError('immutable_item_head_http_503')):
                with self.assertRaisesRegex(RuntimeError,'reservation_invalid'):
                    m.upload_and_verify(Path(t),{'bytes':100},{})

    def test_integrity_errors_are_never_retried(self):
        with tempfile.TemporaryDirectory() as t, patch.object(m,'upload_once',side_effect=ValueError('remote_item_sha256')) as upload:
            with self.assertRaisesRegex(ValueError,'sha256'):
                m.upload_and_verify(Path(t),{'bytes':100},{})
            self.assertEqual(upload.call_count,1)
            self.assertFalse((Path(t)/'storage-retry-budget.json').exists())

    def test_shared_retry_budget_stops_without_more_network(self):
        with tempfile.TemporaryDirectory() as t:
            (Path(t)/'storage-retry-budget.json').write_text(json.dumps({'reservedBytes':100,'maximumBytes':100}))
            with patch.object(m,'upload_once',side_effect=RuntimeError('immutable_item_head_http_503')) as upload:
                with self.assertRaisesRegex(RuntimeError,'retry_transfer_budget'):
                    m.upload_and_verify(Path(t),{'bytes':100},{})
            self.assertEqual(upload.call_count,1)

    def test_server_retry_after_is_respected_without_blocking_indefinitely(self):
        error=RuntimeError('immutable_item_upload_http_503');error.retry_after='120'
        with tempfile.TemporaryDirectory() as t, patch.object(m,'upload_once',side_effect=error), patch.object(m.time,'sleep') as sleep:
            with self.assertRaisesRegex(RuntimeError,'retry_after_requires_later_resume'):
                m.upload_and_verify(Path(t),{'bytes':100},{})
            sleep.assert_not_called()

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

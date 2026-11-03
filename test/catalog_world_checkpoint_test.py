import gzip
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('checkpoint',Path(__file__).parents[1]/'scripts/catalog-world-checkpoint.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class Checkpoint(unittest.TestCase):
    def test_split_stream_restores_original_bytes_and_verifies_each_part(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);parts=m.Parts(root,maximum=23);raw=b'public-business-fixture'*100
            with gzip.GzipFile(fileobj=parts,mode='wb',mtime=0) as out:out.write(raw)
            parts.finish_part();compressed=b''
            self.assertGreater(len(parts.parts),1)
            for part in parts.parts:
                body=(root/part['file']).read_bytes()
                self.assertEqual(hashlib.sha256(body).hexdigest(),part['sha256'])
                self.assertLessEqual(len(body),23);compressed+=body
            self.assertEqual(gzip.decompress(compressed),raw)
            self.assertEqual(hashlib.sha256(compressed).hexdigest(),parts.whole.hexdigest())

    def test_sqlite_checkpoint_is_still_queryable_after_restore(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);db=sqlite3.connect(root/'ingest.sqlite')
            db.execute('PRAGMA journal_mode=WAL');db.execute('CREATE TABLE identities(id TEXT PRIMARY KEY)')
            db.execute("INSERT INTO identities VALUES('published-business')");db.commit();db.close()
            manifest=m.compress(root)
            compressed=b''.join((root/p['file']).read_bytes() for p in manifest['parts'])
            restored=gzip.decompress(compressed)
            self.assertEqual(hashlib.sha256(restored).hexdigest(),manifest['sqliteSha256'])
            path=root/'restored.sqlite';path.write_bytes(restored);db=sqlite3.connect(path)
            self.assertEqual(db.execute('SELECT id FROM identities').fetchone()[0],'published-business');db.close()


if __name__=='__main__':unittest.main()

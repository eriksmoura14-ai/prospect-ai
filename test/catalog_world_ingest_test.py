import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('world_ingest', Path(__file__).parents[1] / 'scripts/catalog-world-ingest.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class FullBusinessImport(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.index = m.Index(Path(self.temp.name) / 'state.sqlite')

    def tearDown(self):
        self.index.db.close()
        self.temp.cleanup()

    def row(self, sid='new', **values):
        return dict(source='overture', source_id=sid, country_code='BR', name='Café Real',
                    latitude=-18.9, longitude=-48.2, phone='+5534998883900', address='Rua A, 15', provenance='[]', **values)

    def test_all_osm_transports_share_one_identity(self):
        self.assertEqual(m.identity('qlever', 'node/12', 'BR'), m.identity('geofabrik', 'node:12', 'BR'))
        self.assertNotEqual(m.identity('qlever', 'way/12', 'BR'), m.identity('overpass', 'node/12', 'BR'))

    def test_existing_identity_is_not_reimported(self):
        row = self.row()
        self.index.seed(row)
        self.assertEqual(self.index.accept(row), (None, 'same_source_identity'))
        self.assertEqual(self.index.db.execute('SELECT count(*) FROM additions').fetchone()[0], 0)

    def test_shared_name_phone_and_nearby_address_preserve_provenance(self):
        self.index.seed(self.row('old'))
        self.assertEqual(self.index.accept(self.row('new')), (None, 'cross_source_overlap'))
        self.assertEqual(self.index.db.execute('SELECT count(*) FROM aliases').fetchone()[0], 1)

    def test_distinct_branches_are_preserved(self):
        self.index.seed(self.row('old'))
        row = self.row('new')
        row['address'] = 'Rua A, 21'
        self.assertEqual(self.index.accept(row)[1], 'new_unique')

    def test_same_name_alone_never_merges(self):
        old = self.row('old'); old.update(phone='', address='')
        self.index.seed(old)
        row = self.row('new'); row.update(phone='', address='')
        self.assertEqual(self.index.accept(row)[1], 'new_unique')

    def test_rollback_does_not_leave_an_identity_without_its_fiche(self):
        with self.assertRaises(RuntimeError):
            with self.index.db:
                self.index.accept(self.row())
                raise RuntimeError('interrupted')
        self.assertEqual(self.index.db.execute('SELECT count(*) FROM identities').fetchone()[0], 0)
        self.assertEqual(self.index.accept(self.row())[1], 'new_unique')

    def test_checkpoint_survives_reopen(self):
        self.index.accept(self.row())
        self.index.checkpoint('source:00000', {'new_unique': 1})
        self.index.db.close()
        self.index = m.Index(Path(self.temp.name) / 'state.sqlite')
        self.assertEqual(self.index.done('source:00000'), {'new_unique': 1})
        self.assertEqual(self.index.accept(self.row())[1], 'same_source_identity')

    def test_export_contains_real_fiches_and_verified_bundles(self):
        row = self.row()
        row.update(category_hierarchy=['cafe'], phones=[], websites=[], website='')
        self.index.accept(row)
        self.index.db.commit()
        assets = m.export_assets(self.index, Path(self.temp.name))
        self.assertEqual(sum(a['records'] for a in assets), 1)
        m.package(Path(self.temp.name), assets, {'baselineFingerprint': 'test', 'newUniqueBusinesses': 1})
        publication = json.loads((Path(self.temp.name) / 'publication.json').read_text())
        self.assertEqual(publication['bundles'][0]['sha256'], m.sha(Path(self.temp.name) / publication['bundles'][0]['file']))
        self.assertFalse(publication['credentialsIncluded'])


if __name__ == '__main__':
    unittest.main()

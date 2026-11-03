import csv
import gzip
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import shapely

spec = importlib.util.spec_from_file_location('world_geo', Path(__file__).parents[1]/'scripts/catalog-world-geography.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class GeographicConfirmation(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name)
        self.index=m.w.Index(self.root/'state.sqlite')

    def tearDown(self):
        self.index.db.close()
        self.temp.cleanup()

    def test_changed_published_polygon_rejected(self):
        area={'id':'BR:1','country_code':'BR','name':'Real City'}
        m.add_area(self.index,area,shapely.box(0,0,1,1))
        with self.assertRaisesRegex(ValueError,'identity_changed'):
            m.add_area(self.index,area,shapely.box(0,0,2,2))

    def test_delta_counts_real_points_not_city_labels_and_preserves_denominator(self):
        area={'id':'BR:1','country_code':'BR','kind':'municipality','state_code':'MG','name':'Real City'}
        m.add_area(self.index,area,shapely.box(0,0,1,1))
        self.index.db.execute('INSERT INTO city_areas VALUES(?,?)',('BR:MG:1','BR:1'))
        self.index.db.execute('CREATE TABLE new_city_areas(city_key TEXT PRIMARY KEY,area_id TEXT)')
        cities={'BR:MG:1':{'key':'BR:MG:1','countryCode':'BR'},'BR:MG:2':{'key':'BR:MG:2','countryCode':'BR'}}
        fields=['city_key','unique_supported','source_rows','sources','limitations','coverage_status','association_status','category_count','next_action']
        with (self.root/'coverage.csv').open('w') as f:
            writer=csv.DictWriter(f,fieldnames=fields);writer.writeheader()
            writer.writerow(dict(city_key='BR:MG:1',unique_supported=49,source_rows=49,sources='[]',limitations='[]',coverage_status='partial',association_status='licensed_polygon_archive'))
            writer.writerow(dict(city_key='BR:MG:2',unique_supported='',source_rows='',sources='[]',limitations='[]',coverage_status='location_pending',association_status='pending'))
        for sid,lon in [('inside',.5),('outside',3.)]:
            self.index.accept(dict(source='overture',source_id=sid,country_code='BR',name=sid,latitude=.5,longitude=lon,phone='',address='',provenance='[]',city='Real City'))
        self.index.db.commit()
        report=m.coverage(self.index,self.root,self.root,cities)
        self.assertEqual(report['met50'],1)
        self.assertEqual(report['inventoryCities'],2)
        self.assertEqual(report['coveragePercentageAt50'],50.)
        updates=[json.loads(line) for line in (self.root/'coverage-updates.ndjson').read_text().splitlines()]
        self.assertEqual(updates[0]['unique_supported'],50)
        with gzip.open(self.root/'all-city-coverage.csv.gz','rt') as inp:
            rows=list(csv.DictReader(inp))
        self.assertEqual(rows[1]['unique_supported'],'')

    def test_divisions_gateway_is_explicitly_scoped(self):
        ranges=m.w.module('geo_ranges_test','catalog-place-ranges.py')
        part={'url':'https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/release/2026-10-21.0/theme=divisions/type=division_area/part-00000-abcd-c000.zstd.parquet','bytes':100}
        with self.assertRaises(ValueError):ranges.PlaceRanges(part)
        source=ranges.PlaceRanges(part,layer='division_area',scratch_root=self.root)
        source.close()
        with self.assertRaises(ValueError):ranges.PlaceRanges(part,layer='unreviewed')


if __name__=='__main__':unittest.main()

import importlib.util
import json
import sqlite3
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('world_sweep', Path(__file__).resolve().parents[1] / 'scripts/catalog-world-sweep.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

CITY = {'key': 'US:NY:1', 'id': 1, 'countryCode': 'US', 'stateCode': 'NY', 'stateName': 'New York', 'name': 'Springfield'}
URL = 'https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/release/2026-10-21.0/theme=places/type=place/part-00000-11111111-1111-4111-8111-111111111111-c000.zstd.parquet'


class WholeAppSweep(unittest.TestCase):
    def test_inventory_cannot_silently_omit_or_duplicate_a_city(self):
        baseline = {CITY['key']: {}}
        self.assertEqual(m.validate_inventory({'cities': [CITY]}, baseline), [CITY])
        for rows in ([], [CITY, CITY]):
            with self.assertRaises(ValueError):
                m.validate_inventory({'cities': rows}, baseline)
        with self.assertRaises(ValueError):
            m.validate_inventory({'cities': [{**CITY, 'id': 2}]}, baseline)

    def test_homonyms_require_exact_country_and_subdivision(self):
        other = {**CITY, 'key': 'CA:ON:2', 'id': 2, 'countryCode': 'CA', 'stateCode': 'ON', 'stateName': 'Ontario'}
        lookup = m.candidate_lookup([CITY, other])
        self.assertEqual(m.candidate_keys(lookup, 'US', 'US-NY', 'Springfield'), {CITY['key']})
        self.assertEqual(m.candidate_keys(lookup, 'CA', 'Ontario', 'Springfield'), {other['key']})
        for state in ('', 'Ontario', 'New Jersey'):
            self.assertFalse(m.candidate_keys(lookup, 'US', state, 'Springfield'))
        self.assertFalse(m.candidate_keys(lookup, 'US', 'NY', 'Springfield Heights'))

    def test_same_state_name_ambiguity_is_not_arbitrarily_assigned(self):
        other = {**CITY, 'key': 'US:NY:2', 'id': 2}
        self.assertEqual(m.candidate_keys(m.candidate_lookup([CITY, other]), 'US', 'NY', 'Springfield'), {CITY['key'], other['key']})

    def test_shared_partition_is_scanned_once_for_multiple_countries(self):
        part = {'id': '00000', 'url': URL, 'bytes': 10, 'cache': None}
        countries, parts = m.collect_parts([{'country': 'US', 'parts': [part]}, {'country': 'CA', 'parts': [{**part, 'cache': '/cached'}]}])
        self.assertEqual(set(countries), {'US', 'CA'})
        self.assertEqual(len(parts), 1)
        self.assertEqual(parts['00000']['cache'], '/cached')
        with self.assertRaises(ValueError):
            m.collect_parts([{'country': 'US', 'parts': [part]}, {'country': 'CA', 'parts': [{**part, 'bytes': 11}]}])

    def test_source_cannot_change_release_or_origin(self):
        for url in (URL.replace('2026-10-21.0', 'latest'), URL.replace('overturemaps-us-west-2.s3.us-west-2.amazonaws.com', 'example.com'), URL + '?untrusted=1'):
            with self.assertRaises(ValueError):
                m.collect_parts([{'country': 'US', 'parts': [{'id': '00000', 'url': url, 'bytes': 10}]}])

    def test_candidate_observations_do_not_prove_fifty_unique_businesses(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            db = self.database(root)
            db.execute('INSERT INTO locality_evidence VALUES(?,?,?,?,?,?,?,?)', ('00000', 'US', 'NY', 'Springfield', 'Food', 90, 80, 70))
            db.execute('INSERT INTO completed_parts VALUES(?,?,?)', ('00000', 'abc', '{}'))
            db.commit()
            report = m.export_report(db, root, [CITY], {CITY['key']: {'unique_supported': 4, 'coverage_status': 'partial'}},
                                     {'US': {'parts': [{'id': '00000'}]}}, {'00000': {}}, {})
            self.assertEqual(report['inventoryCities'], 1)
            self.assertEqual(report['confirmedCitiesAtLeast50Unchanged'], 0)
            self.assertEqual(report['newUniqueBusinessesPublished'], 0)
            self.assertEqual(report['belowTargetCitiesWithCandidateObservations'], 1)
            self.assertTrue(report['sourceObservationsAreNotUniqueBusinesses'])
            db.close()

    def test_missing_sources_or_no_match_never_prove_absence(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            db = self.database(root)
            baseline = {CITY['key']: {'unique_supported': None, 'coverage_status': 'location_pending'}}
            report = m.export_report(db, root, [CITY], baseline, {'US': {'parts': [{'id': '00000'}]}}, {'00000': {}}, {})
            self.assertEqual(report['statuses'], {'source_partitions_pending': 1})
            self.assertEqual(report['inventoryCities'], 1)
            db.execute('INSERT INTO completed_parts VALUES(?,?,?)', ('00000', 'abc', '{}'))
            db.commit()
            report = m.export_report(db, root, [CITY], baseline, {'US': {'parts': [{'id': '00000'}]}}, {'00000': {}}, {})
            self.assertEqual(report['statuses'], {'no_exact_address_match_not_evidence_of_absence': 1})
            self.assertTrue(report['noAddressMatchDoesNotMeanNoBusinesses'])
            db.close()

    @staticmethod
    def database(root):
        db = sqlite3.connect(root / 'sweep.sqlite')
        db.executescript('''CREATE TABLE app_cities(city_key TEXT PRIMARY KEY,country TEXT);
          CREATE TABLE completed_parts(id TEXT PRIMARY KEY,sha256 TEXT,receipt TEXT);
          CREATE TABLE locality_evidence(part TEXT,country TEXT,region TEXT,locality TEXT,niche TEXT,
            observations INTEGER,phone_fields INTEGER,website_fields INTEGER);''')
        db.execute('INSERT INTO app_cities VALUES(?,?)', (CITY['key'], 'US'))
        db.commit()
        return db

    def test_real_parquet_filters_invalid_records_and_resumes_without_duplication(self):
        import duckdb
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            c = duckdb.connect()
            c.execute('''CREATE TABLE raw(id VARCHAR,names STRUCT("primary" VARCHAR),
              addresses STRUCT(country VARCHAR,region VARCHAR,locality VARCHAR)[],confidence DOUBLE,
              operating_status VARCHAR,sources STRUCT(dataset VARCHAR,license VARCHAR)[],
              taxonomy STRUCT("primary" VARCHAR,hierarchy VARCHAR[],alternates VARCHAR[]),basic_category VARCHAR,
              phones VARCHAR[],websites VARCHAR[],geometry BLOB)''')
            base = ['id-1', {'primary': 'Actual Cafe'}, [{'country': 'US', 'region': 'NY', 'locality': 'Springfield'}],
                    0.9, 'open', [{'dataset': 'foursquare', 'license': 'Apache-2.0'}],
                    {'primary': 'cafe', 'hierarchy': ['cafe'], 'alternates': []}, 'cafe', ['+12125550123'], [], struct.pack('<BIdd', 1, 1, -73.9, 40.7)]
            rows = [base]
            for field, value in ((4, 'permanently_closed'), (3, 0.2), (5, [{'dataset': 'unknown', 'license': 'unknown'}]), (10, b'invalid'), (1, {'primary': ''})):
                row = list(base)
                row[0] = 'bad-' + str(field)
                row[field] = value
                rows.append(row)
            c.executemany('INSERT INTO raw VALUES(?,?,?,?,?,?,?,?,?,?,?)', rows)
            source = root / 'regional-source.parquet'
            c.execute('COPY raw TO ? (FORMAT PARQUET)', [str(source)])
            c.close()
            part = {'id': '00000', 'url': URL, 'cache': str(root), 'bytes': source.stat().st_size}
            (root / 'download-report.json').write_text(json.dumps({'release': m.RELEASE, 'url': URL, 'bytes': part['bytes'], 'sha256': m.digest(source)}))
            db = self.database(root)
            result = m.scan_part(db, part, root, {'Food': ['cafe']})
            self.assertEqual(result['eligibleSourceObservations'], 1)
            self.assertEqual(db.execute('SELECT sum(observations) FROM locality_evidence').fetchone()[0], 1)
            self.assertTrue(m.scan_part(db, part, root, {'Food': ['cafe']})['reusedCheckpoint'])
            self.assertEqual(db.execute('SELECT sum(observations) FROM locality_evidence').fetchone()[0], 1)
            db.close()
            # Exercise the actual HTTP/range bridge and single-pass SQL against
            # exactly the same Parquet, with all external requests mocked.
            remote_root = root / 'remote'
            remote_root.mkdir()
            remote_db = self.database(remote_root)
            raw = source.read_bytes()

            def public_range(url, headers, **kwargs):
                self.assertEqual(url, URL)
                first, last = map(int, headers['Range'][6:].split('-'))
                response = Mock(status_code=206, headers={'ETag': '"fixture-pinned"',
                                'Content-Range': f'bytes {first}-{last}/{len(raw)}'})
                response.__enter__ = Mock(return_value=response)
                response.__exit__ = Mock(return_value=False)
                response.iter_content.return_value = [raw[first:last+1]]
                return response

            with patch('requests.Session.get', side_effect=public_range):
                remote_result = m.scan_part(remote_db, {**part, 'cache': None}, remote_root, {'Food': ['cafe']}, remote=True)
            self.assertEqual(remote_result['eligibleSourceObservations'], result['eligibleSourceObservations'])
            self.assertEqual(remote_result['localityCategoryGroups'], result['localityCategoryGroups'])
            self.assertFalse(remote_result['fullFileSha256Verified'])
            self.assertGreater(remote_result['networkBytes'], 0)
            remote_db.close()


if __name__ == '__main__':
    unittest.main()

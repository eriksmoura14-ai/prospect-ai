"""Finite full-record world import. Old assets are immutable; state lives on disk.

The source is read once per partition, across every app country and supported
segment. A locality label never establishes city membership. Coverage increases
only inside previously reviewed polygons, after conservative reconciliation.
No credentials are accepted by this worker. Publication is a separate operation.
"""
import argparse
import collections
import concurrent.futures
import csv
import gzip
import hashlib
import importlib.util
import json
import math
import shutil
import sqlite3
import time
import zipfile
from pathlib import Path
from urllib.parse import urlsplit

import duckdb
import requests
import shapely
from shapely.geometry import shape

ORIGIN = 'https://br-frosty-voice-b55arvzl.storage.c-7.us-east-2.aws.neon.tech/prospect-public-catalog/'
INPUT_URL = ORIGIN + 'operations/20261103/world-ingest-inputs-95d4f50608f4ffd4.zip'
INPUT_SHA = '95d4f50608f4ffd45be913e5935c76bf0a5b2171233a02b9bf15863404eba6ad'
MAX_OUTPUT = 650 * 1024 * 1024
MAX_FILE = 32 * 1024 * 1024
RELEASE = '2026-10-21.0'


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(file))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


h = module('world_normalize', 'catalog-normalize.py')
policy = module('world_city_policy', 'catalog-country.py')


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def save(path, data):
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    temp.replace(path)


def download(asset, path):
    url, size = asset['url'], int(asset['bytes'])
    if not url.startswith(ORIGIN) or urlsplit(url).query or not 0 < size < 256 * 1024 * 1024:
        raise ValueError('immutable_public_catalog_input_required')
    if path.exists() and path.stat().st_size == size and sha(path) == asset['sha256']:
        return
    if shutil.disk_usage(path.parent).free < size + 256 * 1024 * 1024:
        raise RuntimeError('disk_reserve_checkpoint_preserved')
    temp = path.with_suffix('.partial')
    digest, count = hashlib.sha256(), 0
    with requests.get(url, stream=True, timeout=(10, 60), allow_redirects=False) as response:
        if response.status_code != 200:
            raise RuntimeError('public_input_http_' + str(response.status_code))
        with temp.open('wb') as output:
            for block in response.iter_content(131072):
                count += len(block)
                if count > size:
                    raise RuntimeError('public_input_size')
                digest.update(block)
                output.write(block)
    if count != size or digest.hexdigest() != asset['sha256']:
        raise RuntimeError('public_input_integrity')
    temp.replace(path)


def identity(source, source_id, country):
    family = 'osm' if source in ('osm', 'openstreetmap', 'qlever', 'overpass', 'geofabrik') else source
    value = str(source_id)
    if family == 'osm':
        for prefix in ('https://www.openstreetmap.org/', 'https://www.openstreetmap.org', 'osm:'):
            value = value.removeprefix(prefix)
        value = value.replace('node/', 'node:').replace('way/', 'way:').replace('relation/', 'relation:')
    return country + '|' + family + '|' + value


class Index:
    def __init__(self, path):
        self.db = sqlite3.connect(path)
        self.db.executescript('''PRAGMA journal_mode=WAL;PRAGMA synchronous=NORMAL;PRAGMA cache_size=-65536;
          CREATE TABLE IF NOT EXISTS identities(identity TEXT PRIMARY KEY,root INTEGER NOT NULL) WITHOUT ROWID;
          CREATE TABLE IF NOT EXISTS roots(id INTEGER PRIMARY KEY,country TEXT,name TEXT,x INTEGER,y INTEGER,
            latitude REAL,longitude REAL,phone TEXT,address TEXT);
          CREATE INDEX IF NOT EXISTS nearby ON roots(country,name,x,y);
          CREATE TABLE IF NOT EXISTS checkpoints(id TEXT PRIMARY KEY,payload TEXT) WITHOUT ROWID;
          CREATE TABLE IF NOT EXISTS additions(root INTEGER PRIMARY KEY,country TEXT,payload TEXT);
          CREATE TABLE IF NOT EXISTS aliases(identity TEXT PRIMARY KEY,root INTEGER,provenance TEXT) WITHOUT ROWID;
          CREATE TABLE IF NOT EXISTS pending(identity TEXT PRIMARY KEY,country TEXT,reason TEXT,payload TEXT) WITHOUT ROWID;
          CREATE TABLE IF NOT EXISTS areas(id TEXT PRIMARY KEY,country TEXT,metadata TEXT,geometry BLOB) WITHOUT ROWID;
          CREATE INDEX IF NOT EXISTS areas_country ON areas(country);
          CREATE TABLE IF NOT EXISTS city_areas(city_key TEXT PRIMARY KEY,area_id TEXT) WITHOUT ROWID;
          CREATE TABLE IF NOT EXISTS city_deltas(city_key TEXT PRIMARY KEY,n INTEGER,phones INTEGER,websites INTEGER,
            addresses INTEGER,categories TEXT) WITHOUT ROWID;
          CREATE TABLE IF NOT EXISTS target_exclusions(root INTEGER PRIMARY KEY);
        ''')

    def done(self, key):
        row = self.db.execute('SELECT payload FROM checkpoints WHERE id=?', (key,)).fetchone()
        return json.loads(row[0]) if row else None

    def checkpoint(self, key, payload):
        self.db.execute('INSERT OR REPLACE INTO checkpoints VALUES(?,?)', (key, json.dumps(payload)))
        self.db.commit()

    def seed(self, row):
        ident = identity(row['source'], row['source_id'], row['country_code'])
        if self.db.execute('SELECT 1 FROM identities WHERE identity=?', (ident,)).fetchone():
            return
        self.insert_root(row, ident)

    def insert_root(self, row, ident):
        lat, lon = row['latitude'], row['longitude']
        cur = self.db.execute('INSERT INTO roots(country,name,x,y,latitude,longitude,phone,address) VALUES(?,?,?,?,?,?,?,?)',
            (row['country_code'], h.normalize(row['name']), math.floor(lon / .002), math.floor(lat / .002), lat, lon,
             row.get('phone') or '', h.normalize(row.get('address'))))
        root = cur.lastrowid
        self.db.execute('INSERT INTO identities VALUES(?,?)', (ident, root))
        return root

    def accept(self, row):
        cc = row['country_code']
        ident = identity(row['source'], row['source_id'], cc)
        existing = self.db.execute('SELECT root FROM identities WHERE identity=?', (ident,)).fetchone()
        if existing:
            return None, 'same_source_identity'
        lat, lon, addr = row['latitude'], row['longitude'], h.normalize(row.get('address'))
        x, y = math.floor(lon / .002), math.floor(lat / .002)
        width = max(1, math.ceil(60 / (111195 * .002 * max(.01, math.cos(lat * math.pi / 180)))))
        keys = h.phone_keys(row.get('phone'), cc)
        for prior in self.db.execute('SELECT id,latitude,longitude,phone,address FROM roots WHERE country=? AND name=? AND x BETWEEN ? AND ? AND y BETWEEN ? AND ?',
                (cc, h.normalize(row['name']), x-width, x+width, y-1, y+1)):
            root, plat, plon, telephone, address = prior
            if h.distance((None, lat, lon), (None, plat, plon)) > 60 or addr and address and addr != address:
                continue
            if keys.intersection(h.phone_keys(telephone, cc)) or addr and addr == address:
                self.db.execute('INSERT INTO identities VALUES(?,?)', (ident, root))
                self.db.execute('INSERT INTO aliases VALUES(?,?,?)', (ident, root, row['provenance']))
                return None, 'cross_source_overlap'
        root = self.insert_root(row, ident)
        self.db.execute('INSERT INTO additions VALUES(?,?,?)', (root, cc, json.dumps(row, ensure_ascii=False, separators=(',', ':'))))
        return root, 'new_unique'


def inputs(root):
    folder = root / 'inputs'
    folder.mkdir(exist_ok=True)
    archive = folder / 'inputs.zip'
    download({'url': INPUT_URL, 'bytes': 55566605, 'sha256': INPUT_SHA}, archive)
    with zipfile.ZipFile(archive) as source:
        manifest = json.loads(source.read('manifest.json'))
        for name, item in manifest['files'].items():
            if Path(name).name != name or item['bytes'] > 500 * 1024 * 1024:
                raise ValueError('input_archive_entry_policy')
            path = folder / name
            if not path.exists() or sha(path) != item['sha256']:
                with source.open(name) as inp, path.open('wb') as out:
                    shutil.copyfileobj(inp, out, 131072)
            if path.stat().st_size != item['bytes'] or sha(path) != item['sha256']:
                raise ValueError('input_archive_entry_integrity')
    return folder, manifest


def seed_existing(index, snapshot, root, folder):
    c = duckdb.connect(config={'memory_limit': '256MB', 'threads': '1'})
    start = time.monotonic()
    for num, asset in enumerate(snapshot['assets'], 1):
        key = 'baseline:' + asset['id']
        if index.done(key):
            if index.done(key)['sha256'] != asset['sha256']:
                raise ValueError('baseline_asset_identity_changed')
            continue
        path = root / 'old-asset.parquet'
        download(asset, path)
        cursor = c.execute('SELECT source,source_id,country_code,name,latitude,longitude,phone,address FROM read_parquet(?)', [str(path)])
        names = [value[0] for value in cursor.description]
        count = 0
        with index.db:
            while rows := cursor.fetchmany(2000):
                for values in rows:
                    index.seed(dict(zip(names, values)))
                count += len(rows)
        if count != int(asset['records']):
            raise RuntimeError('baseline_asset_record_count_mismatch')
        index.checkpoint(key, {'sha256': asset['sha256'], 'records': count})
        path.unlink()
        print(json.dumps({'stage': 'baseline_index', 'assets': num, 'totalAssets': len(snapshot['assets']),
                          'elapsedSeconds': round(time.monotonic()-start)}), flush=True)
    if not index.done('legacy'):
        with gzip.open(folder / 'legacy-records.ndjson.gz', 'rt') as source, index.db:
            count = 0
            for line in source:
                row = json.loads(line)
                if row['latitude'] is None or row['longitude'] is None:
                    continue
                index.seed(row)
                count += 1
        index.checkpoint('legacy', {'observations': count})
    c.close()


def country_shapes(folder):
    countries = {}
    for feature in json.loads((folder / 'countries.geojson').read_text())['features']:
        cc = feature['properties'].get('ISO_A2_EH') or feature['properties'].get('ISO_A2')
        geom = shape(feature['geometry'])
        if not geom.is_valid:
            geom = shapely.make_valid(geom)
        countries[cc] = shapely.union_all([countries[cc], geom]) if cc in countries else geom
    for geom in countries.values():
        shapely.prepare(geom)
    return countries


def scan_part(index, part, groups, countries, allowed, root):
    key = 'source:' + part['id']
    if index.done(key):
        return index.done(key)
    # Remote raw input remains bounded to one fixed partition; no retries hide
    # quota consumption. Partial SQL/index writes are rolled back on failure.
    ranges = module('world_ranges', 'catalog-place-ranges.py')
    transport = ranges.PlaceRanges(part, seconds=1800, read_ahead_bytes=4*1024*1024, scratch_root=root)
    source = transport.start()
    c = duckdb.connect(config={'memory_limit': '384MB', 'threads': '1', 'max_temp_directory_size': '0B',
                               'autoinstall_known_extensions': 'false', 'autoload_known_extensions': 'false'})
    c.execute('LOAD httpfs;SET http_timeout=35;SET http_retries=0;SET enable_http_metadata_cache=true')
    quote = lambda value: "'" + value.replace("'", "''") + "'"
    clauses = []
    for niche, values in groups.items():
        choices = '[' + ','.join(quote(value) for value in values) + ']'
        clauses.append(f'WHEN list_has_any(taxonomy.hierarchy,{choices}) OR list_contains({choices},taxonomy.primary) OR list_has_any(taxonomy.alternates,{choices}) OR list_contains({choices},basic_category) THEN {quote(niche)}')
    niche_sql = 'CASE ' + ' '.join(clauses) + ' ELSE NULL END'
    sql = '''SELECT id,names.primary,taxonomy.primary,taxonomy.hierarchy,taxonomy.alternates,basic_category,
      upper(addresses[1].country),addresses[1].region,addresses[1].locality,
      concat_ws(', ',nullif(addresses[1].freeform,''),nullif(addresses[1].postcode,'')),geometry,
      phones,websites,confidence,coalesce(operating_status,'unknown'),
      to_json(list_transform(sources,s -> struct_pack(dataset:=s.dataset,record_id:=s.record_id,
        license:=coalesce(nullif(s.license,''),CASE lower(s.dataset) WHEN 'foursquare' THEN 'Apache-2.0'
        WHEN 'alltheplaces' THEN 'CC0-1.0' ELSE 'CDLA-Permissive-2.0' END),property:=s.property))),NICHE
      FROM read_parquet(?) WHERE id IS NOT NULL AND length(trim(names.primary)) BETWEEN 1 AND 400
      AND upper(addresses[1].country)=ANY(?) AND (confidence IS NULL OR confidence BETWEEN 0.5 AND 1)
      AND coalesce(operating_status,'unknown')<>'permanently_closed' AND len(sources)>0
      AND len(list_filter(sources,s -> s.dataset IS NULL OR NOT list_contains(?,lower(s.dataset))
        OR NOT list_contains(?,coalesce(nullif(s.license,''),CASE lower(s.dataset) WHEN 'foursquare' THEN 'Apache-2.0'
        WHEN 'alltheplaces' THEN 'CC0-1.0' ELSE 'CDLA-Permissive-2.0' END))))=0
      AND (NICHE) IS NOT NULL'''.replace('NICHE', niche_sql)
    counts = collections.Counter()
    started = time.monotonic()
    now = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    try:
        cursor = c.execute(sql, [source, sorted(allowed), h.KNOWN, h.LICENSES])
        with index.db:
            while batch := cursor.fetchmany(1000):
                if shutil.disk_usage(root).free < 512 * 1024 * 1024:
                    raise RuntimeError('world_ingest_disk_reserve')
                for values in batch:
                    (sid, name, primary, hierarchy, alternates, basic, cc, state, city, address,
                     binary, phones, websites, confidence, operating, provenance, niche) = values
                    counts['eligibleSourceObservations'] += 1
                    point = h.point(binary)
                    if not point:
                        counts['invalidCoordinates'] += 1
                        continue
                    phone, website = h.phone(phones), h.website(websites)
                    row = {'source_id': sid, 'name': name, 'normalized_name': h.normalize(name), 'category': niche,
                        'primary_category': primary, 'category_hierarchy': hierarchy or [], 'alternate_categories': alternates or [],
                        'basic_category': basic, 'country_code': cc, 'state': state or '', 'city': city or '', 'original_city': city,
                        'address': address or '', **point, 'phone': phone, 'phones': phones or [], 'website': website,
                        'websites': websites or [], 'confidence': confidence, 'operating_status': operating, 'source': 'overture',
                        'source_release': RELEASE, 'provenance': provenance, 'license_id': 'CDLA-Permissive-2.0 AND Apache-2.0 AND CC0-1.0',
                        'catalog_scope': 'active_niche', 'discovered_at': now, 'last_seen_at': now, 'last_verified_at': None,
                        'location_verification': 'source_country_and_natural_earth_10m',
                        'website_classification': 'insufficient_information' if not website else 'needs_verification' if h.profile(website) else 'website_identified',
                        'phone_verification': 'listed_unverified' if phone else 'not_listed'}
                    if cc not in countries or not shapely.intersects_xy(countries[cc], point['longitude'], point['latitude']):
                        # Coastal simplification or disputed border: keep the full
                        # fiche pending, never assign to a neighbouring country.
                        ident = identity('overture', sid, cc)
                        index.db.execute('INSERT OR IGNORE INTO pending VALUES(?,?,?,?)',
                            (ident, cc, 'country_polygon_not_confirmed', json.dumps(row, ensure_ascii=False)))
                        counts['locationPending'] += 1
                        continue
                    _, outcome = index.accept(row)
                    counts[outcome] += 1
                if counts['eligibleSourceObservations'] % 50000 < 1000:
                    print(json.dumps({'stage': 'full_business_records', 'partition': part['id'], **counts,
                                      'elapsedSeconds': round(time.monotonic()-started)}), flush=True)
        receipt = transport.receipt()
        save(root / ('source-ranges-' + part['id'] + '.json'), receipt)
        result = {'id': part['id'], **counts, 'networkBytes': transport.received,
                  'elapsedMs': round((time.monotonic()-started)*1000), 'sourceUrl': part['url'], 'etag': receipt['etag']}
        index.checkpoint(key, result)
        return result
    except Exception:
        save(root / ('source-ranges-failed-' + part['id'] + '.json'), transport.receipt())
        if transport.errors:
            raise RuntimeError(transport.errors[0])
        raise
    finally:
        c.close()
        transport.close()


def export_assets(index, root, compact=False):
    output = root / 'businesses'
    output.mkdir(exist_ok=True)
    c = duckdb.connect(config={'memory_limit': '256MB', 'threads': '1'})
    manifests, used = [], 0
    # Country + spatial tile, then bounded 50k-row shards. Files carry actual
    # point bounds; tiles never substitute for the app's city polygons.
    for (cc,) in index.db.execute('SELECT DISTINCT country FROM additions ORDER BY country'):
        temporary = root / 'export.ndjson'
        with temporary.open('w') as out:
            for (payload,) in index.db.execute('SELECT payload FROM additions WHERE country=? ORDER BY root', (cc,)):
                out.write(payload + '\n')
        c.execute('CREATE OR REPLACE TEMP TABLE country_records AS SELECT *,floor(longitude/4)::INT AS tile_x,floor(latitude/4)::INT AS tile_y FROM read_json_auto(?,maximum_object_size=65536,sample_size=-1)', [str(temporary)])
        if compact:
            # Most countries fit one small file. This avoids thousands of
            # mostly empty spatial shards and leaves the reader's eight-file
            # guard intact. Large countries retain bounded spatial shards.
            candidate = output / (cc + '-country.parquet')
            if candidate.exists():
                candidate.unlink()
            target = "'" + str(candidate).replace("'", "''") + "'"
            c.execute('COPY (SELECT * EXCLUDE(tile_x,tile_y) FROM country_records ORDER BY source_id) TO ' + target + ' (FORMAT PARQUET,COMPRESSION ZSTD,ROW_GROUP_SIZE 10000)')
            if candidate.stat().st_size <= MAX_FILE:
                count, west, south, east, north = c.execute('SELECT count(*),min(longitude),min(latitude),max(longitude),max(latitude) FROM read_parquet(?)', [str(candidate)]).fetchone()
                size, digest = candidate.stat().st_size, sha(candidate)
                if used + size > MAX_OUTPUT:
                    raise RuntimeError('world_output_free_storage_budget_checkpoint_preserved')
                key = f'snapshots/20261103/world-v1/{cc}-country-{digest[:16]}.parquet'
                manifests.append({'id': 'world-v1-' + cc.lower() + '-' + digest[:24], 'file': candidate.name, 'key': key,
                    'url': ORIGIN + key, 'sha256': digest, 'bytes': size, 'records': count, 'countries': [cc],
                    'bounds': [west,south,east,north], 'source': 'overture', 'release': RELEASE,
                    'license': {'id':'ODbL-1.0 AND CDLA-Permissive-2.0 AND Apache-2.0 AND CC0-1.0',
                        'attribution':'© OpenStreetMap contributors; Overture Maps Foundation; per-record original provenance retained'}})
                used += size
                temporary.unlink()
                continue
            candidate.unlink()
        for x, y, n in c.execute('SELECT tile_x,tile_y,count(*) FROM country_records GROUP BY 1,2 ORDER BY 1,2').fetchall():
            for offset in range(0, n, 50000):
                file = output / f'{cc}-{x}-{y}-{offset//50000}.parquet'
                if file.exists():
                    file.unlink()  # Only this worker's reproducible staging output.
                target = "'" + str(file).replace("'", "''") + "'"
                c.execute('COPY (SELECT * EXCLUDE(tile_x,tile_y) FROM country_records WHERE tile_x=? AND tile_y=? ORDER BY source_id LIMIT 50000 OFFSET ?) TO ' + target + ' (FORMAT PARQUET,COMPRESSION ZSTD,ROW_GROUP_SIZE 10000)', [x, y, offset])
                size = file.stat().st_size
                if size > MAX_FILE or used + size > MAX_OUTPUT:
                    file.unlink()
                    raise RuntimeError('world_output_free_storage_budget_checkpoint_preserved')
                count, w, s, e, north = c.execute('SELECT count(*),min(longitude),min(latitude),max(longitude),max(latitude) FROM read_parquet(?)', [str(file)]).fetchone()
                digest = sha(file)
                key = f'snapshots/20261103/world-v1/{cc}-{x}-{y}-{digest[:16]}.parquet'
                manifests.append({'id': 'world-v1-' + cc.lower() + '-' + digest[:24], 'file': file.name, 'key': key,
                    'url': ORIGIN + key, 'sha256': digest, 'bytes': size, 'records': count, 'countries': [cc],
                    'bounds': [w, s, e, north], 'source': 'overture', 'release': RELEASE,
                    'license': {'id': 'ODbL-1.0 AND CDLA-Permissive-2.0 AND Apache-2.0 AND CC0-1.0',
                        'attribution': '© OpenStreetMap contributors; Overture Maps Foundation; per-record original provenance retained'}})
                used += size
        temporary.unlink()
        print(json.dumps({'stage': 'export_actual_businesses', 'country': cc, 'assets': len(manifests), 'bytes': used}), flush=True)
    c.close()
    return manifests


def package(root, assets, report):
    bundles, current, size = [], [], 0
    def flush():
        if not current:
            return
        file = root / ('business-bundle-' + str(len(bundles)).zfill(3) + '.zip')
        with zipfile.ZipFile(file, 'w', compression=zipfile.ZIP_STORED) as archive:
            for item in current:
                archive.write(root / 'businesses' / item['file'], item['file'])
        bundles.append({'file': file.name, 'bytes': file.stat().st_size, 'sha256': sha(file), 'assets': list(current)})
    for asset in assets:
        if size + asset['bytes'] > 48 * 1024 * 1024:
            flush()
            current, size = [], 0
        current.append(asset)
        size += asset['bytes']
    flush()
    save(root / 'publication.json', {'version': 1, 'baselineFingerprint': report['baselineFingerprint'], 'bundles': bundles,
        'report': report, 'oldAssetMutationCount': 0, 'credentialsIncluded': False})
    notes = f"Actual full business records, conservatively reconciled against all prior ready assets. New unique: {report['newUniqueBusinesses']}. This is not a claim that all cities reached 50. Original catalog assets are retained. Public original source identifiers and licenses remain in each record."
    (root / 'RELEASE_NOTES.md').write_text(notes)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--root', default='.artifacts/ci-world-ingest')
    p.add_argument('--skip-geography', action='store_true')
    a = p.parse_args()
    root = Path(a.root)
    root.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    folder, manifest = inputs(root)
    snapshot = json.loads((folder / 'catalog-snapshot.json').read_text())
    inventory = json.loads((folder / 'inventory.json').read_text())['cities']
    if len(inventory) != 152970 or snapshot['inventoryCount'] != len(inventory):
        raise ValueError('complete_current_app_inventory_required')
    fingerprint = hashlib.sha256(json.dumps([(v['id'], v['sha256'], v['records']) for v in snapshot['assets']], sort_keys=True).encode()).hexdigest()
    index = Index(root / 'ingest.sqlite')
    old = index.done('baseline_fingerprint')
    if old and old['sha256'] != fingerprint:
        raise ValueError('resume_cannot_change_baseline')
    index.checkpoint('baseline_fingerprint', {'sha256': fingerprint})
    seed_existing(index, snapshot, root, folder)
    groups = json.loads(Path('data/catalog-active-niches-20261021.json').read_text())
    plan = json.loads(Path('data/catalog-world-source-plan-20261021.json').read_text())
    countries, allowed = country_shapes(folder), {row['countryCode'] for row in inventory}
    errors = []
    for part in plan['partitions']:
        try:
            result = scan_part(index, part, groups, countries, allowed, root)
            print(json.dumps({'stage': 'partition_checkpoint', **result}), flush=True)
        except Exception as error:
            errors.append({'partition': part['id'], 'reason': str(error)[:200]})
            save(root / 'errors.json', errors)
            # Do not repeatedly retry the same public source in this run.
            continue
    assets = export_assets(index, root)
    new = sum(v['records'] for v in assets)
    report = {'version': 1, 'baselineFingerprint': fingerprint, 'inventoryCities': len(inventory),
        'previousUniqueBusinesses': 5693290, 'previousCanonicalRows': manifest['canonicalRecords'],
        'newUniqueBusinesses': new, 'totalUniqueBusinessesConservative': 5693290 + new,
        'partitionsCompleted': len(list(index.db.execute("SELECT id FROM checkpoints WHERE id LIKE 'source:%'"))),
        'partitionsRequired': len(plan['partitions']), 'errors': errors, 'targetCompletionClaimed': False,
        'sourceOverlaps': index.db.execute('SELECT count(*) FROM aliases').fetchone()[0],
        'locationPendingRecords': index.db.execute('SELECT count(*) FROM pending').fetchone()[0],
        'newCountries': dict(index.db.execute('SELECT country,count(*) FROM additions GROUP BY country')),
        'businessBytes': sum(v['bytes'] for v in assets), 'assets': len(assets),
        'elapsedMs': round((time.monotonic()-started)*1000), 'oldAssetsReplaced': False,
        'cityGeographicValidationPending': True, 'coverageBeforeMet50': snapshot['met50']}
    save(root / 'report.json', report)
    package(root, assets, report)
    index.db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    index.db.close()
    print(json.dumps(report), flush=True)
    return 2 if errors else 0


if __name__ == '__main__':
    raise SystemExit(main())

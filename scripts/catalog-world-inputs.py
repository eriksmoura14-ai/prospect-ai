"""Prepare public, immutable inputs for the finite ingestion worker.

Only the already configured public catalog is read. Credentials stay in the
existing private selector file; the ZIP is built from an explicit allowlist.
"""
import argparse
import gzip
import hashlib
import json
import shutil
import time
import zipfile
from pathlib import Path
from urllib.parse import urlsplit

import requests


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--root', required=True)
    p.add_argument('--database-config', required=True)
    a = p.parse_args()
    root = Path(a.root)
    cfg = json.loads(Path(a.database_config).read_text())
    parsed = urlsplit(cfg['url'])
    if parsed.path != '/catalog_ops' or not parsed.hostname.endswith('.neon.tech'):
        raise ValueError('isolated_public_catalog_required')
    root.mkdir(parents=True, exist_ok=True)
    session = requests.Session()

    def sql(query, params=()):
        response = session.post('https://' + parsed.hostname + '/sql',
            headers={'Neon-Connection-String': cfg['url'], 'Neon-Raw-Text-Output': 'false', 'Neon-Array-Mode': 'false'},
            json={'query': query, 'params': list(params)}, timeout=(10, 60), allow_redirects=False)
        if response.status_code != 200:
            raise RuntimeError('public_catalog_input_http_' + str(response.status_code))
        data = response.json()
        if data.get('error'):
            raise RuntimeError('public_catalog_input_query_rejected')
        return data['rows']

    expected = int(sql('SELECT count(*) AS n FROM catalog_admin_areas')[0]['n'])
    output = root / 'native-areas.ndjson.gz'
    last, count = '', 0
    with gzip.open(output, 'wt', compresslevel=6) as out:
        while True:
            if shutil.disk_usage(root).free < 40 * 1024 * 1024:
                raise RuntimeError('public_input_disk_reserve')
            rows = sql('''SELECT id,country_code,state_code,name,kind,source,vintage,license,bounds,area_key,source_metadata,
                ST_AsGeoJSON(geom,15,0) AS geometry_json,
                encode(sha256(convert_to(ST_AsGeoJSON(geom,15,0),'UTF8')),'hex') AS geometry_sha256
                FROM catalog_admin_areas WHERE id COLLATE "C">$1 ORDER BY id COLLATE "C" LIMIT 100''', [last])
            if not rows:
                break
            for row in rows:
                if hashlib.sha256(row['geometry_json'].encode()).hexdigest() != row['geometry_sha256']:
                    raise RuntimeError('native_geometry_export_integrity')
                out.write(json.dumps(row, ensure_ascii=False, separators=(',', ':')) + '\n')
            count += len(rows)
            last = rows[-1]['id']
            if count % 2000 < 100:
                print(json.dumps({'nativeAreasExported': count, 'expected': expected}), flush=True)
    if count != expected:
        raise RuntimeError('native_geometry_export_incomplete')
    snapshot = json.loads((root / 'catalog-snapshot.json').read_text())
    source_files = {
        'catalog-snapshot.json': root / 'catalog-snapshot.json',
        'legacy-records.ndjson.gz': root / 'legacy-records.ndjson.gz',
        'native-areas.ndjson.gz': output,
        'countries.geojson': Path('.artifacts/catalog-million-20261023/countries-natural-earth.geojson'),
        'inventory.json': Path('.artifacts/coverage-20261023/inventory.json'),
        'coverage.csv': Path('.artifacts/coverage-resume-20261101/final/all-city-coverage.csv'),
        'divisions-assets.json': Path('.artifacts/world-boundaries-20261026/assets.json'),
    }
    manifest = {'version': 1, 'createdAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                'inventoryCities': 152970, 'legacyObservations': 13960, 'nativeAreas': count,
                'canonicalRecords': sum(int(asset['records']) for asset in snapshot['assets']),
                'credentialsIncluded': False, 'files': {}}
    package = root / 'world-ingest-inputs-v1.zip'
    with zipfile.ZipFile(package, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as out:
        for name, path in source_files.items():
            with path.open('rb') as source:
                checksum = hashlib.file_digest(source, 'sha256').hexdigest()
            manifest['files'][name] = {'sha256': checksum, 'bytes': path.stat().st_size}
            out.write(path, name)
        out.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2))
    result = {'file': str(package.resolve()), 'sha256': hashlib.file_digest(package.open('rb'), 'sha256').hexdigest(),
              'bytes': package.stat().st_size, 'nativeAreas': count, 'credentialsIncluded': False}
    (root / 'input-package.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()

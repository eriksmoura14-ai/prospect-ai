"""Confirm city membership for the full-record world import, without name quotas.

Reuses every published boundary. New mappings require the published country,
ISO subdivision, exact reviewed names, and the app anchor inside a territorial
locality polygon. All original observations and assets remain immutable.
"""
import argparse
import collections
import concurrent.futures
import csv
import gzip
import json
import time
from pathlib import Path

import duckdb
import numpy as np
import shapely
from shapely.geometry import shape, mapping

import importlib.util
spec = importlib.util.spec_from_file_location('world_import', Path(__file__).with_name('catalog-world-ingest.py'))
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)
crosswalk = w.module('world_crosswalk', 'catalog-world-boundaries.py')
MAX_GEOMETRY = 256 * 1024 * 1024
MAP_URL = w.ORIGIN + 'operations/20261103/city-areas-7ef9fc190302e5f8.ndjson.gz'
MAP_SHA = '7ef9fc190302e5f8eefc179d6db437d0f2499f3cdb8d9c689db4bccd30baaf39'


def add_area(index, area, geom):
    if geom.is_empty or geom.geom_type not in ('Polygon', 'MultiPolygon'):
        raise ValueError('non_polygon_city_scope')
    metadata = {k: v for k, v in area.items() if k not in ('geometry', 'geometry_json', 'geom')}
    prior = index.db.execute('SELECT geometry FROM areas WHERE id=?', (area['id'],)).fetchone()
    if prior:
        previous = shapely.from_wkb(prior[0])
        # PostGIS's explicitly exported 15-decimal GeoJSON can differ from the
        # original JSON by sub-nanometre serialization rounding only.
        if not previous.equals(geom) and not previous.equals_exact(geom, 1e-12, normalize=True):
            raise ValueError('published_city_polygon_identity_changed')
    index.db.execute('INSERT OR IGNORE INTO areas VALUES(?,?,?,?)',
        (area['id'], area['country_code'], json.dumps(metadata, ensure_ascii=False), shapely.to_wkb(geom)))


def existing_geometry(index, folder, snapshot, root, cities):
    if not index.done('native_geometry'):
        map_file = root / 'city-areas.ndjson.gz'
        w.download({'url': MAP_URL, 'bytes': 168795, 'sha256': MAP_SHA}, map_file)
        with gzip.open(folder / 'native-areas.ndjson.gz', 'rt') as source, index.db:
            for line in source:
                area = json.loads(line)
                if w.hashlib.sha256(area['geometry_json'].encode()).hexdigest() != area['geometry_sha256']:
                    raise ValueError('native_polygon_export_integrity')
                add_area(index, area, shape(json.loads(area['geometry_json'])))
            with gzip.open(map_file, 'rt') as inp:
                for line in inp:
                    row = json.loads(line)
                    if row['city_key'] not in cities:
                        raise ValueError('unknown_app_city')
                    index.db.execute('INSERT OR IGNORE INTO city_areas VALUES(?,?)', (row['city_key'], row['admin_id']))
        index.checkpoint('native_geometry', {'unchanged': True})
    parts = {part['sha256']: part for item in snapshot['geometryManifests'] for part in item['payload']['parts']}
    missing = [part for key, part in parts.items() if not index.done('geometry:' + key)]
    def retrieve(part):
        path = root / ('geometry-' + part['sha256'] + '.json')
        w.download(part, path)
        return part, path
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        # At most four small immutable parts are downloading concurrently;
        # consume completed tasks in small batches, not 500MB in RAM.
        for offset in range(0, len(missing), 4):
            for part, path in pool.map(retrieve, missing[offset:offset+4]):
                data = json.loads(path.read_text())
                if data['version'] != 1:
                    raise ValueError('published_geometry_version')
                with index.db:
                    for area in data['areas']:
                        key = area['city_key']
                        if key not in cities or area['country_code'] != cities[key]['countryCode'] or area['city_id'] != cities[key]['id']:
                            raise ValueError('published_city_geometry_identity')
                        city=cities[key]
                        area.setdefault('state_code',city['stateCode'])
                        meta=area.setdefault('source_metadata',{})
                        requested=crosswalk.requested_county_policy(city)
                        if area['kind']=='county' and area['id'].startswith('OVT:division_area:') and requested:
                            # These exact registry options already have reviewed,
                            # published polygons. Rehydrate their documented
                            # policy; the compact serving JSON omits this field.
                            meta.setdefault('scope_policy',requested)
                            label=w.policy.normalized(city['name'])
                            if city['countryCode'] in ('SK','CZ'):
                                meta.setdefault('verified_district_labels',[label])
                            elif city['countryCode'] in ('DK','BG'):
                                meta.setdefault('verified_municipality_labels',[label])
                                meta.setdefault('admin_level',2)
                        add_area(index, area, shape(area['geometry']))
                        index.db.execute('INSERT OR IGNORE INTO city_areas VALUES(?,?)', (key, area['id']))
                index.checkpoint('geometry:' + part['sha256'], {'bytes': part['bytes']})
                path.unlink()
            print(json.dumps({'stage': 'reuse_published_geography', 'completedParts': min(offset+4, len(missing)), 'parts': len(missing)}), flush=True)


def discover_scopes(index, root, folder, cities):
    index.db.executescript('''CREATE TABLE IF NOT EXISTS boundary_candidates(city_key TEXT,area_id TEXT,
      metadata TEXT,geometry BLOB,PRIMARY KEY(city_key,area_id)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS new_city_areas(city_key TEXT PRIMARY KEY,area_id TEXT) WITHOUT ROWID;''')
    known = {row[0] for row in index.db.execute('SELECT city_key FROM city_areas')}
    wanted = collections.defaultdict(list)
    for key, city in cities.items():
        if key in known:
            continue
        for name in crosswalk.registry_names(city):
            wanted[(city['countryCode'], city['countryCode'] + '-' + city['stateCode'], name)].append(city)
    ranges = w.module('world_division_ranges', 'catalog-place-ranges.py')
    errors = []
    for asset in json.loads((folder / 'divisions-assets.json').read_text()):
        if asset['theme'] != 'divisions-stac' or index.done('division:' + asset['id']):
            continue
        part = {'id': asset['id'], 'url': asset['url'], 'bytes': asset['size']}
        transport = ranges.PlaceRanges(part, seconds=1800, read_ahead_bytes=4*1024*1024, scratch_root=root, layer='division_area')
        url = transport.start()
        c = duckdb.connect(config={'memory_limit': '384MB', 'threads': '1', 'max_temp_directory_size': '0B',
            'autoinstall_known_extensions': 'false', 'autoload_known_extensions': 'false'})
        c.execute('LOAD httpfs;SET http_timeout=35;SET http_retries=0;SET enable_http_metadata_cache=true')
        seen, matches = 0, 0
        try:
            cursor = c.execute("SELECT id,division_id,names,country,region,subtype,sources,geometry FROM read_parquet(?) WHERE country=ANY(?) AND subtype IN ('locality','localadmin') AND is_territorial=true", [url, sorted({v[0] for v in wanted})])
            with index.db:
                while batch := cursor.fetchmany(500):
                    for sid, division, names, cc, region, kind, sources, binary in batch:
                        seen += 1
                        labels = crosswalk.names(names, cc)
                        candidates = {city['key']: city for label in labels for city in wanted.get((cc, region, label), [])}
                        if not candidates or not sources or any(str(s.get('dataset', '')).lower() not in ('openstreetmap', 'geoboundaries') or s.get('license') not in ('ODbL-1.0', 'CC-BY-4.0', 'CC-BY-3.0', 'CC-BY-3.0-IGO') for s in sources):
                            continue
                        try:
                            geom = shapely.force_2d(shapely.from_wkb(binary))
                            if not geom.is_valid:
                                geom = shapely.make_valid(geom)
                        except (ValueError, TypeError, shapely.errors.GEOSException):
                            continue
                        if geom.geom_type not in ('Polygon', 'MultiPolygon') or geom.is_empty or shapely.get_num_coordinates(geom) > 50000:
                            continue
                        geometry = mapping(geom)
                        if len(json.dumps(geometry).encode()) > 2*1024*1024:
                            continue
                        identity = 'OVT:division_area:' + sid
                        sregion = region.split('-', 1)[1] if region and region.startswith(cc + '-') else None
                        area = {'id': identity, 'country_code': cc, 'state_code': sregion, 'name': names['primary'], 'kind': kind,
                            'source': 'Overture divisions / OpenStreetMap / geoBoundaries', 'vintage': w.RELEASE,
                            'license': {'id': 'ODbL-1.0', 'url': 'https://opendatacommons.org/licenses/odbl/1-0/',
                                'attribution': '© OpenStreetMap contributors; Overture Maps Foundation; geoBoundaries contributors as recorded per feature', 'shareAlike': True},
                            'source_metadata': {'source_area_id': sid, 'division_id': division, 'subtype': kind,
                                'regionISO': region, 'territorial': True, 'sources': sources,
                                'association': 'Exact published country, ISO subdivision and primary/common name; app anchor inside territorial polygon',
                                'notACurrentCadastralSurvey': True}}
                        for key, city in candidates.items():
                            lat, lon = city.get('latitude'), city.get('longitude')
                            if not isinstance(lat, (float, int)) or not isinstance(lon, (float, int)) or not crosswalk.scope_matches(city, area) or not geom.covers(shapely.Point(lon, lat)):
                                continue
                            index.db.execute('INSERT OR IGNORE INTO boundary_candidates VALUES(?,?,?,?)',
                                (key, identity, json.dumps(area, ensure_ascii=False), shapely.to_wkb(geom)))
                            matches += 1
            index.checkpoint('division:' + asset['id'], {'sourcePolygons': seen, 'candidateMappings': matches})
            w.save(root / ('division-ranges-' + asset['id'] + '.json'), transport.receipt())
            print(json.dumps({'stage': 'world_city_polygons', 'partition': asset['id'], 'examined': seen, 'candidateMappings': matches}), flush=True)
        except Exception as error:
            errors.append({'partition': asset['id'], 'reason': str(error)[:180]})
            w.save(root / ('division-ranges-failed-' + asset['id'] + '.json'), transport.receipt())
        finally:
            c.close()
            transport.close()
    with index.db:
        for key, in index.db.execute('SELECT DISTINCT city_key FROM boundary_candidates').fetchall():
            rows = index.db.execute('SELECT metadata,geometry FROM boundary_candidates WHERE city_key=?', (key,)).fetchall()
            hits = [{**json.loads(meta), 'geom': shapely.from_wkb(geom)} for meta, geom in rows]
            selected = hits[0] if len(hits) == 1 else crosswalk.contained_named_locality(cities[key], hits)
            if selected:
                add_area(index, selected, selected['geom'])
                index.db.execute('INSERT OR IGNORE INTO new_city_areas VALUES(?,?)', (key, selected['id']))
    return errors


def geometry_exports(index, root, cities, snapshot):
    folder = root / 'new-geography'
    folder.mkdir(exist_ok=True)
    old = {item['id']: item['payload'] for item in snapshot['geometryManifests']}
    groups = collections.defaultdict(list)
    for key, aid in index.db.execute('SELECT city_key,area_id FROM new_city_areas ORDER BY city_key'):
        city = cities[key]
        metadata, binary = index.db.execute('SELECT metadata,geometry FROM areas WHERE id=?', (aid,)).fetchone()
        area, geom = json.loads(metadata), shapely.from_wkb(binary)
        geometry = mapping(geom)
        west, south, east, north = geom.bounds
        area_key = w.hashlib.sha256((aid + json.dumps(geometry, separators=(',', ':'))).encode()).hexdigest()
        groups[(city['countryCode'], city['stateCode'])].append({**area, 'name': city['name'], 'state_name': city['stateName'],
            'city_id': city['id'], 'city_key': key, 'geometry': geometry, 'bounds': [south, north, west, east], 'area_key': area_key})
    manifests, uploads, used = [], [], 0
    for (cc, state), rows in groups.items():
        identity = 'geometry-v1:' + cc + ':' + state
        previous = old.get(identity, {'version': 1, 'countryCode': cc, 'stateCode': state, 'parts': [], 'notACurrentCadastralSurvey': True})
        parts, batch = [], []
        def flush():
            nonlocal used, batch
            if not batch:
                return
            data = {'version': 1, 'countryCode': cc, 'stateCode': state, 'areas': batch}
            body = json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode()
            if len(body) > 2*1024*1024 or used + len(body) > MAX_GEOMETRY or len(previous['parts']) + len(parts) >= 200:
                raise RuntimeError('new_geometry_free_storage_or_runtime_budget')
            digest = w.hashlib.sha256(body).hexdigest()
            file = folder / (cc + '-' + state + '-' + digest[:16] + '.json')
            file.write_bytes(body)
            key = f'geography/20261103/world-v1/{file.name}'
            part = {'url': w.ORIGIN + key, 'sha256': digest, 'bytes': len(body), 'cityIds': [a['city_id'] for a in batch]}
            parts.append(part)
            uploads.append({**part, 'file': file.name, 'key': key})
            used += len(body)
            batch = []
        for area in rows:
            if batch and (len(batch) >= 100 or sum(len(json.dumps(a).encode()) for a in batch) + len(json.dumps(area).encode()) > 1024*1024):
                flush()
            batch.append(area)
        flush()
        manifests.append({'id': identity, 'previousPayloadSha256': w.hashlib.sha256(json.dumps(previous, sort_keys=True, separators=(',', ':')).encode()).hexdigest() if identity in old else None,
            'payload': {**previous, 'parts': previous['parts'] + parts}})
    w.save(root / 'geometry-publication.json', {'version': 1, 'manifests': manifests, 'uploads': uploads,
        'bytes': used, 'existingPartsRetained': True})
    return uploads


def repair_legacy_overlap(index, folder):
    # The baseline worker never rewrites old canonical records. This scratch
    # reconciliation excludes only demonstrable legacy overlaps when counting
    # newly mapped cities, preserving every original source observation.
    if index.done('legacy_geographic_reconciliation'):
        return
    repaired = 0
    with gzip.open(folder / 'legacy-records.ndjson.gz', 'rt') as inp, index.db:
        for line in inp:
            row = json.loads(line)
            ident = w.identity(row['source'], row['source_id'], row['country_code'])
            found = index.db.execute('SELECT root FROM identities WHERE identity=?', (ident,)).fetchone()
            if not found:
                continue
            rid = found[0]
            old = index.db.execute('SELECT country,name,x,y,latitude,longitude,phone,address FROM roots WHERE id=?', (rid,)).fetchone()
            if not old:
                continue
            cc, name, x, y, lat, lon, phone, addr = old
            width = max(1, w.math.ceil(60/(111195*.002*max(.01,w.math.cos(lat*w.math.pi/180)))))
            for pid, plat, plon, pphone, paddr in index.db.execute('SELECT id,latitude,longitude,phone,address FROM roots WHERE country=? AND name=? AND x BETWEEN ? AND ? AND y BETWEEN ? AND ? AND id<? ORDER BY id', (cc,name,x-width,x+width,y-1,y+1,rid)):
                if w.h.distance((None,lat,lon),(None,plat,plon)) > 60 or addr and paddr and addr != paddr:
                    continue
                if w.h.phone_keys(phone,cc).intersection(w.h.phone_keys(pphone,cc)) or addr and addr == paddr:
                    index.db.execute('UPDATE identities SET root=? WHERE root=?', (pid,rid))
                    index.db.execute('UPDATE aliases SET root=? WHERE root=?', (pid,rid))
                    index.db.execute('DELETE FROM roots WHERE id=?', (rid,))
                    repaired += 1
                    break
    index.checkpoint('legacy_geographic_reconciliation', {'overlaps': repaired})


def coverage(index, root, folder, cities):
    with (folder / 'coverage.csv').open() as source:
        old = {row['city_key']: row for row in csv.DictReader(source)}
    if old.keys() != cities.keys():
        raise ValueError('coverage_full_inventory_mismatch')
    new_keys = dict(index.db.execute('SELECT city_key,area_id FROM new_city_areas'))
    all_keys = dict(index.db.execute('SELECT city_key,area_id FROM city_areas'))
    all_keys.update(new_keys)
    area_cities = collections.defaultdict(list)
    for key, aid in all_keys.items():
        area_cities[aid].append(key)
    new_ids = set(new_keys.values())
    totals, deltas = collections.Counter(), collections.Counter()
    country_stats = {}
    for cc in sorted({city['countryCode'] for city in cities.values()}):
        rows = index.db.execute('SELECT id,metadata,geometry FROM areas WHERE country=?', (cc,)).fetchall()
        rows = [row for row in rows if row[0] in area_cities]
        if not rows:
            continue
        geometries = [shapely.from_wkb(row[2]) for row in rows]
        areas = [json.loads(row[1]) for row in rows]
        by_id = {row[0]: geom for row, geom in zip(rows, geometries)}
        tree = shapely.STRtree(geometries)
        def assign(batch, counter, only):
            points = shapely.points(np.array([(lon,lat) for lat,lon in batch]))
            pairs = tree.query(points, predicate='intersects')
            hits = collections.defaultdict(list)
            for i, j in zip(*pairs):
                hits[int(i)].append(areas[int(j)])
            for matches in hits.values():
                for aid in w.policy.confirmed_admin_ids(matches, by_id):
                    if aid in only:
                        counter[aid] += 1
        promoted = 0
        with index.db:
            pending = index.db.execute('SELECT identity,payload FROM pending WHERE country=?', (cc,)).fetchall()
            for ident,payload in pending:
                row = json.loads(payload)
                point = shapely.Point(row['longitude'],row['latitude'])
                matches = [areas[int(j)] for j in tree.query(point,predicate='intersects')]
                accepted = w.policy.confirmed_admin_ids(matches,by_id)
                if not accepted:
                    continue
                row['location_verification'] = 'source_country_and_reviewed_territorial_city_polygon'
                row['verified_area_ids'] = accepted
                _,outcome = index.accept(row)
                promoted += outcome=='new_unique'
                index.db.execute('DELETE FROM pending WHERE identity=?',(ident,))
        if new_ids.intersection(by_id):
            cursor = index.db.execute('SELECT latitude,longitude FROM roots WHERE country=?', (cc,))
            while batch := cursor.fetchmany(2000):
                assign(batch, totals, new_ids)
        cursor = index.db.execute('SELECT r.latitude,r.longitude FROM additions a JOIN roots r ON r.id=a.root WHERE a.country=?', (cc,))
        while batch := cursor.fetchmany(2000):
            assign(batch, deltas, set(by_id)-new_ids)
        country_stats[cc] = {'newConfirmedCityScopes': sum(cities[k]['countryCode']==cc for k in new_keys),
            'newCoastalRecordsConfirmedByCityPolygons': promoted,
            'newUniqueBusinessesAssignedToExistingScopes': sum(deltas[a] for a in by_id),
            'businessesInNewScopes': sum(totals[a] for a in by_id)}
        print(json.dumps({'stage': 'polygon_membership', 'country': cc, **country_stats[cc]}), flush=True)
    metrics = collections.Counter()
    output = root / 'coverage-updates.ndjson'
    with output.open('w') as out, gzip.open(root / 'all-city-coverage.csv.gz', 'wt', newline='') as csvout:
        fields = list(next(iter(old.values())).keys())
        writer = csv.DictWriter(csvout, fieldnames=fields)
        writer.writeheader()
        for key, row in old.items():
            old_n = int(row['unique_supported']) if row['unique_supported'] else None
            aid = all_keys.get(key)
            count = totals[aid] if key in new_keys else old_n + deltas[aid] if old_n is not None else None
            if count is None:
                metrics['locationPending'] += 1
            else:
                metrics['confirmedCities'] += 1
                for threshold in (50,100,200):
                    metrics['met'+str(threshold)] += count >= threshold
                if count < 50:
                    metrics['confirmedBelow50'] += 1
            if count is not None and (old_n is None or count > old_n):
                sources = json.loads(row['sources'])
                sources.append({'source':'overture','stage':'world-20261103','rows':count-(old_n or 0)})
                limits = json.loads(row['limitations'])
                limits.append('world_full_record_import_partial')
                status = 'target_met' if count >= 50 else 'partial'
                update = {'city_key': key, 'previous_supported':old_n,'unique_supported': count, 'unique_all': count,
                    'source_rows': max(count, int(row['source_rows'] or 0)+(count-(old_n or 0))),
                    'category_count': int(row['category_count']) if row['category_count'] else None,
                    'sources': sources, 'limitations': limits, 'coverage_status': status,
                    'association_status': 'licensed_polygon_archive' if key in new_keys else row['association_status'],
                    'next_action': 'prioritize_other_under_50_cities' if count>=50 else 'complement_permitted_sources_for_under_50'}
                out.write(json.dumps(update, ensure_ascii=False, separators=(',', ':'))+'\n')
                row.update({k: json.dumps(v,ensure_ascii=False) if isinstance(v,list) else v for k,v in update.items() if k in row})
                metrics['citiesUpdated'] += 1
                metrics['newCitiesReaching50'] += count>=50 and (old_n is None or old_n<50)
            writer.writerow(row)
    return {'inventoryCities': len(cities), **metrics, 'countries': country_stats,
        'coveragePercentageAt50': round(100*metrics['met50']/len(cities), 6),
        'allCitiesAt50': metrics['met50']==len(cities), 'newCityMappings': len(new_keys)}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--root', default='.artifacts/ci-world-ingest')
    p.add_argument('--skip-new-polygons', action='store_true')
    a = p.parse_args()
    root = Path(a.root)
    started=time.monotonic()
    folder, _ = w.inputs(root)
    snapshot = json.loads((folder/'catalog-snapshot.json').read_text())
    cities = {row['key']:row for row in json.loads((folder/'inventory.json').read_text())['cities']}
    index = w.Index(root/'ingest.sqlite')
    index.db.execute('CREATE TABLE IF NOT EXISTS new_city_areas(city_key TEXT PRIMARY KEY,area_id TEXT) WITHOUT ROWID')
    if not index.done('legacy'):
        raise ValueError('actual_business_import_checkpoint_required')
    existing_geometry(index, folder, snapshot, root, cities)
    errors = [] if a.skip_new_polygons else discover_scopes(index, root, folder, cities)
    uploads = [] if a.skip_new_polygons else geometry_exports(index, root, cities, snapshot)
    repair_legacy_overlap(index, folder)
    report = coverage(index, root, folder, cities)
    report['sourceErrors'] = errors
    report['geometryBytes'] = sum(v['bytes'] for v in uploads)
    w.save(root/'geography-report.json', report)
    assets = w.export_assets(index,root,compact=True)
    serving=w.module('world_serving','catalog-world-serving.py')
    assets,serving_report=serving.repair(index,root,snapshot,assets)
    business_report = json.loads((root/'report.json').read_text())
    new_count = index.db.execute('SELECT count(*) FROM additions').fetchone()[0]
    business_report.update(newUniqueBusinesses=new_count,totalUniqueBusinessesConservative=5693290+new_count,
        businessBytes=sum(asset['bytes'] for asset in assets),assets=len(assets),geographicReport='geography-report.json',
        cityGeographicValidationPending=False,coverageAfterMet50=report['met50'],
        newCountries=dict(index.db.execute('SELECT country,count(*) FROM additions GROUP BY country')))
    business_report['newRecordQualityByCountry']=[dict(zip(['country','records','withPhone','withWebsite','withAddress','primaryCategories'],row))
        for row in index.db.execute("SELECT country,count(*),sum(json_extract(payload,'$.phone')<>''),sum(json_extract(payload,'$.website')<>''),sum(json_extract(payload,'$.address')<>''),count(DISTINCT json_extract(payload,'$.primary_category')) FROM additions GROUP BY country")]
    business_report.update(geographicAndServingElapsedMs=round((time.monotonic()-started)*1000),
        legacyAndOriginalRecordsPreserved=True,servingMetadataToRetire=serving_report['retireAssetIds'])
    w.save(root/'final-business-report.json',business_report)
    w.package(root,assets,business_report)
    publication=json.loads((root/'publication.json').read_text())
    publication.update(retireAssetIds=serving_report['retireAssetIds'],allNewAssetsRequireAtomicActivation=True,
        servingRepartitionProofs=serving_report['proofs'],oldAssetMutationCount=len(serving_report['retireAssetIds']),
        oldSourceRecordsChanged=0,oldObjectsDeleted=0)
    w.save(root/'publication.json',publication)
    # Small bundles can be validated and published on the 175MB interactive
    # workspace. Never require a world-sized download on the production host.
    bundles, batch, used = [], [], 0
    def flush():
        if not batch:
            return
        file = root/('geometry-bundle-'+str(len(bundles)).zfill(3)+'.zip')
        with w.zipfile.ZipFile(file,'w',compression=w.zipfile.ZIP_STORED) as archive:
            for item in batch:
                archive.write(root/'new-geography'/item['file'],item['file'])
        bundles.append({'file':file.name,'bytes':file.stat().st_size,'sha256':w.sha(file),'uploads':list(batch)})
    for item in uploads:
        if used+item['bytes']>32*1024*1024:
            flush();batch,used=[],0
        batch.append(item);used+=item['bytes']
    flush()
    w.save(root/'geography-bundles.json',{'version':1,'bundles':bundles})
    index.db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    index.db.close()
    print(json.dumps(report),flush=True)
    return 2 if errors else 0


if __name__=='__main__':
    raise SystemExit(main())

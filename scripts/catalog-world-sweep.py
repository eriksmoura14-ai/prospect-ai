"""One resumable source sweep for EVERY locality enumerated by Prospect AI.

Reads each cached publisher partition once, not once per city or segment. This
is a discovery/evidence stage: matching a published address label is a candidate,
never a substitute for the licensed polygon and cross-source reconciliation.
It cannot increase verified coverage or mark an empty source response exhausted.
Cached reads are offline. Optional bounded HTTPS column reads cover uncached
partitions. No Nominatim, production writes, whole-file downloads, or billing.
"""
import argparse
import collections
import csv
import fcntl
import gzip
import hashlib
import importlib.util
import json
import re
import shutil
import sqlite3
import time
import unicodedata
from pathlib import Path
from urllib.parse import urlsplit

RELEASE = '2026-10-21.0'
RESERVE = 32 * 1024 * 1024
MAX_STATE_BYTES = 160 * 1024 * 1024


def normal(value):
    text = unicodedata.normalize('NFKD', value or '')
    return ' '.join(''.join(c.lower() if c.isalnum() else ' '
                          for c in text if not unicodedata.category(c).startswith('M')).split())


def digest(path):
    with Path(path).open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def save(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2))
    temporary.replace(path)


def validate_inventory(inventory, baseline):
    cities = inventory['cities']
    keys = [city['key'] for city in cities]
    if len(set(keys)) != len(keys) or set(keys) != set(baseline):
        raise ValueError('complete_app_inventory_and_coverage_keys_must_match')
    for city in cities:
        if city['key'] != f"{city['countryCode']}:{city['stateCode']}:{city['id']}":
            raise ValueError('city_identity_mismatch')
    return cities


def candidate_lookup(cities):
    lookup = collections.defaultdict(set)
    for city in cities:
        # No nearest town, fuzzy spelling, parent district, or shared-country
        # fallback. Ambiguous same-state names remain explicitly unresolved.
        for state in (city['stateCode'], city['stateName'], city['countryCode'] + '-' + city['stateCode']):
            lookup[(city['countryCode'], normal(state), normal(city['name']))].add(city['key'])
    return lookup


def candidate_keys(lookup, country, state, city):
    return lookup.get((country, normal(state), normal(city)), set()) if state and city else set()


def collect_parts(plan):
    if isinstance(plan, dict):
        if plan.get('version') != 1 or plan.get('release') != RELEASE:
            raise ValueError('pinned_world_source_plan_required')
        sources = {part['id']: part for part in plan['partitions']}
        if len(sources) != len(plan['partitions']):
            raise ValueError('duplicate_source_partition')
        plan = [{'country': row['country'], 'parts': [sources[identity] for identity in row['partitionIds']]}
                for row in plan['countries']]
    countries = {}
    parts = {}
    for row in plan:
        cc = row['country']
        if cc in countries or not re.fullmatch('[A-Z]{2}', cc):
            raise ValueError('country_plan_identity')
        countries[cc] = row
        for part in row.get('parts', []):
            parsed = urlsplit(part['url'])
            if (parsed.scheme != 'https' or parsed.netloc != 'overturemaps-us-west-2.s3.us-west-2.amazonaws.com'
                    or not parsed.path.startswith('/release/' + RELEASE + '/theme=places/type=place/')
                    or parsed.query or parsed.fragment or not re.fullmatch('[0-9]{5}', part['id'])):
                raise ValueError('unreviewed_source_partition')
            if part['id'] in parts and any(parts[part['id']][key] != part[key] for key in ('url', 'bytes')):
                raise ValueError('conflicting_partition_identity')
            if part['id'] not in parts or part.get('cache'):
                parts[part['id']] = part
    return countries, parts


def room(root):
    state = root / 'sweep.sqlite'
    if state.exists() and state.stat().st_size > MAX_STATE_BYTES:
        raise RuntimeError('world_sweep_state_budget_checkpoint_preserved')
    if shutil.disk_usage(root).free < RESERVE + 8 * 1024 * 1024:
        raise RuntimeError('world_sweep_disk_reserve_checkpoint_preserved')


def scan_part(db, part, root, groups, remote=False):
    import duckdb
    previous = db.execute('SELECT sha256 FROM completed_parts WHERE id=?', (part['id'],)).fetchone()
    transport = None
    if remote:
        if previous:
            return {'id': part['id'], 'reusedCheckpoint': True, 'sourceIdentityPinnedByInputFingerprint': True}
        if any(json.loads(path.read_text()).get('retryAfterUnix', 0) > time.time()
               for path in root.glob('source-ranges-failed-*.json')):
            raise RuntimeError('places_source_shared_cooldown')
        if len(list(root.glob('source-ranges-failed-' + part['id'] + '*.json'))) >= 3:
            raise RuntimeError('places_source_maximum_three_attempts_checkpoint_preserved')
        spec = importlib.util.spec_from_file_location('place_ranges', Path(__file__).with_name('catalog-place-ranges.py'))
        ranges = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(ranges)
        transport = ranges.PlaceRanges(part, read_ahead_bytes=4 * 1024 * 1024, scratch_root=root)
        source = transport.start()
        receipt = {'url': part['url'], 'bytes': part['bytes'], 'projectedColumnRead': True, 'fullFileSha256Verified': False}
    else:
        folder = Path(part['cache'])
        source = folder / 'regional-source.parquet'
        receipt = json.loads((folder / 'download-report.json').read_text())
        if (receipt['release'] != RELEASE or receipt['url'] != part['url']
                or source.stat().st_size != part['bytes'] or receipt['bytes'] != part['bytes']
                or digest(source) != receipt['sha256']):
            raise ValueError('cached_partition_integrity')
    if previous:
        if previous[0] != receipt['sha256']:
            raise ValueError('completed_partition_changed')
        return {'id': part['id'], 'reusedCheckpoint': True}
    spec = importlib.util.spec_from_file_location('world_sweep_norm', Path(__file__).with_name('catalog-normalize.py'))
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    started = time.monotonic()
    c = duckdb.connect(config={'memory_limit': '192MB', 'threads': '1', 'max_temp_directory_size': '0B',
                               'autoinstall_known_extensions': 'false', 'autoload_known_extensions': 'false'})
    if remote:
        c.execute('LOAD httpfs')
        c.execute('SET http_timeout=35;SET http_retries=0;SET enable_http_metadata_cache=true')
    # Depend on the selected taxonomy as well as the WKB. This keeps DuckDB
    # from pushing the Python check below the commercial-taxonomy join and
    # invoking it on millions of unrelated source objects.
    c.create_function('valid_point', lambda value, niche: niche is not None and helper.point(value) is not None,
                      ['BLOB', 'VARCHAR'], 'BOOLEAN')
    # CASE values are reviewed taxonomy constants, SQL-quoted independently of
    # shell quoting. Parameters carry all paths and source allowlists.
    quote = lambda value: "'" + value.replace("'", "''") + "'"
    literal_list = lambda values: '[' + ','.join(quote(value) for value in values) + ']'
    clauses = []
    for niche, values in groups.items():
        choices = literal_list(values)
        clauses.append(f'WHEN list_has_any(taxonomy.hierarchy,{choices}) OR list_contains({choices},taxonomy.primary) '
                       f'OR list_has_any(taxonomy.alternates,{choices}) OR list_contains({choices},basic_category) THEN {quote(niche)}')
    niche_sql = 'CASE ' + ' '.join(clauses) + ' ELSE NULL END'
    query = """SELECT upper(addresses[1].country) AS cc,coalesce(addresses[1].region,'') AS region,
      coalesce(addresses[1].locality,'') AS locality,t.niche AS niche,count(*) AS observations,
      count(*) FILTER(WHERE len(phones)>0) AS published_phone_fields,
      count(*) FILTER(WHERE len(websites)>0) AS published_website_fields
      FROM read_parquet(?) p JOIN supported_taxonomies t
        ON p.taxonomy IS NOT DISTINCT FROM t.taxonomy AND p.basic_category IS NOT DISTINCT FROM t.basic_category
      WHERE id IS NOT NULL AND length(trim(names.primary)) BETWEEN 1 AND 400
      AND (confidence IS NULL OR confidence BETWEEN 0.5 AND 1)
      AND coalesce(operating_status,'unknown')<>'permanently_closed'
      AND upper(addresses[1].country)=ANY(?)
      AND len(sources)>0 AND len(list_filter(sources,s -> s.dataset IS NULL OR NOT list_contains(?,lower(s.dataset))
          OR NOT list_contains(?,coalesce(nullif(s.license,''),CASE lower(s.dataset)
             WHEN 'foursquare' THEN 'Apache-2.0' WHEN 'alltheplaces' THEN 'CC0-1.0' ELSE 'CDLA-Permissive-2.0' END))))=0
      AND valid_point(geometry,t.niche) GROUP BY cc,region,locality,niche"""
    if remote:
        # A second full row-group traversal is expensive over HTTPS. Classify
        # inline in the single remote pass. NULL niche values never enter the
        # Python point UDF, preserving the same commercial filter as the join.
        query = query.replace('FROM read_parquet(?) p JOIN supported_taxonomies t\n        ON p.taxonomy IS NOT DISTINCT FROM t.taxonomy AND p.basic_category IS NOT DISTINCT FROM t.basic_category',
                              'FROM (SELECT *,' + niche_sql + ' AS __prospect_niche FROM read_parquet(?)) p')
        query = query.replace('t.niche', 'p.__prospect_niche')
    countries = sorted({city[0] for city in db.execute('SELECT DISTINCT country FROM app_cities')})
    rows = observations = 0
    try:
        # Classify each distinct taxonomy tuple once. Evaluating the 24 niche
        # rules for every publisher row was needlessly quadratic in the number
        # of selectors; this preserves rule priority and all alternate labels.
        if not remote:
            c.execute('CREATE TEMP TABLE taxonomies AS SELECT DISTINCT taxonomy,basic_category FROM read_parquet(?)', [str(source)])
            c.execute('CREATE TEMP TABLE supported_taxonomies AS SELECT * FROM (SELECT taxonomy,basic_category,' + niche_sql + ' AS niche FROM taxonomies) WHERE niche IS NOT NULL')
            c.execute('DROP TABLE taxonomies')
        cursor = c.execute(query, [str(source), countries, helper.KNOWN, helper.LICENSES])
        with db:
            while True:
                batch = cursor.fetchmany(500)
                if not batch:
                    break
                room(root)
                db.executemany('INSERT INTO locality_evidence VALUES(?,?,?,?,?,?,?,?)',
                               [(part['id'], *value) for value in batch])
                rows += len(batch)
                observations += sum(value[4] for value in batch)
            if remote:
                transport_receipt = transport.receipt()
                save(root / ('source-ranges-' + part['id'] + '.json'), transport_receipt)
                identity = hashlib.sha256(json.dumps({'url': part['url'], 'bytes': part['bytes'], 'etag': transport_receipt['etag']}, sort_keys=True).encode()).hexdigest()
            else:
                identity = receipt['sha256']
            result = {'id': part['id'], 'sourceIdentityHash': identity, 'bytes': receipt['bytes'],
                      'localityCategoryGroups': rows, 'eligibleSourceObservations': observations,
                      'elapsedMs': round((time.monotonic() - started) * 1000),
                      'fullFileSha256Verified': not remote, 'networkBytes': transport.received if remote else 0}
            db.execute('INSERT INTO completed_parts VALUES(?,?,?)', (part['id'], identity, json.dumps(result)))
    except Exception:
        if remote:
            attempt = len(list(root.glob('source-ranges-failed-' + part['id'] + '*.json'))) + 1
            save(root / ('source-ranges-failed-' + part['id'] + '-' + str(attempt) + '.json'), transport.receipt())
        if remote and transport.errors:
            raise RuntimeError(transport.errors[0])
        raise
    finally:
        c.close()
        if transport:
            transport.close()
    return result


def export_report(db, root, cities, baseline, country_plan, parts, inputs, inventory_meta=None):
    lookup = candidate_lookup(cities)
    evidence = collections.Counter()
    by_niche = collections.defaultdict(collections.Counter)
    ambiguity = collections.Counter()
    unmatched = 0
    for cc, state, name, niche, count in db.execute('SELECT country,region,locality,niche,sum(observations) FROM locality_evidence GROUP BY country,region,locality,niche'):
        keys = candidate_keys(lookup, cc, state, name)
        if len(keys) == 1:
            key = next(iter(keys))
            evidence[key] += count
            by_niche[key][niche] += count
        elif len(keys) > 1:
            for key in keys:
                ambiguity[key] += count
        else:
            unmatched += count
    completed = {row[0] for row in db.execute('SELECT id FROM completed_parts')}
    country_stats = collections.defaultdict(collections.Counter)
    statuses = collections.Counter()
    target_met = 0
    with gzip.open(root / 'all-app-cities.ndjson.gz', 'wt') as out:
        for city in cities:
            key, cc = city['key'], city['countryCode']
            old = baseline[key]
            boundary_plan_pending = not country_plan.get(cc, {}).get('parts')
            # Small/dependent territories absent from Natural Earth's country
            # shapes are still searched by their published country code across
            # all partitions. This is no invented administrative polygon.
            required = {part['id'] for part in country_plan.get(cc, {}).get('parts', [])} or set(parts)
            missing = sorted(required - completed)
            n = old['unique_supported']
            status = ('target_met_existing' if n is not None and n >= 50 else
                      'candidate_records_require_geographic_reconciliation' if evidence[key] else
                      'ambiguous_published_locality' if ambiguity[key] else
                      'country_boundary_plan_pending' if boundary_plan_pending else
                      'source_partitions_pending' if missing else
                      'no_exact_address_match_not_evidence_of_absence')
            result = {'cityKey': key, 'countryCode': cc, 'stateCode': city['stateCode'], 'name': city['name'],
                      'confirmedUniqueBusinessesBeforeSweep': n, 'confirmedCoverageStatus': old['coverage_status'],
                      'sweepStatus': status, 'candidateSourceObservations': evidence[key],
                      'candidateObservationsByNiche': dict(by_niche[key]), 'ambiguousSourceObservations': ambiguity[key],
                      'sourcePartitionsExamined': sorted(required & completed), 'sourcePartitionsPending': missing,
                      'sourcePlanComplete': bool(required) and not missing,
                      'countryBoundaryPlanPending': boundary_plan_pending,
                      'nextAction': ('preserve_existing_confirmed_catalog' if status == 'target_met_existing' else
                                     'licensed_polygon_and_cross_source_business_reconciliation' if evidence[key] else
                                     'resolve_same_state_name_ambiguity' if ambiguity[key] else
                                     'review_territory_boundary_and_published_country_identity' if boundary_plan_pending else
                                     'resume_unfinished_source_partitions_within_resource_budget' if missing else
                                     'complement_permitted_sources_and_review_address_aliases'),
                      'candidateCountsAreNotUniqueBusinesses': True, 'targetNewlyProven': False}
            out.write(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n')
            statuses[status] += 1
            country_stats[cc]['appCities'] += 1
            country_stats[cc]['citiesWithCandidateObservations'] += int(evidence[key] > 0)
            country_stats[cc]['sourcePlanFullyExamined'] += int(bool(required) and not missing)
            country_stats[cc]['confirmedAtLeast50'] += int(n is not None and n >= 50)
            target_met += int(n is not None and n >= 50)
    scanned_observations = db.execute('SELECT coalesce(sum(observations),0) FROM locality_evidence').fetchone()[0]
    reused_parts = [(row[0], json.loads(row[1])) for row in db.execute('SELECT id,receipt FROM completed_parts')
                    if json.loads(row[1]).get('seedReused')]
    report = {'id': 'all-app-city-source-sweep-v1', 'asOf': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'scope': 'every_enumerated_app_city_no_selected_country_subset', 'inputs': inputs,
              'inventoryCities': len(cities), 'inventoryCountries': len(country_stats),
              'inventorySubdivisionsWithCities': len({(city['countryCode'], city['stateCode']) for city in cities}),
              'confirmedCitiesAtLeast50Unchanged': target_met,
              'confirmedCoveragePercent': round(100 * target_met / len(cities), 4),
              'newUniqueBusinessesPublished': 0, 'sourceObservationsExamined': scanned_observations,
              'sourcePartitionsReusedFromSeed': [row[0] for row in reused_parts],
              'sourceObservationsReusedFromSeed': sum(row[1]['eligibleSourceObservations'] for row in reused_parts),
              'sourceObservationsMatchedUnambiguouslyToAddressLabels': sum(evidence.values()),
              'unmatchedSourceObservationsRetainedInSweepDatabase': unmatched,
              'citiesWithCandidateObservations': sum(value > 0 for value in evidence.values()),
              'belowTargetCitiesWithCandidateObservations': sum(value > 0 and (baseline[key]['unique_supported'] or 0) < 50 for key, value in evidence.items()),
              'statuses': dict(statuses), 'sourcePartitionsRequired': len(parts), 'sourcePartitionsExamined': sorted(completed),
              'sourcePartitionsPending': sorted(set(parts) - completed),
              'sourceSweepComplete': set(parts) == completed,
              'countries': [{'countryCode': cc, **dict(value)} for cc, value in sorted(country_stats.items())],
              'resultsSha256': digest(root / 'all-app-cities.ndjson.gz'),
              'resultsBytes': (root / 'all-app-cities.ndjson.gz').stat().st_size,
              'sourceObservationsAreNotUniqueBusinesses': True, 'publishedPhonesAndWebsitesNotVerified': True,
              'noAddressMatchDoesNotMeanNoBusinesses': True, 'productionCoverageUnchanged': True,
              'networkBytes': sum(json.loads(row[0]).get('networkBytes', 0) for row in db.execute('SELECT receipt FROM completed_parts')) +
                              sum(json.loads(path.read_text()).get('networkBytes', 0) for path in root.glob('source-ranges-failed-*.json')),
              'nominatimRequests': 0, 'paidServicesEnabled': False,
              'backgroundProcessConfigured': False, 'sweepDatabaseBytes': (root / 'sweep.sqlite').stat().st_size}
    if inventory_meta is not None:
        report.update(allSelectableAppCountries=len(inventory_meta['countries']),
                      allSelectableAppSubdivisions=len(inventory_meta['states']),
                      selectorCountriesWithoutEnumeratedCities=sorted({country['code'] for country in inventory_meta['countries']} - set(country_stats)))
    save(root / 'report.json', report)
    return report


def import_seed(db, root, path, expected_sha, parts, countries, niches_sha, niche_names):
    """Reuse verified locality aggregates, never import them as businesses."""
    if not re.fullmatch('[a-f0-9]{64}', expected_sha or '') or digest(path) != expected_sha:
        raise ValueError('source_seed_sha256_mismatch')
    with gzip.open(path, 'rt') as source:
        header = json.loads(source.readline(200000))
        if (header['version'] != 1 or header['release'] != RELEASE or header['individualBusinesses'] is not False
                or header['countryCodes'] != sorted(countries) or header['nichesSha256'] != niches_sha):
            raise ValueError('source_seed_scope_mismatch')
        prepared = {}
        existing = dict(db.execute('SELECT id,sha256 FROM completed_parts'))
        for value in header['parts']:
            identity = value['id']
            if (identity in prepared or identity not in parts or value['url'] != parts[identity]['url']
                    or value['bytes'] != parts[identity]['bytes'] or not re.fullmatch('[a-f0-9]{64}', value['sha256'])):
                raise ValueError('source_seed_partition_identity')
            if identity in existing and existing[identity] != value['sha256']:
                raise ValueError('source_seed_existing_checkpoint_conflict')
            prepared[identity] = value
        totals = collections.Counter()
        rows = 0
        batch = []
        with db:
            for line in source:
                if len(line) > 20000:
                    raise ValueError('source_seed_row_budget')
                value = json.loads(line)
                if (not isinstance(value, list) or len(value) != 8 or not all(isinstance(v, str) for v in value[:5])
                        or value[0] not in prepared or value[1] not in countries or value[4] not in niche_names
                        or not all(type(v) is int for v in value[5:]) or value[5] < 1
                        or not 0 <= value[6] <= value[5] or not 0 <= value[7] <= value[5]):
                    raise ValueError('source_seed_invalid_observation')
                rows += 1
                totals[value[0]] += value[5]
                if value[0] not in existing:
                    batch.append(value)
                if len(batch) >= 3000:
                    room(root)
                    db.executemany('INSERT INTO locality_evidence VALUES(?,?,?,?,?,?,?,?)', batch)
                    batch.clear()
            room(root)
            db.executemany('INSERT INTO locality_evidence VALUES(?,?,?,?,?,?,?,?)', batch)
            if rows != header['rows'] or sum(totals.values()) != header['sourceObservations']:
                raise ValueError('source_seed_observation_totals')
            for identity, value in prepared.items():
                if totals[identity] != value['receipt']['eligibleSourceObservations']:
                    raise ValueError('source_seed_partition_totals')
                if identity not in existing:
                    receipt = {**value['receipt'], 'seedReused': True, 'networkBytes': 0,
                               'sourceOriginalElapsedMs': value['receipt']['elapsedMs'], 'elapsedMs': 0}
                    db.execute('INSERT INTO completed_parts VALUES(?,?,?)', (identity, value['sha256'], json.dumps(receipt)))
    return {'seedSourcesReused': len(prepared), 'seedSourceObservations': sum(totals.values()),
            'seedRows': rows, 'newVerifiedBusinesses': 0}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--inventory', required=True)
    p.add_argument('--baseline', required=True)
    p.add_argument('--source-plan', required=True)
    p.add_argument('--niches', required=True)
    p.add_argument('--root', required=True)
    p.add_argument('--read-remote-missing', action='store_true', help='Read projected columns with pinned public HTTPS ranges; no whole-file download')
    p.add_argument('--seed')
    p.add_argument('--seed-sha256')
    args = p.parse_args()
    root = Path(args.root)
    root.mkdir(parents=True, exist_ok=True)
    inputs = {key: {'file': str(getattr(args, key)), 'sha256': digest(getattr(args, key))}
              for key in ('inventory', 'baseline', 'source_plan', 'niches')}
    if args.seed:
        inputs['seed'] = {'file': args.seed, 'sha256': digest(args.seed)}
        if inputs['seed']['sha256'] != args.seed_sha256:
            raise ValueError('source_seed_sha256_mismatch')
    fingerprint = hashlib.sha256(json.dumps(inputs, sort_keys=True).encode()).hexdigest()
    with (root / 'sweep.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        baseline = {}
        with Path(args.baseline).open() as source:
            for row in csv.DictReader(source):
                if row['city_key'] in baseline:
                    raise ValueError('duplicate_coverage_city_key')
                baseline[row['city_key']] = {'unique_supported': int(row['unique_supported']) if row['unique_supported'] else None,
                                             'coverage_status': row['coverage_status']}
        inventory = json.loads(Path(args.inventory).read_text())
        cities = validate_inventory(inventory, baseline)
        country_plan, parts = collect_parts(json.loads(Path(args.source_plan).read_text()))
        if set(country_plan) != {city['countryCode'] for city in cities}:
            raise ValueError('source_plan_must_cover_every_app_country_with_cities')
        room(root)
        db = sqlite3.connect(root / 'sweep.sqlite')
        db.executescript('''PRAGMA cache_size=-4096; PRAGMA temp_store=MEMORY;
          CREATE TABLE IF NOT EXISTS metadata(fingerprint TEXT PRIMARY KEY);
          CREATE TABLE IF NOT EXISTS app_cities(city_key TEXT PRIMARY KEY,country TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS completed_parts(id TEXT PRIMARY KEY,sha256 TEXT NOT NULL,receipt TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS locality_evidence(part TEXT,country TEXT,region TEXT,locality TEXT,niche TEXT,
             observations INTEGER,phone_fields INTEGER,website_fields INTEGER);''')
        previous = db.execute('SELECT fingerprint FROM metadata').fetchone()
        if previous and previous[0] != fingerprint:
            raise ValueError('changed_inventory_or_sources_require_new_sweep_root')
        with db:
            db.execute('INSERT OR IGNORE INTO metadata VALUES(?)', (fingerprint,))
            db.executemany('INSERT OR IGNORE INTO app_cities VALUES(?,?)', [(city['key'], city['countryCode']) for city in cities])
        groups = json.loads(Path(args.niches).read_text())
        if args.seed:
            print(json.dumps(import_seed(db, root, args.seed, args.seed_sha256, parts, country_plan,
                                         inputs['niches']['sha256'], set(groups))), flush=True)
        progress = {'scopeCities': len(cities), 'scopeCountries': len(country_plan), 'countrySubsetSelected': False,
                    'fingerprint': fingerprint, 'parts': {}, 'backgroundProcessConfigured': False}
        for identity, part in sorted(parts.items()):
            room(root)
            try:
                if not part.get('cache') or not (Path(part['cache']) / 'regional-source.parquet').is_file():
                    if args.read_remote_missing:
                        result = scan_part(db, part, root, groups, remote=True)
                        result['state'] = 'source_examined'
                    else:
                        result = {'id': identity, 'state': 'source_not_cached', 'requiredBytes': part['bytes'],
                                  'automaticDownloadAttempted': False}
                else:
                    result = scan_part(db, part, root, groups)
                    result['state'] = 'source_examined'
            except RuntimeError as error:
                result = {'id': identity, 'state': 'temporary_failure', 'reason': str(error)[:180],
                          'sourcesExhausted': False}
            progress['parts'][identity] = result
            save(root / 'progress.json', progress)
            print(json.dumps(result), flush=True)
        report = export_report(db, root, cities, baseline, country_plan, parts, inputs, inventory_meta=inventory)
        db.close()
        print(json.dumps({key: value for key, value in report.items() if key not in ('countries', 'inputs')}), flush=True)


if __name__ == '__main__':
    main()

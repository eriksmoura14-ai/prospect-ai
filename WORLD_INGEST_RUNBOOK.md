# Full-record world import — 2026-11-03

This is an incremental import, not a replacement catalog. The baseline contains
5,680,824 ready archive rows and 12,466 additional conservative legacy identities:
5,693,290 estimated unique businesses. Its 294 ready objects total 746,341,508
bytes. The full app inventory is 152,970 localities in 223 countries/territories.
At the start, 12,923 localities meet 50. These are baseline figures, not claims
that the new import is complete.

## Actual execution

- Full-record source job: https://github.com/eriksmoura14-ai/prospect-ai/actions/runs/41637339762
- Geographic confirmation job: https://github.com/eriksmoura14-ai/prospect-ai/actions/runs/41641854337
- Branch: `codex/coverage-audit-policy-20261026`; production code and UI are unchanged.
- The earlier November 2 sweep collected **locality/category observation counts**.
  Those counts never proved distinct businesses or geographic membership. The
  November 3 worker reads full names, coordinates, addresses, public contacts,
  IDs, per-provider licenses and collection timestamps.

The first job indexes the original immutable assets on disk, reads all sixteen
pinned Overture Places partitions once, and preserves original source identities.
OSM via QLever/Overpass/Geofabrik shares the `osm` identity family. Other overlaps
require the same normalized name, country, distance within 60m, and a shared
published phone or matching non-conflicting address. Similar names alone never
merge branches. Full pending coastal records remain separate until a reviewed
city polygon can confirm them.

The second job reuses all native and archived polygons and adds territorial
Overture locality/localadmin polygons only when country, exact ISO subdivision,
reviewed primary/common names and an app anchor inside the polygon agree.
Ambiguous peers stay pending. Existing approved district/municipality policies
remain explicit. No nearest-city, parent-county or fixed-radius quota filling.

New records are collected even without a phone or website. Missing website data
means insufficient information. Published contact fields are not evidence of an
active WhatsApp account or successful website verification.

## Free resource guards

- Existing bucket, project and isolated public `catalog_ops` database only.
- PostgreSQL guard: 220 MiB; effective free logical quota remains 256 MiB.
- Object storage quota: 5,000,000,000 bytes/project; observed baseline storage:
  2,991,502,823 bytes. Never delete the old archive to create room.
- Period transfer quota: 5,000,000,000 bytes, with a 50 MiB app reserve.
- New business output: at most 650 MiB; new geometry: at most 256 MiB.
- Incremental serving repair: at most 256 MiB extra old-object reads and
  128 MiB rewritten serving output. Full verification reads are reserved too.
- Public standard Ubuntu GitHub runners; no larger runner or paid API is enabled.
- SQLite reconciliation on disk; DuckDB 256–384 MiB, one source partition at a
  time. Completed immutable objects are downloaded by size and SHA-256.
- Publisher processes one at-most-64-MiB bundle at a time, four transfers at most.
- No bulk use of public Nominatim and no per-city repetition of regional inputs.

Operations manifests `capacity-ledger:20261103:world-full-records-v1` and
`capacity-ledger:20261103:world-serving-repair-v1` reserve conservative ceilings;
they are not measured invoices. Refresh actual usage before every publication
and do not add a reservation to measured usage as if both were consumption.

## Publication

Only public inputs go to GitHub. Private SQL and presigned upload selectors stay
local, mode 0600; neither is accepted by the data collection workers. No database
credential belongs in frontend variables or committed configuration.

Download `publication.json`, `geometry-publication.json`,
`geography-bundles.json`, `coverage-updates.ndjson`, reports and serving proof
from the completed geographic release. Save them under an operator root also
containing the original `catalog-snapshot.json`. For each bundle, create a private
upload selector with an `uploads` list (`key`, `url`, `method`, `headers`) using
Neon's upload presigner for the exact immutable object keys. Supply a fresh
capacity JSON containing `projectId`, `observedAtUnix`, `transferQuotaBytes`,
`storageQuotaBytes`, `storageCommittedBytes`, `transferCommittedBytes`.

```sh
python scripts/catalog-world-publish.py --kind businesses \
  --root "$WORLD_ROOT" --manifest "$WORLD_ROOT/publication.json" \
  --bundle-index 0 --release-base "$WORLD_RELEASE" \
  --database-config .env.coverage-operations --upload-config .env.world-upload \
  --capacity-config "$WORLD_ROOT/capacity.json"
```

Repeat for every business bundle. For geometry use `--kind geography` and
`--manifest "$WORLD_ROOT/geography-bundles.json"`. The publisher validates each
bundle and member, uploads immutable keys, reads the full remote content back,
and registers business metadata as **staging**. Original ready assets stay active.

```sh
python scripts/catalog-world-activate.py assets --root "$WORLD_ROOT" --database-config .env.coverage-operations
python scripts/catalog-world-activate.py geography --root "$WORLD_ROOT" --database-config .env.coverage-operations
python scripts/catalog-world-activate.py coverage --root "$WORLD_ROOT" --database-config .env.coverage-operations
python scripts/catalog-world-activate.py audit --root "$WORLD_ROOT" --database-config .env.coverage-operations
```

The asset switch is one guarded SQL statement. Serving repair preserves every
original field and ID and retains the old objects; only selected old **serving
metadata** becomes retired. Replacement rows containing old records are not
counted as newly discovered companies. Activation requires reconciled totals and
the serving count/hash-sum/hash-xor proofs. City updates compare the previous
count, never reduce it, and checkpoint every 100 rows. Ordinary vacuum can reuse
dead pages; no FULL vacuum or quota increase is performed. A guard stops safely
if the small database fills.

## Resume and verification

The source job retains a temporary Actions SQLite checkpoint. The geographic
release also contains numbered compressed SQLite parts and a SHA-256 manifest.
On a sufficiently sized public runner, verify every part, concatenate in the
manifest order and decompress to `.artifacts/ci-world-ingest/ingest.sqlite`.
Then continue the same source/geometry release and original fingerprint:

```sh
python scripts/catalog-world-ingest.py --root .artifacts/ci-world-ingest
python scripts/catalog-world-geography.py --root .artifacts/ci-world-ingest
```

These commands skip completed immutable source checkpoints. A newer publisher
release or changed baseline requires a separate reviewed version, not silently
changing the fingerprint. There is no endless worldwide process. The linked
Actions jobs are finite and their current status must be checked before claiming
work is still running.

Compare `final-business-report.json`, `geography-report.json`,
`published-world-audit.json` and real staging `/api/catalog/page` responses.
The denominator for every city coverage percentage is **152,970**, including
unprocessed/pending cities. The report distinguishes collection from geographic
confirmation. Never announce all cities at 50 unless the actual database audit
returns that result. No source can guarantee fifty real supported businesses in
every tiny settlement; below-target and pending locations remain explicit.

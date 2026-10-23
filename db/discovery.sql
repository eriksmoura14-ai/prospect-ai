-- Apply explicitly to an isolated discovery database; never loaded by auth.
BEGIN;
SELECT pg_advisory_xact_lock(741326952);
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TABLE IF NOT EXISTS discovery_areas (
  key text PRIMARY KEY, location_key text NOT NULL, country_code char(2) NOT NULL,
  geom geometry(MultiPolygon,4326) NOT NULL CHECK(ST_IsValid(geom)),
  payload jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS discovery_areas_location ON discovery_areas(location_key,updated_at DESC);
CREATE INDEX IF NOT EXISTS discovery_areas_geometry ON discovery_areas USING gist(geom);
-- Source records stay separate: a query combines them without erasing licenses.
CREATE TABLE IF NOT EXISTS discovery_records (
  id uuid PRIMARY KEY, source text NOT NULL, source_id text NOT NULL,
  name text NOT NULL, normalized_name text NOT NULL, category text NOT NULL,
  country_code char(2) NOT NULL, state text NOT NULL DEFAULT '', city text NOT NULL DEFAULT '', address text NOT NULL DEFAULT '',
  geom geometry(Point,4326) NOT NULL, phone text NOT NULL DEFAULT '', website text NOT NULL DEFAULT '',
  license jsonb NOT NULL, payload jsonb NOT NULL,
  discovered_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_verified_at timestamptz, confidence double precision, opportunity_score integer,
  verification_status text NOT NULL DEFAULT 'needs_verification',
  UNIQUE(source,source_id), CHECK(confidence IS NULL OR confidence BETWEEN 0 AND 1),
  CHECK(source IN ('overpass','qlever','geofabrik','overture'))
);
CREATE INDEX IF NOT EXISTS discovery_records_geometry ON discovery_records USING gist(geom);
CREATE INDEX IF NOT EXISTS discovery_records_country_category ON discovery_records(country_code,category);
CREATE INDEX IF NOT EXISTS discovery_records_identity ON discovery_records(country_code,normalized_name);
CREATE INDEX IF NOT EXISTS discovery_records_seen ON discovery_records(last_seen_at);
CREATE TABLE IF NOT EXISTS discovery_coverage (
  area_key text NOT NULL REFERENCES discovery_areas(key) ON DELETE CASCADE,
  niche text NOT NULL, source text NOT NULL, complete boolean NOT NULL DEFAULT false,
  checked_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  records integer NOT NULL, outcome text NOT NULL, PRIMARY KEY(area_key,niche,source)
);
CREATE TABLE IF NOT EXISTS discovery_tasks (
  id uuid PRIMARY KEY, owner_id text NOT NULL, area_key text NOT NULL REFERENCES discovery_areas(key), niche text NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','done','failed')),
  checkpoint jsonb NOT NULL DEFAULT '{}', attempts integer NOT NULL DEFAULT 0,
  lease_token uuid, lease_until timestamptz, run_after timestamptz NOT NULL DEFAULT now(), error_code text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS discovery_tasks_single_active ON discovery_tasks(area_key,niche) WHERE state IN ('queued','running');
CREATE INDEX IF NOT EXISTS discovery_tasks_due ON discovery_tasks(run_after,created_at) WHERE state IN ('queued','running');
CREATE INDEX IF NOT EXISTS discovery_tasks_owner ON discovery_tasks(owner_id,created_at DESC);
COMMIT;

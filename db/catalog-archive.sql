-- Separate public catalog operations database. Never apply to authentication.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TABLE IF NOT EXISTS catalog_assets (
 id text PRIMARY KEY, url text NOT NULL, sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 bytes bigint NOT NULL CHECK(bytes BETWEEN 0 AND 1073741824), records bigint NOT NULL CHECK(records>=0),
 countries text[] NOT NULL, bounds jsonb, source text NOT NULL, release text NOT NULL,
 license jsonb NOT NULL, state text NOT NULL DEFAULT 'ready' CHECK(state IN ('staging','ready','retired')),
 created_at timestamptz NOT NULL DEFAULT now(), verified_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS catalog_admin_areas (
 id text PRIMARY KEY,country_code char(2) NOT NULL,state_code text NOT NULL,name text NOT NULL,
 kind text NOT NULL,source text NOT NULL,vintage text NOT NULL,license jsonb NOT NULL,
 geom geometry(MultiPolygon,4326) NOT NULL CHECK(ST_IsValid(geom)),bounds jsonb NOT NULL,
 area_key text NOT NULL,source_metadata jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS catalog_admin_area_geometry ON catalog_admin_areas USING gist(geom);
CREATE TABLE IF NOT EXISTS catalog_city_inventory (
 city_key text PRIMARY KEY,dataset text NOT NULL,country_code char(2) NOT NULL,country_name text NOT NULL,
 state_code text NOT NULL,state_name text NOT NULL,city_id bigint NOT NULL,name text NOT NULL,normalized_name text NOT NULL,
 latitude double precision,longitude double precision,admin_id text REFERENCES catalog_admin_areas(id),
 association_status text NOT NULL DEFAULT 'pending',coverage_status text NOT NULL DEFAULT 'location_pending'
 CHECK(coverage_status IN ('target_met','sources_below_target','partial','temporary_failure','location_pending')),
 unique_supported integer,unique_all integer,source_rows integer,category_count integer,
 sources jsonb NOT NULL DEFAULT '[]',limitations jsonb NOT NULL DEFAULT '[]',next_action text NOT NULL DEFAULT 'resolve_boundary_offline',
 updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(country_code,state_code,city_id)
);
CREATE INDEX IF NOT EXISTS catalog_city_lookup ON catalog_city_inventory(country_code,state_code,normalized_name);
CREATE INDEX IF NOT EXISTS catalog_city_priority ON catalog_city_inventory(country_code,coverage_status,unique_supported);
CREATE TABLE IF NOT EXISTS catalog_city_observations (
 city_key text NOT NULL REFERENCES catalog_city_inventory(city_key),asset_id text NOT NULL REFERENCES catalog_assets(id),
 source_rows integer NOT NULL,unique_supported integer NOT NULL,unique_all integer NOT NULL,category_count integer NOT NULL,
 consulted_at timestamptz NOT NULL DEFAULT now(),outcome text NOT NULL,details jsonb NOT NULL DEFAULT '{}',
 PRIMARY KEY(city_key,asset_id)
);
CREATE TABLE IF NOT EXISTS catalog_ingest_tasks (
 id text PRIMARY KEY,kind text NOT NULL,region text NOT NULL,round integer NOT NULL DEFAULT 1 CHECK(round BETWEEN 1 AND 3),
 target integer NOT NULL DEFAULT 50 CHECK(target IN (50,100,200)),state text NOT NULL DEFAULT 'queued'
 CHECK(state IN ('queued','running','done','failed','blocked')),attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 checkpoint jsonb NOT NULL DEFAULT '{}',budgets jsonb NOT NULL DEFAULT '{}',outcome jsonb NOT NULL DEFAULT '{}',
 run_after timestamptz NOT NULL DEFAULT now(),lease_token uuid,lease_until timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS catalog_tasks_queue ON catalog_ingest_tasks(state,run_after,round);
CREATE TABLE IF NOT EXISTS catalog_manifests (
 id text PRIMARY KEY,payload jsonb NOT NULL,sha256 text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);

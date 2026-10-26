-- Public catalog operations DB only. No change to the authentication database.
-- The manifest contains public geometry URLs/hashes and country/state/city IDs.
GRANT SELECT ON catalog_manifests TO catalog_readonly;

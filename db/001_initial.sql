-- SteamHub schema draft v1. Use incremental migrations; do not silently reset user data.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS games (
  app_id TEXT PRIMARY KEY CHECK (length(app_id) > 0 AND app_id NOT GLOB '*[^0-9]*'),
  display_name TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS library_roots (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL CHECK(source IN ('detected','user_selected')),
  last_scanned_at TEXT
);

CREATE TABLE IF NOT EXISTS installations (
  id INTEGER PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES games(app_id),
  library_root_id INTEGER NOT NULL REFERENCES library_roots(id),
  install_dir TEXT NOT NULL,
  source_acf_path TEXT NOT NULL,
  build_id TEXT,
  last_seen_at TEXT NOT NULL,
  UNIQUE(app_id, library_root_id)
);
CREATE INDEX IF NOT EXISTS idx_installations_app_id ON installations(app_id);

CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('official','community','local','fixture')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  documentation_url TEXT,
  capabilities_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(capabilities_json)),
  last_checked_at TEXT
);

CREATE TABLE IF NOT EXISTS catalog_metadata (
  app_id TEXT NOT NULL REFERENCES games(app_id),
  provider_id TEXT NOT NULL REFERENCES providers(id),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  fetched_at TEXT NOT NULL,
  expires_at TEXT,
  PRIMARY KEY (app_id, provider_id)
);

CREATE TABLE IF NOT EXISTS lua_documents (
  id TEXT PRIMARY KEY,
  app_id TEXT REFERENCES games(app_id),
  managed_path TEXT NOT NULL UNIQUE,
  file_sha256 TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK(provenance IN ('imported','generated')),
  template_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS manifests (
  id TEXT PRIMARY KEY,
  app_id TEXT REFERENCES games(app_id),
  depot_id TEXT CHECK(depot_id IS NULL OR (length(depot_id) > 0 AND depot_id NOT GLOB '*[^0-9]*')),
  kind TEXT NOT NULL CHECK(kind IN ('appmanifest_acf','depot_manifest','unknown')),
  original_path TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL CHECK(file_size_bytes >= 0),
  inspected_at TEXT NOT NULL,
  metadata_json TEXT CHECK(metadata_json IS NULL OR json_valid(metadata_json))
);
CREATE INDEX IF NOT EXISTS idx_manifests_app_id ON manifests(app_id);

CREATE TABLE IF NOT EXISTS fixes (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  app_id TEXT NOT NULL REFERENCES games(app_id),
  title TEXT NOT NULL,
  version TEXT,
  supported_builds_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(supported_builds_json)),
  package_uri TEXT,
  expected_sha256 TEXT,
  signing_identity TEXT,
  approval_state TEXT NOT NULL DEFAULT 'unverified' CHECK(approval_state IN ('unverified','approved','blocked','manual_reference_only')),
  last_checked_at TEXT,
  UNIQUE(provider_id, app_id, title, version)
);
CREATE INDEX IF NOT EXISTS idx_fixes_app_id ON fixes(app_id);

CREATE TABLE IF NOT EXISTS fix_installations (
  id TEXT PRIMARY KEY,
  fix_id TEXT NOT NULL REFERENCES fixes(id),
  installation_id INTEGER NOT NULL REFERENCES installations(id),
  applied_version TEXT,
  backup_path TEXT,
  state TEXT NOT NULL CHECK(state IN ('planned','applying','applied','failed','rolled_back')),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  app_id TEXT REFERENCES games(app_id),
  status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled')),
  progress_percent INTEGER NOT NULL DEFAULT 0 CHECK(progress_percent BETWEEN 0 AND 100),
  payload_json TEXT CHECK(payload_json IS NULL OR json_valid(payload_json)),
  result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status,created_at);

CREATE TABLE IF NOT EXISTS job_events (
  id INTEGER PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL CHECK(json_valid(value_json)),
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO schema_migrations(version,name) VALUES(1,'initial');

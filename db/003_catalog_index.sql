-- Migration 003: searchable catalog index and provider sync state
-- Additive migration preserving all v1 and v2 records.

CREATE TABLE IF NOT EXISTS catalog_entries (
  provider_id TEXT NOT NULL REFERENCES providers(id),
  app_id TEXT NOT NULL REFERENCES games(app_id),
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 512),
  item_type TEXT,
  last_modified_unix INTEGER,
  fetched_at TEXT NOT NULL,
  expires_at TEXT,
  PRIMARY KEY(provider_id, app_id)
);
CREATE INDEX IF NOT EXISTS idx_catalog_entries_name
  ON catalog_entries(display_name COLLATE NOCASE, app_id);
CREATE INDEX IF NOT EXISTS idx_catalog_entries_app_id
  ON catalog_entries(app_id);

CREATE TABLE IF NOT EXISTS catalog_sync_state (
  provider_id TEXT PRIMARY KEY REFERENCES providers(id),
  cursor TEXT,
  status TEXT NOT NULL CHECK(status IN ('not_started','partial','complete','failed','rate_limited')),
  started_at TEXT,
  attempted_at TEXT,
  last_success_at TEXT,
  error_code TEXT
);

INSERT OR IGNORE INTO providers (id, display_name, kind, enabled, documentation_url, capabilities_json)
VALUES 
  ('steam-storefront', 'Steam Storefront', 'official', 1, 'https://store.steampowered.com', '["catalog_search","catalog_get"]'),
  ('steam-official', 'Steam Web API (IStoreService)', 'official', 0, 'https://partner.steamgames.com/doc/webapi/IStoreService', '["catalog_search","catalog_get"]'),
  ('local-cache', 'Local Catalog Cache', 'local', 1, NULL, '["catalog_search","catalog_get"]');

INSERT OR IGNORE INTO schema_migrations(version, name) VALUES(3, 'catalog_index');

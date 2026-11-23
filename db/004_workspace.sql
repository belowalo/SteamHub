CREATE TABLE workspace_files (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  extension TEXT NOT NULL,
  size INTEGER NOT NULL CHECK(size > 0),
  app_id TEXT,
  source TEXT NOT NULL,
  version TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  warnings_json TEXT NOT NULL CHECK(json_valid(warnings_json))
);
CREATE INDEX workspace_files_app ON workspace_files(app_id);
CREATE TABLE workspace_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE compatibility_notes (
  app_id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO schema_migrations(version,name) VALUES (4,'workspace');

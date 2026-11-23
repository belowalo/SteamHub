-- P04: additive observation state; v1 game/root/installation records are retained.
CREATE TABLE library_root_scan_state (
  root_id INTEGER PRIMARY KEY REFERENCES library_roots(id),
  status TEXT NOT NULL CHECK(status IN ('complete','partial','failed')),
  attempted_at TEXT NOT NULL,
  diagnostics_json TEXT NOT NULL CHECK(json_valid(diagnostics_json))
);
CREATE TABLE installation_scan_state (
  installation_id INTEGER PRIMARY KEY REFERENCES installations(id),
  status TEXT NOT NULL CHECK(status IN ('verified_local','absent','not_checked','scan_failed')),
  checked_at TEXT NOT NULL
);
INSERT INTO schema_migrations(version,name) VALUES(2,'library_scan_state');

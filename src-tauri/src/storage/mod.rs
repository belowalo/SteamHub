use rusqlite::{Connection, OptionalExtension};
use std::{path::Path, sync::Mutex, time::Duration};
pub mod catalog;
pub mod library;
pub mod workspace;

const INITIAL_MIGRATION: &str = include_str!("../../../db/001_initial.sql");
const LIBRARY_MIGRATION: &str = include_str!("../../../db/002_library_scan_state.sql");
const CATALOG_MIGRATION: &str = include_str!("../../../db/003_catalog_index.sql");
const WORKSPACE_MIGRATION: &str = include_str!("../../../db/004_workspace.sql");
const TABLES: &[&str] = &[
    "schema_migrations",
    "games",
    "library_roots",
    "installations",
    "providers",
    "catalog_metadata",
    "lua_documents",
    "manifests",
    "fixes",
    "fix_installations",
    "jobs",
    "job_events",
    "settings",
    "catalog_entries",
    "catalog_sync_state",
    "workspace_files",
    "workspace_activity",
    "compatibility_notes",
];

pub struct Database {
    pub(crate) connection: Mutex<Connection>,
}

impl Database {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let mut connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        migrate(&mut connection)?;
        verify_schema(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn is_ready(&self) -> bool {
        self.connection
            .lock()
            .map(|connection| verify_schema(&connection).is_ok())
            .unwrap_or(false)
    }
}

fn migrate(connection: &mut Connection) -> rusqlite::Result<()> {
    let has_migrations: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'schema_migrations')",
        [], |row| row.get(0),
    )?;
    if has_migrations {
        let latest: Option<i64> =
            connection.query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get(0)
            })?;
        if latest.is_some_and(|version| version > 4) {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let initial: Option<String> = connection
            .query_row(
                "SELECT name FROM schema_migrations WHERE version = 1",
                [],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(name) = initial {
            return if name == "initial" {
                migrate_library(connection)?;
                migrate_catalog(connection)?;
                migrate_workspace(connection)
            } else {
                Err(rusqlite::Error::InvalidQuery)
            };
        }
    }
    // The supplied migration and its version marker commit together. Never reset data.
    let transaction = connection.transaction()?;
    transaction.execute_batch(INITIAL_MIGRATION)?;
    transaction.commit()?;
    migrate_library(connection)?;
    migrate_catalog(connection)?;
    migrate_workspace(connection)
}

fn migrate_workspace(connection: &mut Connection) -> rusqlite::Result<()> {
    let name: Option<String> = connection
        .query_row(
            "SELECT name FROM schema_migrations WHERE version=4",
            [],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(name) = name {
        return if name == "workspace" {
            Ok(())
        } else {
            Err(rusqlite::Error::InvalidQuery)
        };
    }
    let transaction = connection.transaction()?;
    transaction.execute_batch(WORKSPACE_MIGRATION)?;
    transaction.commit()
}

fn migrate_library(connection: &mut Connection) -> rusqlite::Result<()> {
    // Refuse a damaged v1 database instead of repairing/resetting it implicitly.
    for table in &[
        "schema_migrations",
        "games",
        "library_roots",
        "installations",
        "providers",
        "catalog_metadata",
        "lua_documents",
        "manifests",
        "fixes",
        "fix_installations",
        "jobs",
        "job_events",
        "settings",
    ] {
        let exists: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?1)",
            [table],
            |row| row.get(0),
        )?;
        if !exists {
            return Err(rusqlite::Error::InvalidQuery);
        }
    }
    let name: Option<String> = connection
        .query_row(
            "SELECT name FROM schema_migrations WHERE version=2",
            [],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(name) = name {
        return if name == "library_scan_state" {
            Ok(())
        } else {
            Err(rusqlite::Error::InvalidQuery)
        };
    }
    let transaction = connection.transaction()?;
    transaction.execute_batch(LIBRARY_MIGRATION)?;
    transaction.commit()
}

fn migrate_catalog(connection: &mut Connection) -> rusqlite::Result<()> {
    let name: Option<String> = connection
        .query_row(
            "SELECT name FROM schema_migrations WHERE version=3",
            [],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(name) = name {
        return if name == "catalog_index" {
            Ok(())
        } else {
            Err(rusqlite::Error::InvalidQuery)
        };
    }
    let transaction = connection.transaction()?;
    transaction.execute_batch(CATALOG_MIGRATION)?;
    transaction.commit()
}

fn verify_schema(connection: &Connection) -> rusqlite::Result<()> {
    for table in TABLES {
        let exists: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?1)",
            [table],
            |row| row.get(0),
        )?;
        if !exists {
            return Err(rusqlite::Error::InvalidQuery);
        }
    }
    let version: i64 =
        connection.query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
            row.get(0)
        })?;
    let foreign_keys: bool =
        connection.pragma_query_value(None, "foreign_keys", |row| row.get(0))?;
    let state_tables: i64 = connection.query_row("SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name IN ('library_root_scan_state','installation_scan_state')", [], |row| row.get(0))?;
    let catalog_tables: i64 = connection.query_row("SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name IN ('catalog_entries','catalog_sync_state')", [], |row| row.get(0))?;
    if version != 4 || !foreign_keys || state_tables != 2 || catalog_tables != 2 {
        return Err(rusqlite::Error::InvalidQuery);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_and_preserves_data_across_restart() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("SteamHub 日本語.sqlite3");
        {
            let db = Database::open(&path).unwrap();
            assert!(db.is_ready());
            let connection = db.connection.lock().unwrap();
            connection.execute("INSERT INTO settings VALUES ('test', '{\"value\":42}', '2026-11-02T00:00:00Z')", []).unwrap();
        }
        let db = Database::open(&path).unwrap();
        assert!(db.is_ready());
        let connection = db.connection.lock().unwrap();
        let value: String = connection
            .query_row(
                "SELECT value_json FROM settings WHERE key = 'test'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(value, "{\"value\":42}");
        let count: i64 = connection
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 4);
    }

    #[test]
    fn enforces_id_foreign_key_and_json_constraints() {
        let db = Database::open(Path::new(":memory:")).unwrap();
        let connection = db.connection.lock().unwrap();
        for app_id in ["", "123x", "-1"] {
            assert!(connection
                .execute("INSERT INTO games(app_id) VALUES (?1)", [app_id])
                .is_err());
        }
        connection
            .execute(
                "INSERT INTO games(app_id) VALUES ('18446744073709551615')",
                [],
            )
            .unwrap();
        assert!(connection
            .execute(
                "INSERT INTO games(app_id) VALUES ('18446744073709551615')",
                []
            )
            .is_err());
        assert!(connection
            .execute("INSERT INTO settings VALUES ('test', '{bad}', 'now')", [])
            .is_err());
        assert!(connection
            .execute(
                "INSERT INTO lua_documents VALUES ('test','123','x','hash','imported',NULL,'now')",
                []
            )
            .is_err());
    }

    #[test]
    fn refuses_newer_or_incomplete_schema() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("future.sqlite3");
        let db = Database::open(&path).unwrap();
        db.connection
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO schema_migrations(version,name) VALUES (5,'future')",
                [],
            )
            .unwrap();
        assert!(!db.is_ready());
        drop(db);
        assert!(Database::open(&path).is_err());

        let db = Database::open(Path::new(":memory:")).unwrap();
        db.connection
            .lock()
            .unwrap()
            .execute("DROP TABLE settings", [])
            .unwrap();
        assert!(!db.is_ready());
    }

    #[test]
    fn failed_migration_rolls_back() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute("CREATE TABLE installations (wrong_column TEXT)", [])
            .unwrap();
        assert!(migrate(&mut connection).is_err());
        let created: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name = 'schema_migrations')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!created);
    }

    #[test]
    fn invalid_database_path_fails() {
        let dir = tempfile::tempdir().unwrap();
        assert!(Database::open(dir.path()).is_err());
    }
}

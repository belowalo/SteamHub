use super::Database;
use crate::{
    contracts::{library::*, AppError},
    services::library::ObservedRoot,
};
use rusqlite::{params, Connection};

fn db_error(_: impl std::fmt::Debug) -> AppError {
    AppError::new(
        "IO_ERROR",
        "Could not read or update the local library index.",
        true,
    )
}
fn summaries(
    connection: &Connection,
    app_id: Option<&str>,
) -> rusqlite::Result<Vec<LocalGameSummary>> {
    let mut statement = connection.prepare(
        "SELECT g.app_id,g.display_name,MAX(i.last_seen_at),COUNT(i.id),
         MAX(CASE COALESCE(s.status,'not_checked') WHEN 'verified_local' THEN 3 WHEN 'scan_failed' THEN 2 WHEN 'not_checked' THEN 1 ELSE 0 END)
         FROM games g JOIN installations i ON i.app_id=g.app_id
         LEFT JOIN installation_scan_state s ON s.installation_id=i.id
         WHERE (?1 IS NULL OR g.app_id=?1) GROUP BY g.app_id ORDER BY g.display_name COLLATE NOCASE,g.app_id LIMIT 20001")?;
    let games = statement
        .query_map([app_id], |row| {
            let rank: i64 = row.get(4)?;
            Ok(LocalGameSummary {
                app_id: row.get(0)?,
                name: row.get(1)?,
                artwork_url: None,
                installed: rank == 3,
                metadata_source: LocalSource {
                    provider_id: "local-steam",
                    fetched_at: row.get(2)?,
                    freshness: "unknown",
                },
                install_status: match rank {
                    3 => "verified_local",
                    2 => "scan_failed",
                    1 => "not_checked",
                    _ => "absent",
                }
                .into(),
                installation_count: row.get::<_, i64>(3)? as usize,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if games.len() > 20000 {
        return Err(rusqlite::Error::InvalidQuery);
    }
    Ok(games)
}

impl Database {
    pub fn library_known_roots(&self) -> Result<Vec<(String, String)>, AppError> {
        let connection = self.connection.lock().map_err(db_error)?;
        let mut statement = connection
            .prepare("SELECT path,source FROM library_roots ORDER BY id LIMIT 64")
            .map_err(db_error)?;
        let result = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(db_error)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db_error)?;
        Ok(result)
    }
    pub fn library_persist(&self, roots: &[ObservedRoot]) -> Result<(), AppError> {
        let mut connection = self.connection.lock().map_err(db_error)?;
        let transaction = connection.transaction().map_err(db_error)?;
        let now: String = transaction
            .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')", [], |row| {
                row.get(0)
            })
            .map_err(db_error)?;
        for root in roots {
            transaction.execute("INSERT INTO library_roots(path,source,last_scanned_at) VALUES (?1,?2,CASE WHEN ?3='failed' THEN NULL ELSE ?4 END)
                ON CONFLICT(path) DO UPDATE SET source=CASE WHEN library_roots.source='user_selected' THEN library_roots.source ELSE excluded.source END,
                last_scanned_at=CASE WHEN ?3='failed' THEN library_roots.last_scanned_at ELSE ?4 END", params![root.path,root.source,root.status,now]).map_err(db_error)?;
            let root_id: i64 = transaction
                .query_row(
                    "SELECT id FROM library_roots WHERE path=?1",
                    [&root.path],
                    |row| row.get(0),
                )
                .map_err(db_error)?;
            let diagnostics = serde_json::to_string(&root.diagnostics).map_err(db_error)?;
            transaction.execute("INSERT INTO library_root_scan_state VALUES (?1,?2,?3,?4) ON CONFLICT(root_id) DO UPDATE SET status=excluded.status,attempted_at=excluded.attempted_at,diagnostics_json=excluded.diagnostics_json", params![root_id,root.status,now,diagnostics]).map_err(db_error)?;
            // Preserve every historical row. Only a complete root enumeration proves
            // absence; partial/unreadable inventories leave unseen records scan_failed.
            transaction.execute("INSERT INTO installation_scan_state(installation_id,status,checked_at)
                SELECT id,?2,?3 FROM installations WHERE library_root_id=?1
                ON CONFLICT(installation_id) DO UPDATE SET status=excluded.status,checked_at=excluded.checked_at", params![root_id,if root.status == "complete" { "absent" } else { "scan_failed" },now]).map_err(db_error)?;
            for installation in &root.installations {
                transaction.execute("INSERT INTO games(app_id,display_name,updated_at) VALUES (?1,?2,?3) ON CONFLICT(app_id) DO UPDATE SET display_name=COALESCE(excluded.display_name,games.display_name),updated_at=excluded.updated_at", params![installation.app_id,installation.name,now]).map_err(db_error)?;
                transaction.execute("INSERT INTO installations(app_id,library_root_id,install_dir,source_acf_path,build_id,last_seen_at) VALUES (?1,?2,?3,?4,?5,?6)
                    ON CONFLICT(app_id,library_root_id) DO UPDATE SET install_dir=excluded.install_dir,source_acf_path=excluded.source_acf_path,build_id=excluded.build_id,
                    last_seen_at=CASE WHEN ?7='verified_local' THEN excluded.last_seen_at ELSE installations.last_seen_at END", params![installation.app_id,root_id,installation.install_path,installation.source_acf_path,installation.build_id,now,installation.status]).map_err(db_error)?;
                let id: i64 = transaction
                    .query_row(
                        "SELECT id FROM installations WHERE app_id=?1 AND library_root_id=?2",
                        params![installation.app_id, root_id],
                        |row| row.get(0),
                    )
                    .map_err(db_error)?;
                transaction.execute("INSERT INTO installation_scan_state VALUES (?1,?2,?3) ON CONFLICT(installation_id) DO UPDATE SET status=excluded.status,checked_at=excluded.checked_at", params![id,installation.status,now]).map_err(db_error)?;
            }
        }
        transaction.commit().map_err(db_error)
    }
    pub fn library_snapshot(&self) -> Result<LibrarySnapshot, AppError> {
        let connection = self.connection.lock().map_err(db_error)?;
        let games = summaries(&connection, None).map_err(db_error)?;
        let mut statement = connection.prepare("SELECT r.path,r.source,COALESCE(s.status,'not_checked'),r.last_scanned_at,s.attempted_at,COALESCE(s.diagnostics_json,'[]') FROM library_roots r LEFT JOIN library_root_scan_state s ON s.root_id=r.id ORDER BY r.path").map_err(db_error)?;
        let roots = statement
            .query_map([], |row| {
                let json: String = row.get(5)?;
                let diagnostics =
                    serde_json::from_str(&json).map_err(|_| rusqlite::Error::InvalidQuery)?;
                Ok(LibraryRootStatus {
                    path: row.get(0)?,
                    source: row.get(1)?,
                    status: row.get(2)?,
                    last_scanned_at: row.get(3)?,
                    attempted_at: row.get(4)?,
                    diagnostics,
                })
            })
            .map_err(db_error)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db_error)?;
        let last_scan_at = connection
            .query_row(
                "SELECT MAX(attempted_at) FROM library_root_scan_state",
                [],
                |row| row.get(0),
            )
            .map_err(db_error)?;
        Ok(LibrarySnapshot {
            games,
            roots,
            last_scan_at,
        })
    }
    pub fn library_get(&self, app_id: &str) -> Result<LocalGameDetail, AppError> {
        let connection = self.connection.lock().map_err(db_error)?;
        let summary = summaries(&connection, Some(app_id))
            .map_err(db_error)?
            .into_iter()
            .next()
            .ok_or_else(|| {
                AppError::new(
                    "NOT_FOUND",
                    "This AppID has no indexed local installation record. Scan the library first.",
                    false,
                )
            })?;
        let mut statement = connection.prepare("SELECT i.id,i.app_id,r.path,i.install_dir,i.build_id,i.source_acf_path,i.last_seen_at,COALESCE(s.status,'not_checked'),s.checked_at FROM installations i JOIN library_roots r ON r.id=i.library_root_id LEFT JOIN installation_scan_state s ON s.installation_id=i.id WHERE i.app_id=?1 ORDER BY r.path").map_err(db_error)?;
        let installations = statement
            .query_map([app_id], |row| {
                Ok(LocalInstallation {
                    id: row.get(0)?,
                    app_id: row.get(1)?,
                    library_root: row.get(2)?,
                    install_path: row.get(3)?,
                    build_id: row.get(4)?,
                    source_acf_path: row.get(5)?,
                    last_seen_at: row.get(6)?,
                    status: row.get(7)?,
                    checked_at: row.get(8)?,
                })
            })
            .map_err(db_error)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db_error)?;
        Ok(LocalGameDetail {
            summary,
            description: None,
            release_date: None,
            installations,
        })
    }
}

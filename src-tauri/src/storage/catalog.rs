use super::Database;
use crate::contracts::{
    catalog::{CatalogGameDetail, CatalogGameSummary, CatalogProviderStatus, SourceAttribution},
    library::LocalInstallation,
    AppError,
};
use rusqlite::{params, Connection, OptionalExtension};

fn db_error(_: impl std::fmt::Debug) -> AppError {
    AppError::new(
        "IO_ERROR",
        "Could not read or update the local catalog database.",
        true,
    )
}

fn escape_like(query: &str) -> String {
    query
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn get_local_installations(
    connection: &Connection,
    app_id: &str,
) -> rusqlite::Result<Vec<LocalInstallation>> {
    let mut stmt = connection.prepare(
        "SELECT i.id, i.app_id, r.path, i.install_dir, i.build_id, i.source_acf_path, i.last_seen_at, COALESCE(s.status, 'not_checked'), s.checked_at
         FROM installations i
         JOIN library_roots r ON r.id = i.library_root_id
         LEFT JOIN installation_scan_state s ON s.installation_id = i.id
         WHERE i.app_id = ?1
         ORDER BY r.path",
    )?;
    let rows = stmt.query_map([app_id], |row| {
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
    })?;
    rows.collect()
}

impl Database {
    pub fn catalog_search_cached(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Vec<CatalogGameSummary>, AppError> {
        let connection = self.connection.lock().map_err(db_error)?;
        let trimmed = query.trim();
        let escaped = escape_like(trimmed);
        let safe_limit = limit.clamp(1, 100);

        // Search catalog_entries combined with local games table
        let mut stmt = connection
            .prepare(
                "SELECT app_id, display_name, item_type, last_modified_unix, provider_id, fetched_at, is_installed
                 FROM (
                     SELECT e.app_id, e.display_name, e.item_type, e.last_modified_unix, e.provider_id, e.fetched_at,
                            EXISTS(
                                SELECT 1 FROM installations i
                                JOIN installation_scan_state s ON s.installation_id = i.id
                                WHERE i.app_id = e.app_id AND s.status = 'verified_local'
                            ) AS is_installed
                     FROM catalog_entries e
                     WHERE (?1 != '' AND (e.app_id = ?1 OR e.display_name LIKE '%' || ?2 || '%' ESCAPE '\\'))
                     UNION
                     SELECT g.app_id, g.display_name, 'game' AS item_type, NULL AS last_modified_unix, 'local-steam' AS provider_id, g.updated_at AS fetched_at,
                            EXISTS(
                                SELECT 1 FROM installations i
                                JOIN installation_scan_state s ON s.installation_id = i.id
                                WHERE i.app_id = g.app_id AND s.status = 'verified_local'
                            ) AS is_installed
                     FROM games g
                     WHERE (?1 != '' AND (g.app_id = ?1 OR g.display_name LIKE '%' || ?2 || '%' ESCAPE '\\'))
                       AND g.app_id NOT IN (SELECT app_id FROM catalog_entries)
                 )
                 ORDER BY (app_id = ?1) DESC, display_name COLLATE NOCASE
                 LIMIT ?3",
            )
            .map_err(db_error)?;

        let games = stmt
            .query_map(params![trimmed, escaped, safe_limit as i64], |row| {
                let app_id: String = row.get(0)?;
                let name: Option<String> = row.get(1)?;
                let item_type: Option<String> = row.get(2)?;
                let last_modified_unix: Option<i64> = row.get(3)?;
                let provider_id: String = row.get(4)?;
                let fetched_at: String = row.get(5)?;
                let is_installed: bool = row.get(6)?;

                // Look for artwork in catalog_metadata if available
                let artwork_url: Option<String> = connection
                    .query_row(
                        "SELECT json_extract(payload_json, '$.artworkUrl') FROM catalog_metadata WHERE app_id = ?1",
                        [&app_id],
                        |r| r.get(0),
                    )
                    .optional()
                    .unwrap_or(None);

                Ok(CatalogGameSummary {
                    app_id,
                    name,
                    artwork_url,
                    installed: is_installed,
                    metadata_source: Some(SourceAttribution {
                        provider_id,
                        fetched_at,
                        freshness: "stale".to_string(),
                        documentation_url: None,
                    }),
                    item_type,
                    last_modified_unix,
                })
            })
            .map_err(db_error)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db_error)?;

        Ok(games)
    }

    pub fn catalog_save_entries(
        &self,
        entries: &[CatalogGameSummary],
        provider_id: &str,
    ) -> Result<(), AppError> {
        let mut connection = self.connection.lock().map_err(db_error)?;
        let transaction = connection.transaction().map_err(db_error)?;
        let now: String = transaction
            .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')", [], |row| {
                row.get(0)
            })
            .map_err(db_error)?;

        for entry in entries {
            let app_id = entry.app_id.trim();
            if app_id.is_empty() || !app_id.chars().all(|c| c.is_ascii_digit()) {
                continue;
            }
            let name = entry.name.as_deref().unwrap_or(app_id);
            // 1. Maintain foreign key in games table without overwriting verified local game names
            transaction.execute(
                "INSERT INTO games (app_id, display_name, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(app_id) DO UPDATE SET display_name = COALESCE(games.display_name, excluded.display_name), updated_at = excluded.updated_at",
                params![app_id, name, now],
            ).map_err(db_error)?;

            // 2. Insert or update catalog_entries
            transaction.execute(
                "INSERT INTO catalog_entries (provider_id, app_id, display_name, item_type, last_modified_unix, fetched_at, expires_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now', '+7 days'))
                 ON CONFLICT(provider_id, app_id) DO UPDATE SET
                   display_name = excluded.display_name,
                   item_type = COALESCE(excluded.item_type, catalog_entries.item_type),
                   last_modified_unix = COALESCE(excluded.last_modified_unix, catalog_entries.last_modified_unix),
                   fetched_at = excluded.fetched_at,
                   expires_at = excluded.expires_at",
                params![
                    provider_id,
                    app_id,
                    name,
                    entry.item_type.as_deref().unwrap_or("game"),
                    entry.last_modified_unix,
                    now,
                ],
            ).map_err(db_error)?;

            // 3. If artwork URL is present, store in catalog_metadata
            if let Some(artwork_url) = &entry.artwork_url {
                let payload = serde_json::json!({
                    "appId": app_id,
                    "name": name,
                    "artworkUrl": artwork_url,
                });
                transaction.execute(
                    "INSERT INTO catalog_metadata (app_id, provider_id, payload_json, fetched_at, expires_at)
                     VALUES (?1, ?2, ?3, ?4, datetime('now', '+7 days'))
                     ON CONFLICT(app_id, provider_id) DO UPDATE SET
                       payload_json = excluded.payload_json,
                       fetched_at = excluded.fetched_at,
                       expires_at = excluded.expires_at",
                    params![app_id, provider_id, payload.to_string(), now],
                ).map_err(db_error)?;
            }
        }

        transaction.commit().map_err(db_error)
    }

    pub fn catalog_get_cached(&self, app_id: &str) -> Result<Option<CatalogGameDetail>, AppError> {
        let connection = self.connection.lock().map_err(db_error)?;
        let local_installations = get_local_installations(&connection, app_id).map_err(db_error)?;
        let is_installed = local_installations
            .iter()
            .any(|inst| inst.status == "verified_local");

        // Try reading rich payload from catalog_metadata
        let metadata_row: Option<(String, String, String)> = connection
            .query_row(
                "SELECT provider_id, payload_json, fetched_at FROM catalog_metadata WHERE app_id = ?1 ORDER BY fetched_at DESC LIMIT 1",
                [app_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(db_error)?;

        if let Some((provider_id, payload_json, fetched_at)) = metadata_row {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&payload_json) {
                let name = value
                    .get("name")
                    .and_then(|v| v.as_str())
                    .map(String::from)
                    .or_else(|| {
                        connection
                            .query_row(
                                "SELECT display_name FROM games WHERE app_id = ?1",
                                [app_id],
                                |r| r.get(0),
                            )
                            .ok()
                    });
                let artwork_url = value
                    .get("artworkUrl")
                    .and_then(|v| v.as_str())
                    .map(String::from)
                    .or_else(|| {
                        value
                            .get("headerImage")
                            .and_then(|v| v.as_str())
                            .map(String::from)
                    })
                    .or_else(|| {
                        value
                            .get("capsuleImage")
                            .and_then(|v| v.as_str())
                            .map(String::from)
                    });
                let description = value
                    .get("description")
                    .and_then(|v| v.as_str())
                    .map(String::from);
                let short_description = value
                    .get("shortDescription")
                    .and_then(|v| v.as_str())
                    .map(String::from);
                let release_date = value
                    .get("releaseDate")
                    .and_then(|v| v.as_str())
                    .map(String::from);
                let website = value
                    .get("website")
                    .and_then(|v| v.as_str())
                    .map(String::from);
                let header_image = value
                    .get("headerImage")
                    .and_then(|v| v.as_str())
                    .map(String::from);
                let capsule_image = value
                    .get("capsuleImage")
                    .and_then(|v| v.as_str())
                    .map(String::from);
                let item_type = value
                    .get("itemType")
                    .and_then(|v| v.as_str())
                    .map(String::from);
                let genres = value
                    .get("genres")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|g| g.as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default();

                return Ok(Some(CatalogGameDetail {
                    app_id: app_id.to_string(),
                    name,
                    artwork_url,
                    installed: is_installed,
                    metadata_source: Some(SourceAttribution {
                        provider_id,
                        fetched_at,
                        freshness: "stale".to_string(),
                        documentation_url: None,
                    }),
                    item_type,
                    description,
                    short_description,
                    release_date,
                    website,
                    header_image,
                    capsule_image,
                    genres,
                    local_installation_derived: !local_installations.is_empty(),
                    local_installations,
                }));
            }
        }

        // Fall back to catalog_entries or games
        let entry_row: Option<(String, Option<String>, Option<String>, String)> = connection
            .query_row(
                "SELECT provider_id, display_name, item_type, fetched_at FROM catalog_entries WHERE app_id = ?1 LIMIT 1",
                [app_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()
            .map_err(db_error)?;

        if let Some((provider_id, name, item_type, fetched_at)) = entry_row {
            return Ok(Some(CatalogGameDetail {
                app_id: app_id.to_string(),
                name,
                artwork_url: None,
                installed: is_installed,
                metadata_source: Some(SourceAttribution {
                    provider_id,
                    fetched_at,
                    freshness: "stale".to_string(),
                    documentation_url: None,
                }),
                item_type,
                description: None,
                short_description: None,
                release_date: None,
                website: None,
                header_image: None,
                capsule_image: None,
                genres: Vec::new(),
                local_installation_derived: !local_installations.is_empty(),
                local_installations,
            }));
        }

        // Fall back to local games table if observed in library
        let game_name: Option<String> = connection
            .query_row(
                "SELECT display_name FROM games WHERE app_id = ?1",
                [app_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(db_error)?;

        if let Some(name) = game_name {
            return Ok(Some(CatalogGameDetail {
                app_id: app_id.to_string(),
                name: Some(name),
                artwork_url: None,
                installed: is_installed,
                metadata_source: Some(SourceAttribution {
                    provider_id: "local-steam".to_string(),
                    fetched_at: "now".to_string(),
                    freshness: "unknown".to_string(),
                    documentation_url: None,
                }),
                item_type: Some("game".to_string()),
                description: None,
                short_description: None,
                release_date: None,
                website: None,
                header_image: None,
                capsule_image: None,
                genres: Vec::new(),
                local_installation_derived: !local_installations.is_empty(),
                local_installations,
            }));
        }

        Ok(None)
    }

    pub fn catalog_save_detail(
        &self,
        detail: &CatalogGameDetail,
        provider_id: &str,
    ) -> Result<(), AppError> {
        let mut connection = self.connection.lock().map_err(db_error)?;
        let transaction = connection.transaction().map_err(db_error)?;
        let now: String = transaction
            .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')", [], |row| {
                row.get(0)
            })
            .map_err(db_error)?;

        let app_id = detail.app_id.trim();
        let name = detail.name.as_deref().unwrap_or(app_id);

        // 1. Foreign key in games
        transaction.execute(
            "INSERT INTO games (app_id, display_name, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(app_id) DO UPDATE SET display_name = COALESCE(games.display_name, excluded.display_name), updated_at = excluded.updated_at",
            params![app_id, name, now],
        ).map_err(db_error)?;

        // 2. catalog_entries
        transaction.execute(
            "INSERT INTO catalog_entries (provider_id, app_id, display_name, item_type, fetched_at, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5, datetime('now', '+7 days'))
             ON CONFLICT(provider_id, app_id) DO UPDATE SET
               display_name = excluded.display_name,
               item_type = COALESCE(excluded.item_type, catalog_entries.item_type),
               fetched_at = excluded.fetched_at,
               expires_at = excluded.expires_at",
            params![provider_id, app_id, name, detail.item_type.as_deref().unwrap_or("game"), now],
        ).map_err(db_error)?;

        // 3. catalog_metadata
        let payload = serde_json::json!({
            "appId": app_id,
            "name": name,
            "artworkUrl": detail.artwork_url,
            "itemType": detail.item_type,
            "description": detail.description,
            "shortDescription": detail.short_description,
            "releaseDate": detail.release_date,
            "website": detail.website,
            "headerImage": detail.header_image,
            "capsuleImage": detail.capsule_image,
            "genres": detail.genres,
        });

        transaction.execute(
            "INSERT INTO catalog_metadata (app_id, provider_id, payload_json, fetched_at, expires_at)
             VALUES (?1, ?2, ?3, ?4, datetime('now', '+7 days'))
             ON CONFLICT(app_id, provider_id) DO UPDATE SET
               payload_json = excluded.payload_json,
               fetched_at = excluded.fetched_at,
               expires_at = excluded.expires_at",
            params![app_id, provider_id, payload.to_string(), now],
        ).map_err(db_error)?;

        transaction.commit().map_err(db_error)
    }

    pub fn catalog_providers(&self) -> Result<Vec<CatalogProviderStatus>, AppError> {
        let connection = self.connection.lock().map_err(db_error)?;
        let mut stmt = connection.prepare(
            "SELECT p.id, p.display_name, p.kind, p.enabled, p.documentation_url, p.capabilities_json,
                    s.status, s.last_success_at, s.error_code
             FROM providers p
             LEFT JOIN catalog_sync_state s ON s.provider_id = p.id
             ORDER BY p.id",
        ).map_err(db_error)?;

        let providers = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let display_name: String = row.get(1)?;
                let kind: String = row.get(2)?;
                let enabled: bool = row.get(3)?;
                let documentation_url: Option<String> = row.get(4)?;
                let capabilities_json: String = row.get(5)?;
                let sync_status: Option<String> = row.get(6)?;
                let last_sync_time: Option<String> = row.get(7)?;
                let error_code: Option<String> = row.get(8)?;

                let capabilities: Vec<String> =
                    serde_json::from_str(&capabilities_json).unwrap_or_default();
                let status = if !enabled {
                    "offline".to_string()
                } else if let Some(err) = &error_code {
                    if err == "RATE_LIMITED" {
                        "rate_limited".to_string()
                    } else if err == "NEEDS_CONFIGURATION" {
                        "needs_configuration".to_string()
                    } else {
                        "failed".to_string()
                    }
                } else if id == "steam-official" && sync_status.is_none() {
                    "needs_configuration".to_string()
                } else {
                    "ready".to_string()
                };

                let setup_needed = id == "steam-official" && status == "needs_configuration";

                Ok(CatalogProviderStatus {
                    id,
                    display_name,
                    kind,
                    enabled,
                    documentation_url,
                    capabilities,
                    status,
                    last_sync_time,
                    setup_needed,
                    last_redacted_error: error_code,
                })
            })
            .map_err(db_error)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db_error)?;

        Ok(providers)
    }

    pub fn catalog_update_sync_state(
        &self,
        provider_id: &str,
        status: &str,
        cursor: Option<&str>,
        error_code: Option<&str>,
    ) -> Result<(), AppError> {
        let connection = self.connection.lock().map_err(db_error)?;
        let now: String = connection
            .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')", [], |row| {
                row.get(0)
            })
            .map_err(db_error)?;

        connection.execute(
            "INSERT INTO catalog_sync_state (provider_id, cursor, status, attempted_at, last_success_at, error_code)
             VALUES (?1, ?2, ?3, ?4, CASE WHEN ?3 = 'complete' OR ?3 = 'partial' THEN ?4 ELSE NULL END, ?5)
             ON CONFLICT(provider_id) DO UPDATE SET
               cursor = COALESCE(excluded.cursor, catalog_sync_state.cursor),
               status = excluded.status,
               attempted_at = excluded.attempted_at,
               last_success_at = CASE WHEN excluded.status IN ('complete', 'partial') THEN excluded.attempted_at ELSE catalog_sync_state.last_success_at END,
               error_code = excluded.error_code",
            params![provider_id, cursor, status, now, error_code],
        ).map_err(db_error)?;

        Ok(())
    }

    pub fn catalog_is_app_installed(&self, app_id: &str) -> Result<bool, AppError> {
        let connection = self.connection.lock().map_err(db_error)?;
        let is_installed: bool = connection
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM installations i
                    JOIN installation_scan_state s ON s.installation_id = i.id
                    WHERE i.app_id = ?1 AND s.status = 'verified_local'
                )",
                [app_id],
                |row| row.get(0),
            )
            .map_err(db_error)?;
        Ok(is_installed)
    }

    pub fn catalog_get_local_installations(
        &self,
        app_id: &str,
    ) -> Result<Vec<LocalInstallation>, AppError> {
        let connection = self.connection.lock().map_err(db_error)?;
        get_local_installations(&connection, app_id).map_err(db_error)
    }

    pub fn catalog_get_sync_cursor(&self, provider_id: &str) -> Result<Option<String>, AppError> {
        let connection = self.connection.lock().map_err(db_error)?;
        let cursor = connection
            .query_row(
                "SELECT cursor FROM catalog_sync_state WHERE provider_id = ?1",
                [provider_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(db_error)?;
        Ok(cursor)
    }
}

use crate::{
    contracts::{
        catalog::{
            CatalogGameDetail, CatalogGameSummary, CatalogProviderStatus, CatalogSearchRequest,
            CatalogSearchResult, CatalogSyncResult,
        },
        AppError,
    },
    providers::{create_http_client, official, storefront},
    storage::Database,
};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    RwLock,
};

struct SyncGuard<'a>(&'a AtomicBool);
impl Drop for SyncGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests;

pub struct CatalogService {
    http_client: reqwest::Client,
    api_key: RwLock<Option<String>>,
    sync_running: AtomicBool,
}

impl Default for CatalogService {
    fn default() -> Self {
        Self {
            http_client: create_http_client(),
            api_key: RwLock::new(None),
            sync_running: AtomicBool::new(false),
        }
    }
}

impl CatalogService {
    pub fn set_api_key(&self, key: String) -> Result<(), AppError> {
        let trimmed = key.trim();
        let mut lock = self
            .api_key
            .write()
            .map_err(|_| AppError::new("INTERNAL", "Could not acquire API key lock.", false))?;
        if trimmed.is_empty() {
            *lock = None;
        } else {
            *lock = Some(trimmed.to_string());
        }
        Ok(())
    }

    pub fn get_api_key(&self) -> Option<String> {
        self.api_key.read().ok().and_then(|k| k.clone())
    }

    pub async fn search(
        &self,
        database: &Database,
        request: CatalogSearchRequest,
    ) -> Result<CatalogSearchResult, AppError> {
        let trimmed = request.query.trim();
        if trimmed.is_empty() {
            return Ok(CatalogSearchResult {
                games: Vec::new(),
                next_cursor: None,
                origin: "local".to_string(),
                stale: false,
                provider_id: None,
                provider_status: "ready".to_string(),
            });
        }

        let limit = request.limit.unwrap_or(20).clamp(1, 50);

        // Check if query is an exact numeric AppID
        let is_app_id = trimmed.chars().all(|c| c.is_ascii_digit()) && !trimmed.is_empty();

        if is_app_id {
            // First check if live details can be fetched
            match storefront::get_details(&self.http_client, trimmed).await {
                Ok(Some(mut detail)) => {
                    let local_installations = database.catalog_get_local_installations(trimmed)?;
                    detail.installed = local_installations
                        .iter()
                        .any(|i| i.status == "verified_local");
                    detail.local_installations = local_installations;
                    detail.local_installation_derived = !detail.local_installations.is_empty();

                    let _ = database.catalog_save_detail(&detail, "steam-storefront");

                    let summary = CatalogGameSummary {
                        app_id: detail.app_id,
                        name: detail.name,
                        artwork_url: detail.artwork_url,
                        installed: detail.installed,
                        metadata_source: detail.metadata_source,
                        item_type: detail.item_type,
                        last_modified_unix: None,
                    };

                    return Ok(CatalogSearchResult {
                        games: vec![summary],
                        next_cursor: None,
                        origin: "live".to_string(),
                        stale: false,
                        provider_id: Some("steam-storefront".to_string()),
                        provider_status: "ready".to_string(),
                    });
                }
                Ok(None) => {
                    // Not found online; check local cache
                    let cached = database.catalog_search_cached(trimmed, limit)?;
                    return Ok(CatalogSearchResult {
                        games: cached,
                        next_cursor: None,
                        origin: "cache".to_string(),
                        stale: true,
                        provider_id: Some("local-cache".to_string()),
                        provider_status: "ready".to_string(),
                    });
                }
                Err(err) => {
                    // Network or rate limit failure; fall back to local cache
                    let cached = database.catalog_search_cached(trimmed, limit)?;
                    let status = if err.code == "RATE_LIMITED" {
                        "rate_limited".to_string()
                    } else {
                        "offline".to_string()
                    };
                    return Ok(CatalogSearchResult {
                        games: cached,
                        next_cursor: None,
                        origin: "cache".to_string(),
                        stale: true,
                        provider_id: Some("local-cache".to_string()),
                        provider_status: status,
                    });
                }
            }
        }

        // Title search via storefront
        match storefront::search(&self.http_client, trimmed, limit).await {
            Ok(mut games) => {
                // Reconcile with local installations
                for game in &mut games {
                    game.installed = database
                        .catalog_is_app_installed(&game.app_id)
                        .unwrap_or(false);
                }
                // Persist live results to cache
                let _ = database.catalog_save_entries(&games, "steam-storefront");

                Ok(CatalogSearchResult {
                    games,
                    next_cursor: None,
                    origin: "live".to_string(),
                    stale: false,
                    provider_id: Some("steam-storefront".to_string()),
                    provider_status: "ready".to_string(),
                })
            }
            Err(err) => {
                // Fall back to local database cache
                let cached = database.catalog_search_cached(trimmed, limit)?;
                let status = if err.code == "RATE_LIMITED" {
                    "rate_limited".to_string()
                } else {
                    "offline".to_string()
                };

                Ok(CatalogSearchResult {
                    games: cached,
                    next_cursor: None,
                    origin: "cache".to_string(),
                    stale: true,
                    provider_id: Some("local-cache".to_string()),
                    provider_status: status,
                })
            }
        }
    }

    pub async fn get(
        &self,
        database: &Database,
        app_id: &str,
    ) -> Result<CatalogGameDetail, AppError> {
        let app_id = crate::services::library::normalized_id(app_id)?;

        // First check if cached rich metadata is already present
        let local_installations = database.catalog_get_local_installations(&app_id)?;
        let cached = database.catalog_get_cached(&app_id)?;

        // If we have cached details with description, we can use it or attempt refresh
        match storefront::get_details(&self.http_client, &app_id).await {
            Ok(Some(mut live_detail)) => {
                live_detail.installed = local_installations
                    .iter()
                    .any(|i| i.status == "verified_local");
                live_detail.local_installations = local_installations;
                live_detail.local_installation_derived =
                    !live_detail.local_installations.is_empty();

                let _ = database.catalog_save_detail(&live_detail, "steam-storefront");
                Ok(live_detail)
            }
            Ok(None) => {
                // App not found on Steam store; return cached if available
                if let Some(mut cached_detail) = cached {
                    cached_detail.installed = local_installations
                        .iter()
                        .any(|i| i.status == "verified_local");
                    cached_detail.local_installations = local_installations;
                    cached_detail.local_installation_derived =
                        !cached_detail.local_installations.is_empty();
                    Ok(cached_detail)
                } else {
                    Err(AppError::new(
                        "NOT_FOUND",
                        "Game was not found in Steam catalog or local index.",
                        false,
                    ))
                }
            }
            Err(err) => {
                // Network failed or rate limited; return cached if available
                if let Some(mut cached_detail) = cached {
                    cached_detail.installed = local_installations
                        .iter()
                        .any(|i| i.status == "verified_local");
                    cached_detail.local_installations = local_installations;
                    cached_detail.local_installation_derived =
                        !cached_detail.local_installations.is_empty();
                    Ok(cached_detail)
                } else {
                    Err(err)
                }
            }
        }
    }

    pub fn provider_status(
        &self,
        database: &Database,
    ) -> Result<Vec<CatalogProviderStatus>, AppError> {
        let mut providers = database.catalog_providers()?;
        let has_key = self
            .api_key
            .read()
            .ok()
            .map(|k| k.is_some())
            .unwrap_or(false);

        for p in &mut providers {
            if p.id == "steam-official" {
                if has_key {
                    p.status = "ready".to_string();
                    p.setup_needed = false;
                    p.enabled = true;
                } else {
                    p.status = "needs_configuration".to_string();
                    p.setup_needed = true;
                }
            }
        }

        Ok(providers)
    }

    pub async fn sync(
        &self,
        database: &Database,
        resume: bool,
    ) -> Result<CatalogSyncResult, AppError> {
        let api_key = match self.get_api_key() {
            Some(k) if !k.trim().is_empty() => k,
            _ => {
                return Err(AppError::new(
                    "PROVIDER_UNAVAILABLE",
                    "Steam Web API key is not configured. Provide an API key before syncing.",
                    false,
                ));
            }
        };

        if self
            .sync_running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err(AppError::new(
                "CONFLICT",
                "Catalog synchronization is already in progress.",
                true,
            ));
        }
        let _guard = SyncGuard(&self.sync_running);

        let start_cursor: Option<u64> = if resume {
            database
                .catalog_get_sync_cursor("steam-official")
                .ok()
                .flatten()
                .and_then(|c| c.parse::<u64>().ok())
        } else {
            None
        };

        let mut current_cursor = start_cursor;
        let mut total_processed = 0;
        let max_pages = 3; // Bounded sync batch: 3 pages per sync run

        for _ in 0..max_pages {
            let page = match official::fetch_app_list_page(
                &self.http_client,
                &api_key,
                1000,
                current_cursor,
            )
            .await
            {
                Ok(p) => p,
                Err(err) => {
                    let _ = database.catalog_update_sync_state(
                        "steam-official",
                        "failed",
                        current_cursor.map(|c| c.to_string()).as_deref(),
                        Some(err.code),
                    );
                    return Err(err);
                }
            };

            let count = page.games.len();
            if count == 0 {
                let _ = database.catalog_update_sync_state(
                    "steam-official",
                    "complete",
                    current_cursor.map(|c| c.to_string()).as_deref(),
                    None,
                );
                break;
            }

            database.catalog_save_entries(&page.games, "steam-official")?;
            total_processed += count;

            if let Some(next) = page
                .next_cursor
                .as_deref()
                .and_then(|c| c.parse::<u64>().ok())
            {
                current_cursor = Some(next);
            }

            let status = if page.have_more {
                "partial"
            } else {
                "complete"
            };
            let _ = database.catalog_update_sync_state(
                "steam-official",
                status,
                current_cursor.map(|c| c.to_string()).as_deref(),
                None,
            );

            if !page.have_more {
                break;
            }
        }

        Ok(CatalogSyncResult {
            status: "succeeded".to_string(),
            processed: total_processed,
            message: format!("Synchronized {} catalog entries.", total_processed),
        })
    }
}

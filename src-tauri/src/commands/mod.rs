use crate::{
    contracts::{ApiResult, HealthResult},
    services::diagnostics::{self, Diagnostics},
    storage::Database,
};
pub mod workspace;

#[tauri::command]
pub fn app_health(
    database: tauri::State<'_, Database>,
    diagnostics: tauri::State<'_, Diagnostics>,
) -> ApiResult<HealthResult> {
    diagnostics::health(&database, &diagnostics)
}

#[tauri::command]
pub fn library_list(
    database: tauri::State<'_, Database>,
) -> ApiResult<crate::contracts::library::LibrarySnapshot> {
    ApiResult::from_result(database.library_snapshot())
}

#[tauri::command]
pub fn library_get(
    database: tauri::State<'_, Database>,
    app_id: String,
) -> ApiResult<crate::contracts::library::LocalGameDetail> {
    ApiResult::from_result(
        crate::services::library::normalized_id(&app_id)
            .and_then(|app_id| database.library_get(&app_id)),
    )
}

#[tauri::command]
pub async fn library_scan(
    app: tauri::AppHandle,
    request: Option<crate::contracts::library::LibraryScanRequest>,
) -> ApiResult<crate::contracts::library::LibraryScanResult> {
    use tauri::Manager;
    match tauri::async_runtime::spawn_blocking(move || {
        let service = app.state::<crate::services::library::LibraryService>();
        let _scan = service.scan_lock.try_lock().map_err(|_| {
            crate::contracts::AppError::new(
                "CONFLICT",
                "A library scan is already running. Wait for it to finish.",
                true,
            )
        })?;
        crate::services::library::scan(&app.state::<Database>(), request.unwrap_or_default())
    })
    .await
    {
        Ok(result) => ApiResult::from_result(result),
        Err(_) => ApiResult::internal("Library scan could not complete."),
    }
}

#[tauri::command]
pub async fn catalog_search(
    app: tauri::AppHandle,
    request: crate::contracts::catalog::CatalogSearchRequest,
) -> ApiResult<crate::contracts::catalog::CatalogSearchResult> {
    use tauri::Manager;
    let database = app.state::<Database>();
    let catalog = app.state::<crate::services::catalog::CatalogService>();
    ApiResult::from_result(catalog.search(&database, request).await)
}

#[tauri::command]
pub async fn catalog_get(
    app: tauri::AppHandle,
    app_id: String,
) -> ApiResult<crate::contracts::catalog::CatalogGameDetail> {
    use tauri::Manager;
    let database = app.state::<Database>();
    let catalog = app.state::<crate::services::catalog::CatalogService>();
    ApiResult::from_result(catalog.get(&database, &app_id).await)
}

#[tauri::command]
pub fn catalog_provider_status(
    database: tauri::State<'_, Database>,
    catalog: tauri::State<'_, crate::services::catalog::CatalogService>,
) -> ApiResult<Vec<crate::contracts::catalog::CatalogProviderStatus>> {
    ApiResult::from_result(catalog.provider_status(&database))
}

#[tauri::command]
pub fn catalog_set_api_key(
    catalog: tauri::State<'_, crate::services::catalog::CatalogService>,
    request: crate::contracts::catalog::CatalogSetApiKeyRequest,
) -> ApiResult<bool> {
    ApiResult::from_result(catalog.set_api_key(request.api_key).map(|_| true))
}

#[tauri::command]
pub async fn catalog_sync(
    app: tauri::AppHandle,
    request: Option<crate::contracts::catalog::CatalogSyncRequest>,
) -> ApiResult<crate::contracts::catalog::CatalogSyncResult> {
    use tauri::Manager;
    let database = app.state::<Database>();
    let catalog = app.state::<crate::services::catalog::CatalogService>();
    let resume = request.and_then(|r| r.resume).unwrap_or(false);
    ApiResult::from_result(catalog.sync(&database, resume).await)
}

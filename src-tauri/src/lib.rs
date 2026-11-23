mod commands;
mod config;
mod contracts;
mod providers;
mod services;
mod storage;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(services::updates::Updates::default())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if let Err(error) = services::updates::install_pending(window.app_handle()) {
                    eprintln!("Update installation deferred: {error}");
                }
            }
        })
        .setup(|app| {
            let config = config::AppConfig::load(app)?;
            std::fs::create_dir_all(config.database_file.parent().expect("app data directory"))?;
            std::fs::create_dir_all(config.diagnostic_file.parent().expect("app log directory"))?;
            let diagnostics = services::diagnostics::Diagnostics::open(&config.diagnostic_file)?;
            diagnostics.record(services::diagnostics::DiagnosticEvent::Startup)?;
            let database = storage::Database::open(&config.database_file).map_err(|_| {
                let _ = diagnostics.record(services::diagnostics::DiagnosticEvent::DatabaseInitializationFailed);
                std::io::Error::other("Local database initialization failed; check permissions and schema compatibility")
            })?;
            database.workspace_recover().map_err(|e| std::io::Error::other(e.message))?;
            app.manage(services::workspace::WorkspaceService::new(config.database_file.parent().expect("data directory").to_path_buf(), config.diagnostic_file.clone())?);
            diagnostics.record(services::diagnostics::DiagnosticEvent::DatabaseReady)?;
            app.manage(database);
            app.manage(diagnostics);
            app.manage(config);
            app.manage(services::library::LibraryService::default());
            app.manage(services::catalog::CatalogService::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_health,
            services::updates::automatic_updates,
            commands::library_scan,
            commands::library_list,
            commands::library_get,
            commands::catalog_search,
            commands::catalog_get,
            commands::catalog_provider_status,
            commands::catalog_set_api_key,
            commands::catalog_sync,
            commands::workspace::workspace_snapshot,
            commands::workspace::library_shortcuts,
            commands::workspace::workspace_operation,
            commands::workspace::workspace_cancel,
            commands::workspace::workspace_settings,
            commands::workspace::workspace_associate,
            commands::workspace::workspace_note,
            commands::workspace::workspace_read,
            commands::workspace::workspace_create,
            commands::workspace::steamtools_generate,
            commands::workspace::steamtools_lookup,
            commands::workspace::game_data_sources,
            commands::workspace::game_data_credential,
            commands::workspace::steamtools_import_lookup,
            commands::workspace::steamtools_add,
            commands::workspace::steam_runtime,
            commands::workspace::online_fix_discover,
            commands::workspace::online_fix_operation,
            commands::workspace::online_fix_status,
            commands::workspace::online_fix_games,
            commands::workspace::lua_library,
            commands::workspace::lua_removal,
            commands::workspace::game_status,
            commands::workspace::game_status_summaries,
            commands::workspace::game_launch_report,
            commands::workspace::steam_store_prices,
            commands::workspace::steamtools_provider,
            commands::workspace::select_library_folder,
            commands::workspace::open_reference,
            commands::workspace::steam_action,
            commands::workspace::open_workspace_folder,
        ])
        .run(tauri::generate_context!())
        .expect(
            "SteamHub could not start; check local data permissions and database compatibility",
        );
}

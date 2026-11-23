use crate::{
    contracts::{ApiResult, AppError},
    services::workspace::*,
    storage::Database,
};
use tauri::{Emitter, Manager};

fn detected_steam_root() -> Option<String> {
    #[cfg(windows)]
    {
        let hkcu = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
        if let Ok(key) = hkcu.open_subkey("Software\\Valve\\Steam") {
            if let Ok(path) = key.get_value::<String, _>("SteamPath") {
                if std::path::Path::new(&path).join("steam.exe").is_file() {
                    return Some(path);
                }
            }
        }
    }
    None
}

#[tauri::command]
pub async fn steam_store_prices(
    apps: Vec<String>,
    country: String,
    refresh: bool,
) -> ApiResult<Vec<crate::services::store_prices::Quote>> {
    ApiResult::from_result(crate::services::store_prices::prices(apps, country, refresh).await)
}

fn game_build(app_handle: &tauri::AppHandle, app: &str) -> Result<String, AppError> {
    match app_handle.state::<Database>().library_get(app) {
        Ok(game) => {
            let mut builds: Vec<_> = game
                .installations
                .iter()
                .filter(|i| i.status == "verified_local")
                .map(|i| {
                    format!(
                        "{}:{}",
                        i.install_path,
                        i.build_id.as_deref().unwrap_or("unknown")
                    )
                })
                .collect();
            builds.sort();
            Ok(builds.join("|"))
        }
        Err(error) if error.code == "NOT_FOUND" => Ok(String::new()),
        Err(error) => Err(error),
    }
}
#[tauri::command]
pub async fn game_status(
    app_handle: tauri::AppHandle,
    app: String,
    refresh: bool,
) -> ApiResult<crate::services::game_status::Status> {
    let app = match crate::services::game_status::app(&app) {
        Ok(app) => app,
        Err(error) => return ApiResult::from_result(Err(error)),
    };
    let directory = app_handle.state::<WorkspaceService>().directory.clone();
    let local_app = app.clone();
    let local = tauri::async_runtime::spawn_blocking(move || {
        let app = local_app;
        let service = app_handle.state::<WorkspaceService>();
        let db = app_handle.state::<Database>();
        let lua = crate::services::lua_tracking::apps(&service.directory, &db)?.contains(&app);
        let installation = match db.library_get(&app) {
            Ok(game) => game.summary.install_status,
            Err(error) if error.code == "NOT_FOUND" => "not_checked".into(),
            Err(error) => return Err(error),
        };
        let runtime = detected_steam_root()
            .and_then(|root| crate::services::runtime::status(std::path::Path::new(&root)).ok())
            .map(|status| status.installed);
        let fix = if lua && installation == "verified_local" {
            match fix_root(&app_handle, &app)
                .and_then(|root| crate::services::fix_install::status(&root, &app))
            {
                Ok(status) if status.installed => "verified",
                Ok(status) if status.can_undo => "changed",
                Ok(_) => "not_applied",
                Err(_) => "not_checked",
            }
        } else {
            "not_checked"
        };
        let personal = crate::services::game_status::personal(&service.directory, &app);
        let report_outdated =
            personal.updated_at.is_some() && personal.build != game_build(&app_handle, &app)?;
        Ok(crate::services::game_status::Status {
            app_id: app,
            lua,
            installation,
            runtime,
            fix: fix.into(),
            compatibility: Default::default(),
            stale: true,
            personal,
            report_outdated,
        })
    })
    .await;
    let mut status = match local {
        Ok(Ok(status)) => status,
        Ok(Err(error)) => return ApiResult::from_result(Err(error)),
        Err(_) => return ApiResult::internal("Could not check game setup."),
    };
    status.compatibility =
        crate::services::game_status::compatibility(&directory, &app, refresh).await;
    status.stale = crate::services::game_status::stale(&status.compatibility);
    ApiResult::success(status)
}
#[tauri::command]
pub fn game_status_summaries(
    service: tauri::State<'_, WorkspaceService>,
    apps: Vec<String>,
) -> ApiResult<Vec<crate::services::game_status::Summary>> {
    ApiResult::from_result(crate::services::game_status::summaries(
        &service.directory,
        apps,
    ))
}
#[tauri::command]
pub fn game_launch_report(
    app_handle: tauri::AppHandle,
    app: String,
    result: crate::services::game_status::LaunchResult,
    note: String,
) -> ApiResult<crate::services::game_status::Personal> {
    ApiResult::from_result((|| {
        let app = crate::services::game_status::app(&app)?;
        let service = app_handle.state::<WorkspaceService>();
        let _guard = service.lock.try_lock().map_err(|_| {
            AppError::new(
                "CONFLICT",
                "Wait for the current workspace operation.",
                true,
            )
        })?;
        let build = game_build(&app_handle, &app)?;
        if build.is_empty() && result != crate::services::game_status::LaunchResult::Untested {
            return Err(AppError::new(
                "NOT_FOUND",
                "Scan the installed game before recording a launch result.",
                true,
            ));
        }
        crate::services::game_status::report(&service.directory, &app, result, note, build)
    })())
}

#[tauri::command]
pub async fn steamtools_lookup(
    app_handle: tauri::AppHandle,
    app: String,
    request_id: Option<String>,
) -> ApiResult<crate::providers::game_data::Lookup> {
    let result = async {
        let directory = app_handle.state::<WorkspaceService>().directory.clone();
        let configured = crate::providers::game_data::sources(&directory)?;
        let report = |progress: crate::providers::game_data::LookupProgress| {
            if let Some(id) = request_id.as_ref().filter(|id| id.len() <= 80) {
                let _ = app_handle.emit_to("main", "steamhub:lookup-progress", serde_json::json!({
                    "requestId": id, "app": app, "index": progress.index,
                    "source": progress.source, "status": progress.status, "detail": progress.detail,
                }));
            }
        };
        let cached =
            crate::providers::game_data::fetch(&app, &configured, &directory, report).await?;
        cache_game_data(&app_handle, cached)
    }
    .await;
    ApiResult::from_result(result)
}

fn cache_game_data(
    app_handle: &tauri::AppHandle,
    cached: crate::providers::game_data::CachedLookup,
) -> Result<crate::providers::game_data::Lookup, AppError> {
    let generated = crate::providers::game_data::parse_cached(&cached)?.generated;
    let bytes = serde_json::to_vec(&cached)
        .map_err(|_| AppError::new("IO_ERROR", "Could not cache lookup.", true))?;
    if bytes.len() > 128 * 1024 * 1024 {
        return Err(AppError::new(
            "GAME_DATA_UNAVAILABLE",
            "Game-data cache exceeds 128 MiB.",
            false,
        ));
    }
    let id = crate::providers::game_data::digest(&bytes);
    let directory = app_handle
        .state::<WorkspaceService>()
        .directory
        .join("lookups");
    std::fs::create_dir_all(&directory)
        .and_then(|_| std::fs::write(directory.join(format!("{id}.json")), bytes))
        .map_err(|_| AppError::new("IO_ERROR", "Could not save lookup data.", true))?;
    Ok(crate::providers::game_data::Lookup {
        id,
        app: cached.app,
        source: cached.source,
        generated,
        steam_root: detected_steam_root(),
    })
}

#[tauri::command]
pub fn game_data_sources(
    service: tauri::State<'_, WorkspaceService>,
    sources: Option<Vec<crate::providers::game_data::DataSource>>,
) -> ApiResult<Vec<crate::providers::game_data::DataSource>> {
    ApiResult::from_result((|| {
        if let Some(sources) = sources {
            let _guard = service.lock.try_lock().map_err(|_| {
                AppError::new(
                    "CONFLICT",
                    "Wait for the current workspace operation.",
                    true,
                )
            })?;
            crate::providers::game_data::save_sources(&service.directory, &sources)?;
        }
        crate::providers::game_data::sources(&service.directory)
    })())
}

#[tauri::command]
pub fn game_data_credential(
    service: tauri::State<'_, WorkspaceService>,
    provider: String,
    key: Option<String>,
) -> ApiResult<bool> {
    ApiResult::from_result((|| {
        let _guard = service.lock.try_lock().map_err(|_| {
            AppError::new(
                "CONFLICT",
                "Wait for the current workspace operation.",
                true,
            )
        })?;
        crate::providers::game_data::credentials::save(
            &service.directory,
            &provider,
            key.as_deref(),
        )?;
        Ok(true)
    })())
}

#[tauri::command]
pub async fn steamtools_import_lookup(
    app_handle: tauri::AppHandle,
    app: String,
    path: Option<String>,
) -> ApiResult<Option<crate::providers::game_data::Lookup>> {
    match tauri::async_runtime::spawn_blocking(move || {
        let app = app_id(&app)?
            .ok_or_else(|| AppError::new("INVALID_INPUT", "Choose a game first.", false))?;
        let path = if let Some(path) = path {
            std::path::PathBuf::from(path)
        } else {
            let Some(path) = rfd::FileDialog::new()
                .set_title("Import game data")
                .add_filter("Game data", &["lua", "zip"])
                .pick_file()
            else {
                return Ok(None);
            };
            path
        };
        use std::io::Read;
        let format = path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !["lua", "zip"].contains(&format.as_str()) {
            return Err(AppError::new(
                "INVALID_INPUT",
                "Choose a Lua or ZIP file.",
                false,
            ));
        }
        let mut archive = Vec::new();
        std::fs::File::open(&path)
            .and_then(|f| f.take(32 * 1024 * 1024 + 1).read_to_end(&mut archive))
            .map_err(|_| AppError::new("IO_ERROR", "Could not read game-data file.", true))?;
        if archive.len() > 32 * 1024 * 1024 {
            return Err(AppError::new(
                "INVALID_INPUT",
                "Game-data file exceeds 32 MiB.",
                false,
            ));
        }
        let source = format!(
            "Imported {}",
            path.file_name().unwrap_or_default().to_string_lossy()
        );
        cache_game_data(
            &app_handle,
            crate::providers::game_data::CachedLookup {
                app,
                source,
                archive,
                dlcs: String::new(),
                format,
                extra_manifests: vec![],
                warnings: vec![],
            },
        )
        .map(Some)
    })
    .await
    {
        Ok(result) => ApiResult::from_result(result),
        Err(_) => ApiResult::internal("Could not import game data."),
    }
}

#[tauri::command]
pub async fn steamtools_add(
    app_handle: tauri::AppHandle,
    id: String,
    steam_root: String,
) -> ApiResult<crate::services::lua::GeneratedLua> {
    match tauri::async_runtime::spawn_blocking(move || {
        let service = app_handle.state::<WorkspaceService>();
        let cached = crate::providers::game_data::load(&service.directory.join("lookups"), &id)?;
        let mut bundle = crate::providers::game_data::parse_cached(&cached)?;
        let root = crate::services::lua::runtime_root(std::path::Path::new(&steam_root))?;
        let cache = root.join("depotcache");
        std::fs::create_dir_all(&cache)
            .map_err(|_| AppError::new("IO_ERROR", "Could not create Steam depotcache.", true))?;
        if !cache
            .canonicalize()
            .map_err(|_| AppError::new("IO_ERROR", "Could not inspect depotcache.", true))?
            .starts_with(&root)
        {
            return Err(AppError::new(
                "CONFLICT",
                "Steam depotcache redirects outside the selected installation.",
                false,
            ));
        }
        // Check all conflicts before any live writes.
        let target = root.join("config/lua").join(&bundle.generated.filename);
        if target.exists()
            && std::fs::read(&target).ok().as_deref() != Some(bundle.generated.text.as_bytes())
        {
            return Err(AppError::new(
                "CONFLICT",
                "A different generated Lua already exists. Back it up before replacing it.",
                false,
            ));
        }
        for (name, bytes) in &bundle.manifests {
            let target = cache.join(name);
            if target.exists() && std::fs::read(&target).ok().as_deref() != Some(bytes.as_slice()) {
                return Err(AppError::new(
                    "CONFLICT",
                    "A cached manifest has different contents. Existing data was preserved.",
                    false,
                ));
            }
        }
        service.create(
            &app_handle.state::<Database>(),
            &bundle.generated.filename,
            &bundle.generated.text,
            &cached.app,
            &cached.source,
            "AppID lookup v1",
        )?;
        for (name, bytes) in &bundle.manifests {
            use std::io::Write;
            service.import_bytes(&app_handle.state::<Database>(), name, bytes, None)?;
            let target = cache.join(name);
            if target.exists() {
                continue;
            }
            let temporary = cache.join(format!(".steamhub-{}-{}.tmp", id, now()));
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .map_err(|_| AppError::new("IO_ERROR", "Could not write cached manifest.", true))?;
            let written = file.write_all(bytes).and_then(|_| file.sync_all());
            drop(file);
            let published = written.and_then(|_| std::fs::hard_link(&temporary, &target));
            let _ = std::fs::remove_file(&temporary);
            published.map_err(|_| {
                AppError::new(
                    "IO_ERROR",
                    "Could not publish cached manifest. Retry Add to Steam.",
                    true,
                )
            })?;
        }
        bundle.generated.installed_path =
            Some(crate::services::lua::install(&root, &bundle.generated)?);
        crate::services::lua_tracking::record(
            &service.directory,
            &root,
            &cached.app,
            &bundle.generated.text,
        )?;
        Ok(bundle.generated)
    })
    .await
    {
        Ok(result) => ApiResult::from_result(result),
        Err(_) => ApiResult::internal("Could not add game data to Steam."),
    }
}

#[tauri::command]
pub async fn steamtools_generate(
    app_handle: tauri::AppHandle,
    app: String,
    depots: String,
    dlcs: String,
    steam_root: Option<String>,
    deploy: bool,
) -> ApiResult<crate::services::lua::GeneratedLua> {
    match tauri::async_runtime::spawn_blocking(move || {
        let (depots, local_dlcs) = if depots.trim().is_empty() {
            let root = steam_root.as_ref().ok_or_else(|| {
                AppError::new(
                    "INVALID_INPUT",
                    "Select Steam and scan your installed library, or supply depot data.",
                    false,
                )
            })?;
            let game = app_handle.state::<Database>().library_get(&app)?;
            let installed = game
                .installations
                .iter()
                .find(|i| i.status == "verified_local")
                .ok_or_else(|| {
                    AppError::new(
                        "NOT_FOUND",
                        "Scan a local installation first, or supply depot data manually.",
                        true,
                    )
                })?;
            crate::services::lua::local_rows(
                std::path::Path::new(root),
                std::path::Path::new(&installed.source_acf_path),
                &app,
            )?
        } else {
            (depots, String::new())
        };
        let mut generated = crate::services::lua::generate(&app, &depots, &format!("{dlcs}\n{local_dlcs}"))?;
        let cached = if let Some(root) = steam_root.as_ref() {
            crate::services::manifest::collect(std::path::Path::new(root), &generated.text)?
        } else { vec![] };
        let expected = generated.text.lines().filter(|l| l.starts_with("setManifestid(")).count();
        if cached.len() < expected { generated.warnings.push(format!("{} pinned manifests are not in the selected Steam depotcache. Steam will need to fetch them.", expected - cached.len())); }
        generated.warnings.push("Cached manifests are hash checked as opaque files; signatures and entitlement are not verified.".into());
        if deploy {
            let root = steam_root.ok_or_else(|| {
                AppError::new(
                    "INVALID_INPUT",
                    "Select the Steam installation folder.",
                    false,
                )
            })?;
            let service = app_handle.state::<WorkspaceService>();
            service.create(
                &app_handle.state::<Database>(),
                &generated.filename,
                &generated.text,
                &app,
                "Generated locally by SteamHub",
                "SteamTools v1",
            )?;
            for (manifest, bytes) in &cached {
                service.import_bytes(&app_handle.state::<Database>(), &manifest.name, bytes, None)?;
            }
            generated.installed_path = Some(crate::services::lua::install(
                std::path::Path::new(&root),
                &generated,
            )?);
            crate::services::lua_tracking::record(&service.directory, std::path::Path::new(&root), &app, &generated.text)?;
        }
        generated.manifests = cached.into_iter().map(|(record, _)| record).collect();
        Ok(generated)
    })
    .await
    {
        Ok(result) => ApiResult::from_result(result),
        Err(_) => ApiResult::internal("Could not generate SteamTools configuration."),
    }
}

#[tauri::command]
pub async fn steamtools_provider(
    app_handle: tauri::AppHandle,
    base: String,
    steam_root: Option<String>,
) -> ApiResult<crate::services::lua::GeneratedLua> {
    match tauri::async_runtime::spawn_blocking(move || {
        let mut generated = crate::services::manifest::provider(&base)?;
        if let Some(root) = steam_root {
            app_handle.state::<WorkspaceService>().create(
                &app_handle.state::<Database>(),
                &generated.filename,
                &generated.text,
                "",
                "SteamHub request-code adapter",
                "v1",
            )?;
            generated.installed_path = Some(crate::services::lua::install(
                std::path::Path::new(&root),
                &generated,
            )?);
        }
        Ok(generated)
    })
    .await
    {
        Ok(result) => ApiResult::from_result(result),
        Err(_) => ApiResult::internal("Could not configure the request-code provider."),
    }
}

#[tauri::command]
pub async fn library_shortcuts(
    app: tauri::AppHandle,
) -> ApiResult<crate::services::shortcuts::ShortcutSnapshot> {
    match tauri::async_runtime::spawn_blocking(move || {
        crate::services::shortcuts::scan(&app.state::<Database>())
    })
    .await
    {
        Ok(r) => ApiResult::from_result(r),
        Err(_) => ApiResult::internal("Could not scan non-Steam shortcuts."),
    }
}

#[tauri::command]
pub async fn workspace_create(
    app_handle: tauri::AppHandle,
    name: String,
    text: String,
    app: String,
    source: String,
    version: String,
) -> ApiResult<bool> {
    match tauri::async_runtime::spawn_blocking(move || {
        app_handle.state::<WorkspaceService>().create(
            &app_handle.state::<Database>(),
            &name,
            &text,
            &app,
            &source,
            &version,
        )
    })
    .await
    {
        Ok(r) => ApiResult::from_result(r),
        Err(_) => ApiResult::internal("Could not save configuration."),
    }
}

#[tauri::command]
pub fn workspace_snapshot(
    db: tauri::State<'_, Database>,
    service: tauri::State<'_, WorkspaceService>,
) -> ApiResult<WorkspaceSnapshot> {
    ApiResult::from_result(service.snapshot(&db))
}
#[tauri::command]
pub async fn workspace_operation(
    app: tauri::AppHandle,
    request: OperationRequest,
) -> ApiResult<OperationResult> {
    match tauri::async_runtime::spawn_blocking(move || {
        app.state::<WorkspaceService>()
            .operate(&app.state::<Database>(), request)
    })
    .await
    {
        Ok(r) => ApiResult::from_result(r),
        Err(_) => ApiResult::internal(
            "Workspace worker stopped unexpectedly. Restart SteamHub and retry.",
        ),
    }
}
#[tauri::command]
pub fn workspace_cancel(service: tauri::State<'_, WorkspaceService>) -> ApiResult<bool> {
    service
        .cancel
        .store(true, std::sync::atomic::Ordering::SeqCst);
    ApiResult::success(true)
}
#[tauri::command]
pub fn workspace_settings(
    db: tauri::State<'_, Database>,
    settings: WorkspaceSettings,
) -> ApiResult<bool> {
    ApiResult::from_result(
        validate_settings(&settings)
            .and_then(|_| db.workspace_save_settings(&settings))
            .map(|_| true),
    )
}
#[tauri::command]
pub fn workspace_associate(
    db: tauri::State<'_, Database>,
    id: String,
    app: String,
    source: String,
    version: String,
) -> ApiResult<bool> {
    ApiResult::from_result((|| {
        if source.len() > 1024 || version.len() > 128 {
            return Err(AppError::new(
                "INVALID_INPUT",
                "Source or version is too long.",
                false,
            ));
        }
        db.workspace_associate(&id, app_id(&app)?, &source, &version)?;
        Ok(true)
    })())
}
#[tauri::command]
pub fn workspace_note(
    db: tauri::State<'_, Database>,
    app: String,
    body: String,
) -> ApiResult<bool> {
    ApiResult::from_result((|| {
        let app = app_id(&app)?
            .ok_or_else(|| AppError::new("INVALID_INPUT", "Enter an AppID.", false))?;
        if body.len() > 32768 {
            return Err(AppError::new(
                "INVALID_INPUT",
                "Notes may contain up to 32 KiB.",
                false,
            ));
        }
        db.workspace_save_note(&app, &body)?;
        Ok(true)
    })())
}
#[tauri::command]
pub async fn workspace_read(app: tauri::AppHandle, id: String) -> ApiResult<String> {
    match tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<Database>();
        let service = app.state::<WorkspaceService>();
        let record = db
            .workspace_files()?
            .into_iter()
            .find(|r| r.id == id)
            .ok_or_else(|| AppError::new("NOT_FOUND", "File not found.", false))?;
        let bytes = service.preview(&record)?;
        Ok(bytes)
    })
    .await
    {
        Ok(r) => ApiResult::from_result(r),
        Err(_) => ApiResult::internal("Could not inspect file."),
    }
}
#[tauri::command]
pub async fn select_library_folder() -> ApiResult<Option<String>> {
    match tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Select Steam or SteamLibrary folder containing steamapps")
            .pick_folder()
            .map(|p| p.display().to_string())
    })
    .await
    {
        Ok(p) => ApiResult::success(p),
        Err(_) => ApiResult::internal("Could not open folder dialog."),
    }
}

fn launch(target: &str) -> Result<(), AppError> {
    open::that_detached(target).map_err(|_| {
        AppError::new(
            "IO_ERROR",
            "Windows could not open the requested application or link.",
            true,
        )
    })
}
#[tauri::command]
pub fn open_reference(url: String) -> ApiResult<bool> {
    ApiResult::from_result((|| {
        let parsed = reqwest::Url::parse(&url)
            .map_err(|_| AppError::new("INVALID_INPUT", "Invalid URL.", false))?;
        let allowed = [
            "store.steampowered.com",
            "help.steampowered.com",
            "partner.steamgames.com",
            "steamcommunity.com",
            "github.com",
            "openlua.cloud",
            "guide.openlua.cloud",
            "lua.tools",
            "hubcapmanifest.com",
            "generator.ryuu.lol",
            "manifestdex.com",
            "manifesthub2.filegear-sg.me",
            "catmisteam.com",
        ];
        if parsed.scheme() != "https"
            || !allowed.contains(&parsed.host_str().unwrap_or(""))
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.port().is_some()
        {
            return Err(AppError::new(
                "UNTRUSTED_SOURCE",
                "Only approved HTTPS reference sites can be opened.",
                false,
            ));
        }
        launch(parsed.as_str())?;
        Ok(true)
    })())
}
#[tauri::command]
pub fn steam_action(
    db: tauri::State<'_, Database>,
    app: String,
    action: String,
) -> ApiResult<bool> {
    ApiResult::from_result((|| {
        let id = app_id(&app)?
            .ok_or_else(|| AppError::new("INVALID_INPUT", "Enter an AppID.", false))?;
        if action == "library" {
            launch(&format!("steam://nav/games/details/{id}"))?;
            return Ok(true);
        }
        let game = db.library_get(&id)?;
        if !game
            .installations
            .iter()
            .any(|i| i.status == "verified_local")
        {
            return Err(AppError::new(
                "CONFLICT",
                "Rescan and verify a local installation first.",
                true,
            ));
        }
        let protocol = match action.as_str() {
            "launch" => format!("steam://rungameid/{id}"),
            "verify" => format!("steam://validate/{id}"),
            "properties" => format!("steam://gameproperties/{id}"),
            _ => {
                return Err(AppError::new(
                    "INVALID_INPUT",
                    "Unsupported Steam action.",
                    false,
                ))
            }
        };
        launch(&protocol)?;
        db.workspace_event("steam","completed",&format!("Sent {action} request for AppID {id} to Steam. Steam controls completion and access."))?;
        Ok(true)
    })())
}
#[tauri::command]
pub fn open_workspace_folder(
    service: tauri::State<'_, WorkspaceService>,
    logs: bool,
) -> ApiResult<bool> {
    let path = if logs {
        service.log_file.parent().unwrap_or(&service.directory)
    } else {
        &service.directory
    };
    ApiResult::from_result(launch(&path.display().to_string()).map(|_| true))
}

#[tauri::command]
pub async fn steam_runtime(
    steam_root: Option<String>,
    action: String,
) -> ApiResult<crate::services::runtime::Status> {
    let result = tauri::async_runtime::spawn_blocking(move || {
        let root = steam_root.or_else(detected_steam_root).ok_or_else(|| {
            AppError::new(
                "RUNTIME_SETUP",
                "Choose the Steam folder containing steam.exe.",
                true,
            )
        })?;
        let path = std::path::Path::new(&root);
        match action.as_str() {
            "status" => crate::services::runtime::status(path),
            "install" => crate::services::runtime::change(path, false),
            "undo" => crate::services::runtime::change(path, true),
            _ => Err(AppError::new(
                "INVALID_INPUT",
                "Unknown runtime action.",
                false,
            )),
        }
    })
    .await;
    match result {
        Ok(value) => ApiResult::from_result(value),
        Err(_) => ApiResult::internal("Runtime setup could not finish."),
    }
}

#[tauri::command]
pub async fn online_fix_discover(
    app_handle: tauri::AppHandle,
    app: String,
) -> ApiResult<crate::services::fixes::Discovery> {
    let service = app_handle.state::<WorkspaceService>();
    if let Err(error) = crate::services::lua_tracking::require(
        &service.directory,
        &app_handle.state::<Database>(),
        &app,
    ) {
        return ApiResult::from_result(Err(error));
    }
    if crate::services::online_support::check(&service.directory, &app, false).await != Some(true) {
        return ApiResult::from_result(Err(AppError::new(
            "NOT_FOUND",
            "This game's online multiplayer/co-op support is not confirmed.",
            true,
        )));
    }
    ApiResult::from_result(crate::services::fixes::discover(&app).await)
}

fn fix_root(app_handle: &tauri::AppHandle, app: &str) -> Result<std::path::PathBuf, AppError> {
    let db = app_handle.state::<Database>();
    let service = app_handle.state::<WorkspaceService>();
    crate::services::lua_tracking::require(&service.directory, &db, app)?;
    let game = db.library_get(app)?;
    let mut installed = game
        .installations
        .iter()
        .filter(|i| i.status == "verified_local");
    let installation = installed.next().ok_or_else(|| {
        AppError::new(
            "NOT_FOUND",
            "Download the game and refresh installed games first.",
            false,
        )
    })?;
    if installed.next().is_some() {
        return Err(AppError::new(
            "CONFLICT",
            "Multiple installations found. Scan only the library you want to modify.",
            false,
        ));
    }
    let root = std::path::Path::new(&installation.install_path)
        .canonicalize()
        .map_err(|_| {
            AppError::new(
                "NOT_FOUND",
                "Game folder is missing. Refresh installed games.",
                true,
            )
        })?;
    let common = std::path::Path::new(&installation.library_root)
        .join("steamapps/common")
        .canonicalize()
        .map_err(|_| AppError::new("NOT_FOUND", "Steam library folder is missing.", true))?;
    if !root.starts_with(&common) || root == common {
        return Err(AppError::new(
            "CONFLICT",
            "Game folder is outside its verified Steam library.",
            false,
        ));
    }
    Ok(root)
}
#[tauri::command]
pub async fn online_fix_status(
    app_handle: tauri::AppHandle,
    app: String,
) -> ApiResult<crate::services::fix_install::InstalledStatus> {
    match tauri::async_runtime::spawn_blocking(move || {
        let root = fix_root(&app_handle, &app)?;
        crate::services::fix_install::status(&root, &app)
    })
    .await
    {
        Ok(value) => ApiResult::from_result(value),
        Err(_) => ApiResult::internal("Could not verify installed fix files."),
    }
}
#[tauri::command]
pub async fn online_fix_operation(
    app_handle: tauri::AppHandle,
    app: String,
    action: String,
    id: Option<String>,
) -> ApiResult<Option<crate::services::fix_install::Plan>> {
    match tauri::async_runtime::spawn_blocking(move || {
        let app =
            app_id(&app)?.ok_or_else(|| AppError::new("INVALID_INPUT", "Select a game.", false))?;
        let root = fix_root(&app_handle, &app)?;
        if action != "undo" {
            crate::services::online_support::require_cached(
                &app_handle.state::<WorkspaceService>().directory,
                &app,
            )?;
        }
        let cache = app_handle
            .state::<WorkspaceService>()
            .directory
            .join("fix-packages");
        match action.as_str() {
            "preview" => {
                let Some(path) = rfd::FileDialog::new()
                    .set_title("Select downloaded fix ZIP")
                    .add_filter("Fix package", &["zip"])
                    .pick_file()
                else {
                    return Ok(None);
                };
                crate::services::fix_install::preview(&cache, &root, &app, &path).map(Some)
            }
            "apply" => {
                crate::services::runtime::steam_closed()?;
                crate::services::fix_install::apply(&cache, &root, &app, &id.unwrap_or_default())?;
                Ok(None)
            }
            "undo" => {
                crate::services::runtime::steam_closed()?;
                crate::services::fix_install::undo(&root, &app)?;
                Ok(None)
            }
            _ => Err(AppError::new(
                "INVALID_INPUT",
                "Unknown fix operation.",
                false,
            )),
        }
    })
    .await
    {
        Ok(value) => ApiResult::from_result(value),
        Err(_) => ApiResult::internal("Fix operation could not finish."),
    }
}

#[tauri::command]
pub async fn online_fix_games(
    app_handle: tauri::AppHandle,
    refresh: bool,
) -> ApiResult<crate::services::online_support::Eligibility> {
    let directory = app_handle.state::<WorkspaceService>().directory.clone();
    let db = app_handle.state::<Database>();
    let lua = match crate::services::lua_tracking::apps(&directory, &db) {
        Ok(apps) => apps,
        Err(error) => return ApiResult::from_result(Err(error)),
    };
    let library = match db.library_snapshot() {
        Ok(snapshot) => snapshot,
        Err(error) => return ApiResult::from_result(Err(error)),
    };
    let apps = library
        .games
        .into_iter()
        .filter(|game| game.installed && lua.contains(&game.app_id))
        .map(|game| game.app_id)
        .collect();
    ApiResult::success(crate::services::online_support::eligible(&directory, apps, refresh).await)
}

#[tauri::command]
pub async fn lua_library(
    app_handle: tauri::AppHandle,
) -> ApiResult<Vec<crate::services::online_support::LuaGame>> {
    let directory = app_handle.state::<WorkspaceService>().directory.clone();
    let apps =
        match crate::services::lua_tracking::apps(&directory, &app_handle.state::<Database>()) {
            Ok(apps) => apps,
            Err(error) => return ApiResult::from_result(Err(error)),
        };
    ApiResult::success(crate::services::online_support::inventory(&directory, apps).await)
}

#[tauri::command]
pub async fn lua_removal(
    app_handle: tauri::AppHandle,
    action: String,
    app: Option<String>,
    name: Option<String>,
    id: Option<String>,
) -> ApiResult<Vec<crate::services::lua_removal::View>> {
    match tauri::async_runtime::spawn_blocking(move || {
        let service = app_handle.state::<WorkspaceService>();
        let _guard = service.lock.try_lock().map_err(|_| {
            AppError::new(
                "CONFLICT",
                "Wait for the current workspace operation.",
                true,
            )
        })?;
        let directory = &service.directory;
        match action.as_str() {
            "history" => crate::services::lua_removal::history(directory),
            "preview" => {
                let roots = crate::services::lua_tracking::roots(
                    directory,
                    &app_handle.state::<Database>(),
                )?;
                let app =
                    app.ok_or_else(|| AppError::new("INVALID_INPUT", "Choose a game.", false))?;
                crate::services::lua_removal::preview(
                    directory,
                    &roots,
                    &app,
                    name.as_deref().unwrap_or(&app),
                )
                .map(|plan| vec![plan])
            }
            "apply" | "undo" => {
                crate::services::runtime::steam_closed()?;
                let id = id.ok_or_else(|| {
                    AppError::new("INVALID_INPUT", "Preview the files first.", false)
                })?;
                if action == "apply" {
                    crate::services::lua_removal::apply(directory, &id)
                } else {
                    crate::services::lua_removal::undo(directory, &id)
                }
                .map(|plan| vec![plan])
            }
            _ => Err(AppError::new(
                "INVALID_INPUT",
                "Unknown Lua removal action.",
                false,
            )),
        }
    })
    .await
    {
        Ok(result) => ApiResult::from_result(result),
        Err(_) => ApiResult::internal(
            "Lua removal could not finish. Check removal history before retrying.",
        ),
    }
}

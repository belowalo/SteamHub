use super::compatibility::{self, Package};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::Duration,
};
use tauri::{Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

const KEY: &str = include_str!("../../update-public-key.txt");
const FEED: &str = "https://raw.githubusercontent.com/belowalo/SteamHub/main/compatibility/updates";
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub app: String,
    pub compatibility: String,
    pub restart_ready: bool,
    pub compatibility_pending: bool,
}
#[derive(Default)]
pub struct Updates {
    status: Mutex<Status>,
    pending: Mutex<Option<(Update, Vec<u8>)>>,
    checking: AtomicBool,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    payload: String,
    signature: String,
}
#[derive(Serialize, Deserialize)]
struct Original {
    name: String,
    before: Option<Vec<u8>>,
    after: String,
}
#[derive(Serialize, Deserialize)]
struct Journal {
    complete: bool,
    files: Vec<Original>,
}
fn atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    fs::create_dir_all(path.parent().ok_or("Invalid update path")?).map_err(|e| e.to_string())?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let temp = path.with_extension(format!(
        "steamhub-update-{}-{stamp}.tmp",
        std::process::id()
    ));
    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temp)
        .map_err(|e| e.to_string())?;
    if let Err(e) = file.write_all(bytes).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(&temp);
        return Err(e.to_string());
    }
    drop(file);
    fs::rename(&temp, path).map_err(|e| e.to_string())
}
fn verified(bytes: &[u8]) -> Result<Package, String> {
    let envelope: Envelope =
        serde_json::from_slice(bytes).map_err(|_| "Invalid signed compatibility envelope")?;
    let payload = STANDARD
        .decode(envelope.payload)
        .map_err(|_| "Invalid compatibility payload")?;
    let key = STANDARD
        .decode(KEY.trim())
        .map_err(|_| "Invalid updater public key")?;
    let key = minisign_verify::PublicKey::decode(
        std::str::from_utf8(&key).map_err(|_| "Invalid public key encoding")?,
    )
    .map_err(|e| e.to_string())?;
    let sig = STANDARD
        .decode(envelope.signature)
        .map_err(|_| "Invalid signature encoding")?;
    let sig = minisign_verify::Signature::decode(
        std::str::from_utf8(&sig).map_err(|_| "Invalid signature text")?,
    )
    .map_err(|e| e.to_string())?;
    key.verify(&payload, &sig, false)
        .map_err(|_| "Compatibility signature verification failed")?;
    serde_json::from_slice(&payload).map_err(|_| "Invalid compatibility package".into())
}
fn location(app: &tauri::AppHandle) -> PathBuf {
    app.state::<super::workspace::WorkspaceService>()
        .directory
        .join("updates")
}
fn steam(app: &tauri::AppHandle) -> Option<PathBuf> {
    let workspace = app.state::<super::workspace::WorkspaceService>();
    let roots = super::lua_tracking::roots(
        &workspace.directory,
        &app.state::<crate::storage::Database>(),
    )
    .ok()?;
    roots.into_iter().find(|r| r.join("steam.exe").is_file())
}
fn validation(root: &Path, p: &Package) -> Result<(), String> {
    std::panic::catch_unwind(|| compatibility::validate(root, p))
        .map_err(|_| "Malformed compatibility metadata".to_string())?
}
fn recover(root: &Path, journal: &Path) -> Result<(), String> {
    if !journal.exists() {
        return Ok(());
    }
    let record: Journal = serde_json::from_slice(&fs::read(journal).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    if record.complete {
        return Ok(());
    }
    for entry in &record.files {
        if !metadata_path(&entry.name) {
            return Err("Invalid compatibility recovery target".into());
        }
        let path = super::runtime::safe(root, &entry.name).map_err(|e| e.message)?;
        let current = fs::read(&path).ok();
        if current.as_ref().is_some_and(|b| {
            compatibility::hash(b) != entry.after && Some(b) != entry.before.as_ref()
        }) {
            return Err("Compatibility recovery stopped because files were edited".into());
        }
    }
    for entry in &record.files {
        let path = super::runtime::safe(root, &entry.name).map_err(|e| e.message)?;
        if let Some(bytes) = &entry.before {
            atomic(&path, bytes)?;
        } else if path.exists() {
            fs::remove_file(path).map_err(|e| e.to_string())?;
        }
    }
    fs::remove_file(journal).map_err(|e| e.to_string())
}
fn apply(root: &Path, p: &Package) -> Result<bool, String> {
    apply_with_check(root, p, || {
        super::runtime::steam_closed().map_err(|e| e.message)
    })
}
fn apply_with_check(
    root: &Path,
    p: &Package,
    closed: impl Fn() -> Result<(), String>,
) -> Result<bool, String> {
    let _guard = super::runtime::LOCK
        .try_lock()
        .map_err(|_| "Runtime setup is busy")?;
    if closed().is_err() {
        return Ok(false);
    }
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let journal = super::runtime::safe(&root, "opensteamtool/steamhub-compatibility-backup.json")
        .map_err(|e| e.message)?;
    recover(&root, &journal)?;
    validation(&root, p)?;
    let files = [
        (
            format!("opensteamtool/pattern/steamclient/{}.toml", p.client_sha256),
            &p.client_pattern,
        ),
        (
            format!("opensteamtool/pattern/steamui/{}.toml", p.ui_sha256),
            &p.ui_pattern,
        ),
        (
            format!("opensteamtool/ipc/steamclient/{}.toml", p.client_sha256),
            &p.ipc,
        ),
    ];
    let mut record = Journal {
        complete: false,
        files: vec![],
    };
    for (name, text) in &files {
        let dest = super::runtime::safe(&root, name).map_err(|e| e.message)?;
        let before = match fs::read(dest) {
            Ok(b) => Some(b),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(e.to_string()),
        };
        if before.as_deref() != Some(text.as_bytes()) {
            record.files.push(Original {
                name: name.clone(),
                before,
                after: compatibility::hash(text.as_bytes()),
            });
        }
    }
    if record.files.is_empty() {
        return Ok(true);
    }
    if journal.exists() {
        let archive = journal.with_file_name(format!(
            "steamhub-compatibility-backup-{}.json",
            super::workspace::now()
        ));
        fs::rename(&journal, archive).map_err(|e| e.to_string())?;
    }
    atomic(
        &journal,
        &serde_json::to_vec(&record).map_err(|e| e.to_string())?,
    )?;
    let result = (|| {
        closed()?;
        validation(&root, p)?;
        for (name, text) in &files {
            if record.files.iter().any(|e| &e.name == name) {
                let dest = super::runtime::safe(&root, name).map_err(|e| e.message)?;
                atomic(&dest, text.as_bytes())?;
                if compatibility::hash(&fs::read(dest).map_err(|e| e.to_string())?)
                    != compatibility::hash(text.as_bytes())
                {
                    return Err("Compatibility write verification failed".into());
                }
            }
        }
        record.complete = true;
        atomic(
            &journal,
            &serde_json::to_vec(&record).map_err(|e| e.to_string())?,
        )
    })();
    if result.is_err() {
        recover(&root, &journal)?;
    }
    result.map(|_| true)
}
async fn compatibility_check(app: &tauri::AppHandle) -> Result<(String, bool), String> {
    let Some(root) = steam(app) else {
        return Ok(("Steam installation not found".into(), false));
    };
    let client =
        compatibility::hash(&fs::read(root.join("steamclient64.dll")).map_err(|e| e.to_string())?);
    let ui = compatibility::hash(&fs::read(root.join("steamui.dll")).map_err(|e| e.to_string())?);
    let name = format!("{client}-{ui}.json");
    let cache = location(app).join(&name);
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let response = http.get(format!("{FEED}/{name}")).send().await;
    let bytes = match response {
        Ok(r) if r.status().is_success() => crate::providers::read_limited_response(r, 512 * 1024)
            .await
            .map_err(|e| e.message)?,
        Ok(r) if r.status().as_u16() == 404 && !cache.exists() => {
            return Ok((
                "No published compatibility package for this Steam build yet".into(),
                false,
            ))
        }
        _ => {
            fs::read(&cache).map_err(|_| "Compatibility check unavailable; retry when connected")?
        }
    };
    let package = verified(&bytes)?;
    if package.client_sha256 != client || package.ui_sha256 != ui {
        return Err("Compatibility feed returned a different Steam build".into());
    }
    validation(&root, &package)?;
    atomic(&cache, &bytes)?;
    let applied = apply(&root, &package)?;
    Ok((
        if applied {
            "Steam compatibility is up to date"
        } else {
            "Compatibility update downloaded; exit Steam to apply"
        }
        .into(),
        !applied,
    ))
}
async fn check(app: &tauri::AppHandle) -> Status {
    let state = app.state::<Updates>();
    if state.checking.swap(true, Ordering::SeqCst) {
        return state.status.lock().unwrap().clone();
    }
    let mut status = state.status.lock().unwrap().clone();
    if !status.restart_ready {
        status.app = match async {
            let directory = std::env::current_exe()
                .map_err(|e| e.to_string())?
                .parent()
                .ok_or("Missing app folder")?
                .to_path_buf();
            let updater = app
                .updater_builder()
                .timeout(Duration::from_secs(30))
                .installer_args([format!("/D={}", directory.display())])
                .build()
                .map_err(|e| e.to_string())?;
            match updater.check().await.map_err(|e| e.to_string())? {
                Some(update) => {
                    let version = update.version.clone();
                    let prefix = format!("/belowalo/SteamHub/releases/download/v{version}/");
                    if update.download_url.scheme() != "https"
                        || update.download_url.host_str() != Some("github.com")
                        || !update.download_url.path().starts_with(&prefix)
                    {
                        return Err("Unexpected app update source".into());
                    }
                    let bytes = update
                        .download(|_, _| {}, || {})
                        .await
                        .map_err(|e| e.to_string())?;
                    *state.pending.lock().unwrap() = Some((update, bytes));
                    Ok::<_, String>(format!("SteamHub {version} downloaded; restart to install"))
                }
                None => Ok("SteamHub is up to date".into()),
            }
        }
        .await
        {
            Ok(message) => message,
            Err(_) => "App update check unavailable; retry later".into(),
        };
        status.restart_ready = state.pending.lock().unwrap().is_some();
    }
    match compatibility_check(app).await {
        Ok((message, pending)) => {
            status.compatibility = message;
            status.compatibility_pending = pending;
        }
        Err(message) => {
            status.compatibility = format!("Compatibility update stopped: {message}");
        }
    }
    *state.status.lock().unwrap() = status.clone();
    state.checking.store(false, Ordering::SeqCst);
    status
}
pub fn install_pending(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<Updates>();
    if state.pending.lock().unwrap().is_none() {
        return Ok(());
    }
    let workspace = app.state::<super::workspace::WorkspaceService>();
    if workspace.busy.load(Ordering::SeqCst) {
        return Err("Wait for the current SteamHub operation to finish".into());
    }
    let _guard = workspace
        .lock
        .try_lock()
        .map_err(|_| "Wait for the current SteamHub operation to finish")?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let backup = location(app).join(format!("SteamHub-{}.exe", app.package_info().version));
    fs::create_dir_all(backup.parent().unwrap()).map_err(|e| e.to_string())?;
    if !backup.exists() {
        fs::copy(exe, &backup).map_err(|e| e.to_string())?;
    }
    let Some((update, bytes)) = state.pending.lock().unwrap().take() else {
        return Ok(());
    };
    if let Err(e) = update.install(&bytes) {
        *state.pending.lock().unwrap() = Some((update, bytes));
        return Err(e.to_string());
    }
    Ok(())
}
fn metadata_path(name: &str) -> bool {
    let pieces: Vec<_> = name.split('/').collect();
    pieces.len() == 4
        && pieces[0] == "opensteamtool"
        && matches!(
            (pieces[1], pieces[2]),
            ("pattern", "steamclient") | ("pattern", "steamui") | ("ipc", "steamclient")
        )
        && pieces[3]
            .strip_suffix(".toml")
            .is_some_and(|s| s.len() == 64 && s.bytes().all(|c| c.is_ascii_hexdigit()))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "Requires a completed signed Windows installer build"]
    fn built_installer_signature_matches_pinned_key() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let artifact = root.join(format!(
            "target/release/bundle/nsis/SteamHub_{}_x64-setup.exe",
            env!("CARGO_PKG_VERSION")
        ));
        let public = STANDARD.decode(KEY.trim()).unwrap();
        let key =
            minisign_verify::PublicKey::decode(std::str::from_utf8(&public).unwrap()).unwrap();
        let encoded = fs::read_to_string(artifact.with_extension("exe.sig")).unwrap();
        let signature = STANDARD.decode(encoded.trim()).unwrap();
        let signature =
            minisign_verify::Signature::decode(std::str::from_utf8(&signature).unwrap()).unwrap();
        let bytes = fs::read(artifact).unwrap();
        key.verify(&bytes, &signature, false).unwrap();
    }
    const SIGNED:&[u8]=include_bytes!("../../../compatibility/updates/669fa08e259277fbf5a1dfe15ce88afe734e89151194304b44d92f418dcc985b-2dfb0a5d50dd90667549cc7d413c7bfb0794c9af4ebaf08bf1cf7d938a11ea93.json");
    #[test]
    fn authentic_metadata_is_accepted_and_tampering_is_rejected() {
        let p = verified(SIGNED).unwrap();
        assert_eq!(p.schema, 1);
        let mut value: serde_json::Value = serde_json::from_slice(SIGNED).unwrap();
        let mut bytes = STANDARD.decode(value["payload"].as_str().unwrap()).unwrap();
        bytes[20] ^= 1;
        value["payload"] = serde_json::Value::String(STANDARD.encode(bytes));
        assert!(verified(&serde_json::to_vec(&value).unwrap()).is_err());
        value["signature"] = serde_json::json!(STANDARD.encode("invalid signature"));
        assert!(verified(&serde_json::to_vec(&value).unwrap()).is_err());
    }
    #[test]
    fn atomic_replacement_and_recovery_preserve_originals_and_refuse_edits() {
        let t = tempfile::tempdir().unwrap();
        let canonical = t.path().canonicalize().unwrap();
        let root = canonical.as_path();
        let name = format!("opensteamtool/pattern/steamclient/{}.toml", "a".repeat(64));
        let path = root.join(&name);
        atomic(&path, b"original").unwrap();
        let record = Journal {
            complete: false,
            files: vec![Original {
                name: name.clone(),
                before: Some(b"original".to_vec()),
                after: compatibility::hash(b"updated"),
            }],
        };
        let journal = root.join("journal.json");
        fs::write(&journal, serde_json::to_vec(&record).unwrap()).unwrap();
        atomic(&path, b"updated").unwrap();
        recover(root, &journal).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"original");
        fs::write(&journal, serde_json::to_vec(&record).unwrap()).unwrap();
        atomic(&path, b"user edit").unwrap();
        assert!(recover(root, &journal).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"user edit");
        assert!(!metadata_path("config/lua/user.lua"));
        assert!(!metadata_path("../steam.exe"));
        assert!(metadata_path(&name));
    }
    #[test]
    #[ignore = "Requires STEAMHUB_TEST_STEAM_ROOT with the reviewed DLL pair; copies files into a temporary Steam fixture"]
    fn installed_dll_validation_deferred_apply_and_rollback() {
        let source = PathBuf::from(std::env::var("STEAMHUB_TEST_STEAM_ROOT").unwrap());
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        for name in ["steamclient64.dll", "steamui.dll", "OpenSteamTool.dll"] {
            fs::copy(source.join(name), root.join(name)).unwrap();
        }
        fs::write(root.join("steam.exe"), b"inert fixture").unwrap();
        let p = verified(SIGNED).unwrap();
        validation(root, &p).unwrap();
        let journal = root.join("opensteamtool/steamhub-compatibility-backup.json");
        assert!(!apply_with_check(root, &p, || Err("Steam running".into())).unwrap());
        assert!(!journal.exists());
        assert!(apply_with_check(root, &p, || Ok(())).unwrap());
        assert!(apply_with_check(root, &p, || Ok(())).unwrap());
        let name = format!("opensteamtool/pattern/steamclient/{}.toml", p.client_sha256);
        assert_eq!(
            fs::read(root.join(&name)).unwrap(),
            p.client_pattern.as_bytes()
        );
        let mut corrupt = p.clone();
        corrupt.client_pattern = corrupt.client_pattern.replace("sig =", "broken =");
        assert!(validation(root, &corrupt).is_err());
        fs::write(root.join("steamui.dll"), b"Steam updated").unwrap();
        assert!(validation(root, &p).is_err());
    }
}
#[tauri::command]
pub async fn automatic_updates(
    app: tauri::AppHandle,
    action: String,
    state: State<'_, Updates>,
) -> Result<Status, String> {
    match action.as_str() {
        "check" => Ok(check(&app).await),
        "install" => {
            install_pending(&app)?;
            Ok(state.status.lock().unwrap().clone())
        }
        "status" => {
            let mut current = state.status.lock().unwrap().clone();
            if current.compatibility_pending {
                match compatibility_check(&app).await {
                    Ok((message, pending)) => {
                        current.compatibility = message;
                        current.compatibility_pending = pending;
                    }
                    Err(e) => current.compatibility = e,
                };
                *state.status.lock().unwrap() = current.clone();
            }
            Ok(current)
        }
        _ => Err("Unknown update action".into()),
    }
}

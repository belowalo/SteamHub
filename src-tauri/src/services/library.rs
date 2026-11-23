//! P04 read-only Steam discovery. All writes are delegated to application SQLite.
pub mod keyvalues;
#[cfg(test)]
mod tests;
use crate::{
    contracts::{library::*, AppError},
    storage::Database,
};
use std::{
    collections::{HashSet, VecDeque},
    fs::{self, File},
    io::Read,
    path::{Component, Path, PathBuf},
    sync::Mutex,
};

pub struct LibraryService {
    pub scan_lock: Mutex<()>,
}
impl Default for LibraryService {
    fn default() -> Self {
        Self {
            scan_lock: Mutex::new(()),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ObservedInstallation {
    pub app_id: String,
    pub name: Option<String>,
    pub install_path: String,
    pub source_acf_path: String,
    pub build_id: Option<String>,
    pub status: String,
}
#[derive(Debug)]
pub struct ObservedRoot {
    pub path: String,
    pub source: String,
    pub status: String,
    pub diagnostics: Vec<ScanDiagnostic>,
    pub installations: Vec<ObservedInstallation>,
}
const MAX_ROOTS: usize = 64;
const MAX_ENTRIES: usize = 20_000;
const MAX_MANIFESTS: usize = 20_000;
fn diagnostic(root: &mut ObservedRoot, code: &str, path: &Path, message: &str) {
    if root.diagnostics.len() < 199 {
        root.diagnostics.push(ScanDiagnostic {
            code: code.into(),
            path: display(path),
            message: message.into(),
        });
    } else if root.diagnostics.len() == 199 {
        root.diagnostics.push(ScanDiagnostic {
            code: "DIAGNOSTIC_LIMIT".into(),
            path: root.path.clone(),
            message: "Further diagnostics omitted after the per-root limit.".into(),
        });
    }
    if root.status != "failed" {
        root.status = "partial".into();
    }
}
pub fn display(path: &Path) -> String {
    let value = path.to_string_lossy();
    value.strip_prefix("\\\\?\\").unwrap_or(&value).to_owned()
}
fn path_key(path: &Path) -> String {
    let value = display(path);
    if cfg!(windows) {
        value.to_lowercase()
    } else {
        value
    }
}
pub fn normalized_id(value: &str) -> Result<String, AppError> {
    if value.is_empty()
        || value.len() > 20
        || !value.bytes().all(|c| c.is_ascii_digit())
        || value.bytes().all(|c| c == b'0')
    {
        return Err(AppError::new(
            "INVALID_INPUT",
            "AppID must be a positive decimal string of at most 20 digits.",
            false,
        ));
    }
    Ok(value.trim_start_matches('0').into())
}
fn validate_root(path: &str) -> Result<(), AppError> {
    if path.is_empty()
        || path.len() > 32768
        || path.contains('\0')
        || !Path::new(path).is_absolute()
    {
        return Err(AppError::new(
            "INVALID_INPUT",
            "Select an absolute local Steam directory.",
            false,
        ));
    }
    #[cfg(windows)]
    if path.starts_with("\\\\") || path.starts_with("//") {
        return Err(AppError::new(
            "INVALID_INPUT",
            "Network and device paths are not supported by the local scanner.",
            false,
        ));
    }
    Ok(())
}
fn read_text(path: &Path, root: &Path, limit: u64) -> Result<String, (&'static str, &'static str)> {
    let canonical = fs::canonicalize(path).map_err(io_diagnostic)?;
    if !canonical.starts_with(root) {
        return Err((
            "PATH_ESCAPE",
            "File resolves outside the authorized library root.",
        ));
    }
    let file = File::open(&canonical).map_err(io_diagnostic)?;
    let before = file.metadata().map_err(io_diagnostic)?;
    if !before.is_file() {
        return Err(("INVALID_FILE", "Expected a regular text file."));
    }
    if before.len() > limit {
        return Err((
            "SIZE_LIMIT",
            "Steam metadata file exceeds the scanner size limit.",
        ));
    }
    let mut bytes = Vec::new();
    (&file)
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(io_diagnostic)?;
    let after = file.metadata().map_err(io_diagnostic)?;
    if bytes.len() as u64 > limit {
        return Err((
            "SIZE_LIMIT",
            "Steam metadata file exceeds the scanner size limit.",
        ));
    }
    if before.len() != after.len() || before.modified().ok() != after.modified().ok() {
        return Err((
            "FILE_CHANGED",
            "File changed during the scan; retry when Steam is idle.",
        ));
    }
    String::from_utf8(bytes).map_err(|_| ("INVALID_ENCODING", "Steam metadata is not valid UTF-8."))
}
fn io_diagnostic(error: std::io::Error) -> (&'static str, &'static str) {
    match error.kind() {
        std::io::ErrorKind::PermissionDenied => (
            "PERMISSION_DENIED",
            "Permission denied while reading this library.",
        ),
        std::io::ErrorKind::NotFound => ("NOT_FOUND", "Library path or file is missing."),
        _ => ("IO_ERROR", "Could not read this library path."),
    }
}
fn library_paths(text: &str) -> Result<Vec<String>, String> {
    let parsed = keyvalues::parse(text)?;
    let entries = keyvalues::field(&parsed, "libraryfolders")?
        .ok_or("Missing libraryfolders object")?
        .object()?;
    let mut result = Vec::new();
    for (key, value) in entries {
        if !key.is_empty() && key.bytes().all(|c| c.is_ascii_digit()) {
            let path = match value {
                keyvalues::Value::Text(text) => text.as_str(),
                _ => keyvalues::required(value.object()?, "path")?,
            };
            result.push(path.to_owned());
            if result.len() > MAX_ROOTS {
                return Err("Too many library roots".into());
            }
        }
    }
    Ok(result)
}
fn parse_installation(
    text: &str,
    manifest: &Path,
    root: &Path,
    steamapps: &Path,
) -> Result<ObservedInstallation, (&'static str, &'static str)> {
    let parsed = keyvalues::parse(text)
        .map_err(|_| ("MALFORMED_ACF", "Malformed or unsupported app manifest."))?;
    let fields = keyvalues::field(&parsed, "AppState")
        .and_then(|value| {
            value
                .ok_or_else(|| String::from("Missing AppState"))?
                .object()
        })
        .map_err(|_| ("MALFORMED_ACF", "Expected one AppState object."))?;
    let app_id = keyvalues::required(fields, "appid")
        .ok()
        .and_then(|value| normalized_id(value).ok())
        .ok_or(("INVALID_APP_ID", "App manifest has no valid AppID."))?;
    let filename = manifest
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let filename_id = filename
        .strip_prefix("appmanifest_")
        .and_then(|name| name.strip_suffix(".acf"))
        .and_then(|id| normalized_id(id).ok());
    if filename_id.as_deref() != Some(&app_id) {
        return Err(("APP_ID_MISMATCH", "Manifest filename and AppID disagree."));
    }
    let install_dir = keyvalues::required(fields, "installdir").map_err(|_| {
        (
            "INVALID_INSTALL_DIR",
            "Manifest has no installation directory.",
        )
    })?;
    let relative = Path::new(install_dir);
    if install_dir.is_empty()
        || install_dir.contains('\0')
        || install_dir.contains(':')
        || relative
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
        || relative.is_absolute()
    {
        return Err((
            "PATH_ESCAPE",
            "Installation directory must stay inside steamapps/common.",
        ));
    }
    let common = steamapps.join("common");
    let common = match fs::canonicalize(&common) {
        Ok(path) if path.starts_with(root) => path,
        Ok(_) => {
            return Err((
                "PATH_ESCAPE",
                "Common directory resolves outside the selected library.",
            ))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => common,
        Err(error) => return Err(io_diagnostic(error)),
    };
    let destination = common.join(relative);
    let (install_path, present) = match fs::canonicalize(&destination) {
        Ok(path) if path.starts_with(&common) && path.is_dir() => (path, true),
        Ok(_) => {
            return Err((
                "PATH_ESCAPE",
                "Installation is not a directory contained by steamapps/common.",
            ))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (destination, false),
        Err(error) => return Err(io_diagnostic(error)),
    };
    let flags = keyvalues::field(fields, "StateFlags")
        .map_err(|_| ("MALFORMED_ACF", "Duplicate StateFlags field."))?
        .map(|value| {
            value
                .text()
                .ok()
                .and_then(|value| value.parse::<u32>().ok())
        });
    if flags == Some(None) {
        return Err(("MALFORMED_ACF", "Invalid installation state flags."));
    }
    let fully_installed = flags
        .flatten()
        .is_some_and(|flags| flags & 4 != 0 && flags & 33 == 0);
    let name = keyvalues::field(fields, "name")
        .map_err(|_| ("MALFORMED_ACF", "Duplicate game name field."))?
        .map(|value| value.text())
        .transpose()
        .map_err(|_| ("MALFORMED_ACF", "Invalid game name."))?
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.chars().take(512).collect());
    let build_id = keyvalues::field(fields, "buildid")
        .map_err(|_| ("MALFORMED_ACF", "Duplicate build field."))?
        .map(|value| value.text())
        .transpose()
        .map_err(|_| ("MALFORMED_ACF", "Invalid build field."))?
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    if build_id
        .as_ref()
        .is_some_and(|value| value.len() > 20 || !value.bytes().all(|c| c.is_ascii_digit()))
    {
        return Err(("MALFORMED_ACF", "BuildID must contain decimal digits."));
    }
    Ok(ObservedInstallation {
        app_id,
        name,
        install_path: display(&install_path),
        source_acf_path: display(manifest),
        build_id,
        status: if !present {
            "absent"
        } else if fully_installed {
            "verified_local"
        } else {
            "not_checked"
        }
        .into(),
    })
}
fn scan_root(path: &str, source: &str, remaining: &mut usize) -> (ObservedRoot, Vec<String>) {
    let mut result = ObservedRoot {
        path: path.into(),
        source: source.into(),
        status: "failed".into(),
        diagnostics: Vec::new(),
        installations: Vec::new(),
    };
    let root = match fs::canonicalize(path) {
        Ok(path) if path.is_dir() => path,
        Ok(_) => {
            diagnostic(
                &mut result,
                "INVALID_ROOT",
                Path::new(path),
                "Selected root is not a directory.",
            );
            return (result, Vec::new());
        }
        Err(error) => {
            let (code, message) = io_diagnostic(error);
            diagnostic(&mut result, code, Path::new(path), message);
            return (result, Vec::new());
        }
    };
    #[cfg(windows)]
    if !matches!(root.components().next(), Some(Component::Prefix(prefix)) if matches!(prefix.kind(), std::path::Prefix::Disk(_) | std::path::Prefix::VerbatimDisk(_)))
    {
        diagnostic(
            &mut result,
            "UNSUPPORTED_ROOT",
            Path::new(path),
            "Network/device targets are unsupported by the local scanner.",
        );
        return (result, Vec::new());
    }
    result.path = display(&root);
    let steamapps = match fs::canonicalize(root.join("steamapps")) {
        Ok(path) if path.starts_with(&root) && path.is_dir() => path,
        Ok(_) => {
            diagnostic(
                &mut result,
                "PATH_ESCAPE",
                &root,
                "steamapps must be contained by the selected root.",
            );
            return (result, Vec::new());
        }
        Err(error) => {
            let (code, message) = io_diagnostic(error);
            diagnostic(&mut result, code, &root.join("steamapps"), message);
            return (result, Vec::new());
        }
    };
    result.status = "complete".into();
    let mut additional = Vec::new();
    for index in [
        steamapps.join("libraryfolders.vdf"),
        root.join("config/libraryfolders.vdf"),
    ] {
        if !index.try_exists().unwrap_or(true) {
            continue;
        }
        match read_text(&index, &root, 2 * 1024 * 1024) {
            Ok(text) => match library_paths(&text) {
                Ok(paths) => additional.extend(paths),
                Err(_) => diagnostic(
                    &mut result,
                    "MALFORMED_VDF",
                    &index,
                    "Library index is malformed, unsupported, or exceeds limits.",
                ),
            },
            Err((code, message)) => diagnostic(&mut result, code, &index, message),
        }
        break;
    }
    let entries = match fs::read_dir(&steamapps) {
        Ok(entries) => entries,
        Err(error) => {
            result.status = "failed".into();
            let (code, message) = io_diagnostic(error);
            diagnostic(&mut result, code, &steamapps, message);
            return (result, additional);
        }
    };
    let mut manifests = Vec::new();
    for (count, entry) in entries.enumerate() {
        if count >= MAX_ENTRIES {
            diagnostic(
                &mut result,
                "ENTRY_LIMIT",
                &steamapps,
                "Directory entry limit reached; unobserved records remain unverified.",
            );
            break;
        }
        match entry {
            Ok(entry) => {
                let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
                if name.starts_with("appmanifest_") && name.ends_with(".acf") {
                    manifests.push(entry.path());
                }
            }
            Err(error) => {
                let (code, message) = io_diagnostic(error);
                diagnostic(&mut result, code, &steamapps, message);
            }
        }
    }
    manifests.sort();
    let mut ids = HashSet::new();
    for manifest in manifests {
        if *remaining == 0 {
            diagnostic(
                &mut result,
                "MANIFEST_LIMIT",
                &steamapps,
                "Total manifest scan limit reached; remaining records were not verified.",
            );
            break;
        }
        *remaining -= 1;
        let canonical = fs::canonicalize(&manifest).unwrap_or_else(|_| manifest.clone());
        let observation = read_text(&manifest, &root, 256 * 1024)
            .and_then(|text| parse_installation(&text, &canonical, &root, &steamapps));
        match observation {
            Ok(installation) if ids.insert(installation.app_id.clone()) => {
                if installation.status != "verified_local" {
                    diagnostic(
                        &mut result,
                        "INCOMPLETE_INSTALLATION",
                        &manifest,
                        "ACF exists but its installation is missing or not fully installed.",
                    );
                }
                result.installations.push(installation);
            }
            Ok(_) => diagnostic(
                &mut result,
                "DUPLICATE_APP_ID",
                &manifest,
                "Duplicate AppID within this root; first valid record retained.",
            ),
            Err((code, message)) => diagnostic(&mut result, code, &manifest, message),
        }
    }
    (result, additional)
}

pub(crate) fn detected_roots() -> Vec<String> {
    let mut result = Vec::new();
    #[cfg(windows)]
    {
        use winreg::{
            enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY},
            RegKey,
        };
        for (hive, key, value, flags) in [
            (
                HKEY_CURRENT_USER,
                "Software\\Valve\\Steam",
                "SteamPath",
                KEY_READ,
            ),
            (
                HKEY_LOCAL_MACHINE,
                "SOFTWARE\\Valve\\Steam",
                "InstallPath",
                KEY_READ | KEY_WOW64_32KEY,
            ),
        ] {
            if let Ok(key) = RegKey::predef(hive).open_subkey_with_flags(key, flags) {
                if let Ok(path) = key.get_value::<String, _>(value) {
                    result.push(path);
                }
            }
        }
        for key in ["ProgramFiles(x86)", "ProgramFiles"] {
            if let Some(path) = std::env::var_os(key) {
                let path = PathBuf::from(path).join("Steam");
                if path.join("steamapps").is_dir() {
                    result.push(display(&path));
                }
            }
        }
    }
    result
}
pub fn scan(
    database: &Database,
    request: LibraryScanRequest,
) -> Result<LibraryScanResult, AppError> {
    scan_with_detected(database, request, detected_roots())
}

fn scan_with_detected(
    database: &Database,
    request: LibraryScanRequest,
    detected: Vec<String>,
) -> Result<LibraryScanResult, AppError> {
    let explicit = request.root_paths.is_some();
    let _force = request.force; // Scans always read current metadata; there is no scan cache.
    let seeds = match request.root_paths {
        Some(paths) if paths.is_empty() || paths.len() > 16 => {
            return Err(AppError::new(
                "INVALID_INPUT",
                "Select between one and sixteen local library roots.",
                false,
            ))
        }
        Some(paths) => paths
            .into_iter()
            .map(|path| (path, "user_selected".into()))
            .collect(),
        None => {
            let mut roots: Vec<(String, String)> = detected
                .into_iter()
                .map(|path| (path, "detected".into()))
                .collect();
            roots.extend(database.library_known_roots()?);
            roots
        }
    };
    for (path, _) in &seeds {
        validate_root(path)?;
    }
    if seeds.is_empty() {
        return Err(AppError::new(
            "NO_STEAM_INSTALLATION",
            "No local Steam installation was detected. Select a Steam library root to scan.",
            true,
        ));
    }
    let mut queue: VecDeque<(String, String)> = seeds.into();
    let mut seen = HashSet::new();
    let mut roots = Vec::new();
    let mut remaining = MAX_MANIFESTS;
    while let Some((path, source)) = queue.pop_front() {
        let key = path_key(&fs::canonicalize(&path).unwrap_or_else(|_| PathBuf::from(&path)));
        if !seen.insert(key) {
            continue;
        }
        if roots.len() >= MAX_ROOTS {
            if let Some(root) = roots.last_mut() {
                diagnostic(
                    root,
                    "ROOT_LIMIT",
                    Path::new(&path),
                    "Library root limit reached.",
                );
            }
            break;
        }
        let (mut root, additional) = scan_root(&path, &source, &mut remaining);
        for path in additional {
            if validate_root(&path).is_ok() {
                queue.push_back((path, "detected".into()));
            } else {
                diagnostic(
                    &mut root,
                    "INVALID_ROOT",
                    Path::new(&path),
                    "Index contains an unsupported or non-absolute local path.",
                );
            }
        }
        roots.push(root);
    }
    let accessible = roots.iter().any(|root| root.status != "failed");
    let verified = roots
        .iter()
        .flat_map(|root| &root.installations)
        .filter(|installation| installation.status == "verified_local")
        .count();
    let observed = roots.iter().map(|root| root.installations.len()).sum();
    let diagnostic_count = roots.iter().map(|root| root.diagnostics.len()).sum();
    database.library_persist(&roots)?;
    if !accessible {
        let denied = roots
            .iter()
            .flat_map(|root| &root.diagnostics)
            .any(|item| item.code == "PERMISSION_DENIED");
        return Err(AppError::new(if denied { "PERMISSION_DENIED" } else if explicit { "NOT_FOUND" } else { "NO_STEAM_INSTALLATION" }, "No readable Steam library was found. Review the root diagnostics and select an accessible library.", true));
    }
    Ok(LibraryScanResult {
        snapshot: database.library_snapshot()?,
        verified_installations: verified,
        observed_installations: observed,
        diagnostic_count,
    })
}

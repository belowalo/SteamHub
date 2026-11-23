//! Reviewed ZIP application. No downloaded program or script is executed.
use crate::contracts::AppError;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
static LOCK: Mutex<()> = Mutex::new(());
const RECORD: &str = ".steamhub-online-fix";
fn err(s: impl AsRef<str>) -> AppError {
    AppError::new("FIX_INSTALL", s.as_ref(), true)
}
fn io(e: impl std::fmt::Display) -> AppError {
    err(format!("Fix file operation failed: {e}"))
}
fn hash(data: &[u8]) -> String {
    Sha256::digest(data)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub size: u64,
    pub before: Option<String>,
    pub after: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub id: String,
    pub app_id: String,
    pub install_path: String,
    #[serde(default)]
    pub destination_prefix: String,
    pub files: Vec<Entry>,
}
fn destination_prefix(root: &Path, payloads: &[(String, Vec<u8>)]) -> Result<String, AppError> {
    for (name, _) in payloads {
        safe(root, name)?;
    }
    let anchors: Vec<_> = payloads
        .iter()
        .filter(|(name, _)| {
            Path::new(name)
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| {
                    ext.eq_ignore_ascii_case("dll") || ext.eq_ignore_ascii_case("exe")
                })
        })
        .collect();
    let mut folders = vec![(root.to_path_buf(), 0)];
    let mut best = Vec::new();
    let mut best_score = (false, 0);
    let mut visited = 0;
    while let Some((folder, depth)) = folders.pop() {
        visited += 1;
        if visited > 4096 {
            return Err(err("Too many game folders to locate the fix destination."));
        }
        let prefix = folder
            .strip_prefix(root)
            .map_err(io)?
            .to_string_lossy()
            .replace('\\', "/");
        let matches = anchors
            .iter()
            .filter(|(name, _)| folder.join(name).is_file())
            .count();
        let entries = fs::read_dir(&folder)
            .map_err(io)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(io)?;
        let executable = entries.iter().any(|entry| {
            entry.path().is_file()
                && entry
                    .path()
                    .extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
        });
        let score = (executable, matches);
        if matches > 0 {
            if score > best_score {
                best_score = score;
                best.clear();
            }
            if score == best_score {
                best.push(prefix);
            }
        }
        if depth < 4 {
            for entry in entries {
                let name = entry.file_name().to_string_lossy().into_owned();
                if entry.file_type().map_err(io)?.is_dir()
                    && !name.starts_with('.')
                    && safe(
                        root,
                        &entry
                            .path()
                            .strip_prefix(root)
                            .map_err(io)?
                            .to_string_lossy()
                            .replace('\\', "/"),
                    )
                    .is_ok()
                {
                    folders.push((entry.path(), depth + 1));
                }
            }
        }
    }
    match best.len() {
        0 => Ok(String::new()),
        1 => Ok(best.remove(0)),
        _ => Err(err(
            "The fix matches multiple game folders. Select a package for this game version.",
        )),
    }
}
fn destination_name(prefix: &str, name: &str) -> String {
    if prefix.is_empty() {
        name.to_owned()
    } else {
        format!("{prefix}/{name}")
    }
}
fn safe(root: &Path, name: &str) -> Result<PathBuf, AppError> {
    if name.is_empty() || name.contains('\\') || name.contains(':') || name.starts_with('/') {
        return Err(err("Unsafe path in fix package."));
    }
    let mut path = root.to_path_buf();
    for part in name.split('/') {
        let base = part.split('.').next().unwrap_or("").to_uppercase();
        if part.is_empty()
            || part == "."
            || part == ".."
            || part.ends_with(['.', ' '])
            || part
                .chars()
                .any(|c| c.is_control() || "<>\"|?*".contains(c))
            || ["CON", "PRN", "AUX", "NUL"].contains(&base.as_str())
            || (base.len() == 4
                && (base.starts_with("COM") || base.starts_with("LPT"))
                && base.as_bytes()[3].is_ascii_digit())
            || part.to_lowercase().starts_with(".steamhub")
        {
            return Err(err("Unsafe or reserved path in fix package."));
        }
        path.push(part);
        if let Ok(meta) = fs::symlink_metadata(&path) {
            if meta.file_type().is_symlink() || !path.canonicalize().map_err(io)?.starts_with(root)
            {
                return Err(err("Fix destination redirects outside the game folder."));
            }
        }
    }
    Ok(path)
}
fn archive(path: &Path) -> Result<Vec<(String, Vec<u8>)>, AppError> {
    if fs::metadata(path).map_err(io)?.len() > 128 * 1024 * 1024 {
        return Err(err("Fix ZIP exceeds 128 MiB."));
    }
    let mut zip=zip::ZipArchive::new(File::open(path).map_err(io)?).map_err(|_|err("Select a valid ZIP. RAR, 7z, password-protected archives and installer programs need manual handling."))?;
    if zip.len() > 2048 {
        return Err(err("Too many files in fix ZIP."));
    }
    let mut files = vec![];
    let mut names = HashSet::new();
    let mut total = 0u64;
    for i in 0..zip.len() {
        let mut item = zip.by_index(i).map_err(io)?;
        if item.is_dir() {
            continue;
        }
        if item
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(err("Fix ZIP contains a link."));
        }
        total = total
            .checked_add(item.size())
            .ok_or_else(|| err("Fix ZIP is too large."))?;
        if item.size() > 128 * 1024 * 1024 || total > 256 * 1024 * 1024 {
            return Err(err("Expanded fix ZIP exceeds the supported size."));
        }
        let name = item.name().to_owned();
        if !names.insert(name.to_lowercase()) {
            return Err(err("Duplicate file paths in fix ZIP."));
        }
        let mut data = vec![];
        (&mut item)
            .take(128 * 1024 * 1024 + 1)
            .read_to_end(&mut data)
            .map_err(io)?;
        if data.len() as u64 != item.size() {
            return Err(err("Fix ZIP size mismatch."));
        }
        files.push((name, data));
    }
    let mut normalized: Vec<_> = files.iter().map(|(name, _)| name.to_lowercase()).collect();
    normalized.sort();
    if normalized
        .windows(2)
        .any(|pair| pair[1].starts_with(&format!("{}/", pair[0])))
    {
        return Err(err("Fix ZIP contains conflicting file and folder paths."));
    }
    if files.is_empty() {
        return Err(err("Fix ZIP contains no files."));
    }
    let mut extensions = files.iter().map(|(name, _)| {
        Path::new(name)
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or_default()
    });
    if extensions
        .clone()
        .any(|ext| ext.eq_ignore_ascii_case("manifest"))
        && extensions
            .all(|ext| ext.eq_ignore_ascii_case("lua") || ext.eq_ignore_ascii_case("manifest"))
    {
        return Err(err(
            "This ZIP contains Steam game data (Lua and manifests). Select the separate fix ZIP.",
        ));
    }
    Ok(files)
}
fn record(root: &Path) -> Result<PathBuf, AppError> {
    let path = root.join(RECORD);
    if path.exists()
        && (fs::symlink_metadata(&path)
            .map_err(io)?
            .file_type()
            .is_symlink()
            || !path.canonicalize().map_err(io)?.starts_with(root))
    {
        return Err(err("Fix backup path redirects outside the game folder."));
    }
    Ok(path)
}
fn write_new(path: &Path, data: &[u8]) -> Result<(), AppError> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(io)?;
    file.write_all(data)
        .and_then(|_| file.sync_all())
        .map_err(io)
}
fn write_atomic(path: &Path, data: &[u8]) -> Result<(), AppError> {
    let temp = path.with_file_name(format!(".steamhub-write-{}", super::workspace::now()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(io)?;
    if let Err(e) = file.write_all(data).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(&temp);
        return Err(io(e));
    }
    drop(file);
    if let Err(e) = fs::rename(&temp, path) {
        let _ = fs::remove_file(temp);
        return Err(io(e));
    }
    Ok(())
}
pub fn preview(cache: &Path, root: &Path, app: &str, path: &Path) -> Result<Plan, AppError> {
    let root = root.canonicalize().map_err(io)?;
    let payloads = archive(path)?;
    let destination_prefix = destination_prefix(&root, &payloads)?;
    let bytes = fs::read(path).map_err(io)?;
    let id = hash(&bytes);
    let mut files = vec![];
    for (name, data) in payloads {
        let name = destination_name(&destination_prefix, &name);
        let dest = safe(&root, &name)?;
        let before = if dest.exists() {
            Some(hash(&fs::read(dest).map_err(io)?))
        } else {
            None
        };
        files.push(Entry {
            name,
            size: data.len() as u64,
            before,
            after: hash(&data),
        });
    }
    let plan = Plan {
        id: id.clone(),
        app_id: app.into(),
        install_path: root.to_string_lossy().into_owned(),
        destination_prefix,
        files,
    };
    fs::create_dir_all(cache).map_err(io)?;
    let package = cache.join(format!("{id}.zip"));
    if !package.exists() {
        write_new(&package, &bytes)?;
    }
    // The plan includes hashes of originals so an update between review and Apply is caught.
    fs::write(
        cache.join(format!("{id}-{app}.json")),
        serde_json::to_vec(&plan).map_err(io)?,
    )
    .map_err(io)?;
    Ok(plan)
}
pub fn apply(cache: &Path, root: &Path, app: &str, id: &str) -> Result<usize, AppError> {
    let _lock = LOCK
        .try_lock()
        .map_err(|_| err("A fix operation is already running."))?;
    if id.len() != 64 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(err("Invalid fix review ID."));
    }
    let root = root.canonicalize().map_err(io)?;
    let package = cache.join(format!("{id}.zip"));
    if hash(&fs::read(&package).map_err(io)?) != id {
        return Err(err("Fix ZIP changed after review."));
    }
    let plan: Plan =
        serde_json::from_slice(&fs::read(cache.join(format!("{id}-{app}.json"))).map_err(io)?)
            .map_err(io)?;
    if plan.app_id != app || Path::new(&plan.install_path) != root || plan.id != id {
        return Err(err("Game location changed. Review the fix again."));
    }
    let payloads = archive(&package)?;
    if destination_prefix(&root, &payloads)? != plan.destination_prefix {
        return Err(err("Fix destination changed. Review the ZIP again."));
    }
    let payloads: Vec<_> = payloads
        .into_iter()
        .map(|(name, bytes)| (destination_name(&plan.destination_prefix, &name), bytes))
        .collect();
    if payloads.len() != plan.files.len() {
        return Err(err("Fix review changed."));
    }
    let backup = record(&root)?;
    if backup.exists() {
        return Err(err("Undo the previous fix before applying another one."));
    }
    for ((name, bytes), entry) in payloads.iter().zip(&plan.files) {
        let dest = safe(&root, name)?;
        let before = if dest.exists() {
            Some(hash(&fs::read(dest).map_err(io)?))
        } else {
            None
        };
        if *name != entry.name || hash(bytes) != entry.after || before != entry.before {
            return Err(err(
                "Game files changed after review. Review the ZIP again.",
            ));
        }
    }
    fs::create_dir(&backup).map_err(io)?;
    // Complete and verify all original backups before publishing the recovery record or changing game files.
    let saved = (|| {
        for (i, entry) in plan.files.iter().enumerate() {
            if let Some(before) = &entry.before {
                let data = fs::read(safe(&root, &entry.name)?).map_err(io)?;
                if hash(&data) != *before {
                    return Err(err("Game files changed during backup."));
                }
                write_new(&backup.join(i.to_string()), &data)?;
            }
        }
        write_new(
            &backup.join("record.json"),
            &serde_json::to_vec(&plan).map_err(io)?,
        )
    })();
    if let Err(e) = saved {
        for entry in fs::read_dir(&backup).map_err(io)? {
            let entry = entry.map_err(io)?;
            fs::remove_file(entry.path()).map_err(io)?;
        }
        fs::remove_dir(&backup).map_err(io)?;
        return Err(e);
    }
    for (name, data) in payloads {
        let dest = safe(&root, &name)?;
        fs::create_dir_all(dest.parent().ok_or_else(|| err("Invalid file path."))?).map_err(io)?;
        // A crash leaves the verified originals and record available for Undo.
        write_atomic(&dest, &data)?;
        if hash(&fs::read(dest).map_err(io)?) != hash(&data) {
            return Err(err("Fix verification failed. Use Undo fix."));
        }
    }
    Ok(plan.files.len())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledStatus {
    pub installed: bool,
    pub can_undo: bool,
}
pub fn status(root: &Path, app: &str) -> Result<InstalledStatus, AppError> {
    let root = root.canonicalize().map_err(io)?;
    let backup = record(&root)?;
    if !backup.exists() {
        return Ok(InstalledStatus {
            installed: false,
            can_undo: false,
        });
    }
    let plan: Plan =
        serde_json::from_slice(&fs::read(backup.join("record.json")).map_err(io)?).map_err(io)?;
    if plan.app_id != app {
        return Err(err("Fix backup belongs to another game."));
    }
    let mut installed = true;
    if plan.destination_prefix.is_empty() {
        let paths: Vec<_> = plan
            .files
            .iter()
            .map(|entry| (entry.name.clone(), Vec::new()))
            .collect();
        installed = destination_prefix(&root, &paths).is_ok_and(|prefix| prefix.is_empty());
    }
    for entry in &plan.files {
        let dest = safe(&root, &entry.name)?;
        if !dest.is_file() || !fs::read(dest).is_ok_and(|data| hash(&data) == entry.after) {
            installed = false;
        }
    }
    Ok(InstalledStatus {
        installed,
        can_undo: true,
    })
}
pub fn undo(root: &Path, app: &str) -> Result<usize, AppError> {
    let _lock = LOCK
        .try_lock()
        .map_err(|_| err("A fix operation is already running."))?;
    let root = root.canonicalize().map_err(io)?;
    let backup = record(&root)?;
    let plan: Plan =
        serde_json::from_slice(&fs::read(backup.join("record.json")).map_err(io)?).map_err(io)?;
    if plan.app_id != app {
        return Err(err("Fix backup belongs to another game."));
    }
    for (i, entry) in plan.files.iter().enumerate() {
        let dest = safe(&root, &entry.name)?;
        if dest.exists() {
            let current = hash(&fs::read(dest).map_err(io)?);
            if current != entry.after && Some(&current) != entry.before.as_ref() {
                return Err(err(
                    "Game files changed since the fix. Undo stopped to preserve those changes.",
                ));
            }
        }
        if let Some(before) = &entry.before {
            let original = backup.join(i.to_string());
            if fs::symlink_metadata(&original)
                .map_err(io)?
                .file_type()
                .is_symlink()
                || hash(&fs::read(original).map_err(io)?) != *before
            {
                return Err(err("Fix backup verification failed."));
            }
        }
    }
    for (i, entry) in plan.files.iter().enumerate() {
        let dest = safe(&root, &entry.name)?;
        if entry.before.is_some() {
            let data = fs::read(backup.join(i.to_string())).map_err(io)?;
            write_atomic(&dest, &data)?;
        } else if dest.exists() {
            fs::remove_file(dest).map_err(io)?;
        }
    }
    // Keep originals on disk as an archive; remove only the active record to permit the next fix.
    let archive = root.join(format!(
        ".steamhub-online-fix-undone-{}",
        super::workspace::now()
    ));
    fs::rename(backup, archive).map_err(io)?;
    Ok(plan.files.len())
}
#[cfg(test)]
mod tests {
    use super::*;
    static TEST_LOCK: Mutex<()> = Mutex::new(());
    use zip::write::SimpleFileOptions;
    fn zip(path: &Path, name: &str, data: &[u8]) {
        let mut zip = zip::ZipWriter::new(File::create(path).unwrap());
        zip.start_file(name, SimpleFileOptions::default()).unwrap();
        zip.write_all(data).unwrap();
        zip.finish().unwrap();
    }
    #[test]
    fn nested_game_destination_is_detected_and_undo_restores_originals() {
        let _guard = TEST_LOCK.lock().unwrap();
        let t = tempfile::tempdir().unwrap();
        let root = t.path().join("game");
        let plugin = root.join("Nested Game/Game_Data/Plugins/x86_64/steam_api64.dll");
        fs::create_dir_all(plugin.parent().unwrap()).unwrap();
        fs::write(&plugin, b"original").unwrap();
        fs::write(root.join("Nested Game/Game.exe"), b"inert").unwrap();
        fs::create_dir_all(root.join("Game_Data/Plugins/x86_64")).unwrap();
        fs::write(
            root.join("Game_Data/Plugins/x86_64/steam_api64.dll"),
            b"misplaced",
        )
        .unwrap();
        let source = t.path().join("fix.zip");
        zip(
            &source,
            "Game_Data/Plugins/x86_64/steam_api64.dll",
            b"patch",
        );
        let cache = t.path().join("cache");
        let plan = preview(&cache, &root, "4001890", &source).unwrap();
        assert_eq!(plan.destination_prefix, "Nested Game");
        assert_eq!(plan.files[0].before, Some(hash(b"original")));
        apply(&cache, &root, "4001890", &plan.id).unwrap();
        assert_eq!(fs::read(&plugin).unwrap(), b"patch");
        assert!(status(&root, "4001890").unwrap().installed);
        assert_eq!(
            fs::read(root.join("Game_Data/Plugins/x86_64/steam_api64.dll")).unwrap(),
            b"misplaced"
        );
        undo(&root, "4001890").unwrap();
        assert_eq!(fs::read(&plugin).unwrap(), b"original");
    }
    #[test]
    fn ambiguous_nested_destinations_and_stale_reviews_are_rejected() {
        let _guard = TEST_LOCK.lock().unwrap();
        let t = tempfile::tempdir().unwrap();
        let root = t.path().join("game");
        fs::create_dir_all(root.join("first")).unwrap();
        fs::write(root.join("first/test.dll"), b"original").unwrap();
        let source = t.path().join("fix.zip");
        zip(&source, "test.dll", b"patch");
        let cache = t.path().join("cache");
        let plan = preview(&cache, &root, "620", &source).unwrap();
        fs::create_dir(root.join("second")).unwrap();
        fs::write(root.join("second/test.dll"), b"original").unwrap();
        assert!(preview(&cache, &root, "620", &source).is_err());
        assert!(apply(&cache, &root, "620", &plan.id).is_err());
        assert!(!root.join(RECORD).exists());
    }
    #[test]
    fn rejects_how_to_fish_game_data_zip_before_review() {
        let t = tempfile::tempdir().unwrap();
        let source = t.path().join("4001890.zip");
        let cache = t.path().join("cache");
        let mut zip = zip::ZipWriter::new(File::create(&source).unwrap());
        for name in ["4001890.lua", "4001891_6932805931423228382.manifest"] {
            zip.start_file(name, SimpleFileOptions::default()).unwrap();
            zip.write_all(b"fixture").unwrap();
        }
        zip.finish().unwrap();
        let failure = preview(&cache, t.path(), "4001890", &source).err().unwrap();
        assert!(failure.message.contains("Select the separate fix ZIP"));
        assert!(!cache.exists());
    }
    #[test]
    fn review_apply_undo_and_update_conflicts() {
        let _guard = TEST_LOCK.lock().unwrap();
        let t = tempfile::tempdir().unwrap();
        let root = t.path().join("game");
        fs::create_dir(&root).unwrap();
        let cache = t.path().join("cache");
        let source = t.path().join("fix.zip");
        fs::write(root.join("test.dll"), b"original").unwrap();
        zip(&source, "test.dll", b"patch");
        let plan = preview(&cache, &root, "620", &source).unwrap();
        fs::write(root.join("test.dll"), b"update").unwrap();
        assert!(apply(&cache, &root, "620", &plan.id).is_err());
        let plan = preview(&cache, &root, "620", &source).unwrap();
        assert_eq!(apply(&cache, &root, "620", &plan.id).unwrap(), 1);
        assert_eq!(fs::read(root.join("test.dll")).unwrap(), b"patch");
        assert!(status(&root, "620").unwrap().installed);
        fs::write(root.join("test.dll"), b"later update").unwrap();
        let checked = status(&root, "620").unwrap();
        assert!(!checked.installed && checked.can_undo);
        assert!(undo(&root, "620").is_err());
        fs::write(root.join("test.dll"), b"patch").unwrap();
        undo(&root, "620").unwrap();
        assert_eq!(fs::read(root.join("test.dll")).unwrap(), b"update");
        assert!(!status(&root, "620").unwrap().can_undo);
    }
    #[test]
    fn added_files_are_removed_and_unrelated_files_survive_undo() {
        let _guard = TEST_LOCK.lock().unwrap();
        let t = tempfile::tempdir().unwrap();
        let root = t.path().join("game");
        fs::create_dir(&root).unwrap();
        let cache = t.path().join("cache");
        let source = t.path().join("fix.zip");
        zip(&source, "bin/test.dll", b"new");
        fs::write(root.join("user-save.dat"), b"keep").unwrap();
        let plan = preview(&cache, &root, "620", &source).unwrap();
        apply(&cache, &root, "620", &plan.id).unwrap();
        undo(&root, "620").unwrap();
        assert!(!root.join("bin/test.dll").exists());
        assert_eq!(fs::read(root.join("user-save.dat")).unwrap(), b"keep");
    }
    #[test]
    fn traversal_reserved_and_links_are_rejected_before_changes() {
        let t = tempfile::tempdir().unwrap();
        let source = t.path().join("fix.zip");
        for name in [
            "../escape.dll",
            "/absolute.dll",
            "a:stream",
            "CON.dll",
            "dir/../../x",
            "TEST.DLL/../a",
        ] {
            zip(&source, name, b"test");
            assert!(
                preview(&t.path().join("cache"), t.path(), "620", &source).is_err(),
                "{name}"
            );
        }
    }
}

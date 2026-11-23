//! Bundled, offline runtime setup. Existing files are never overwritten.
use crate::contracts::AppError;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
pub(crate) static LOCK: Mutex<()> = Mutex::new(());
const BUNDLE: &[u8] = include_bytes!("../../runtime-bundle.zip");
const JOURNAL: &str = ".steamhub-runtime-setup.json";
fn err(message: impl AsRef<str>) -> AppError {
    AppError::new("RUNTIME_SETUP", message.as_ref(), true)
}
fn io(e: impl std::fmt::Display) -> AppError {
    err(format!(
        "Runtime setup failed: {e}. Check Steam folder permissions."
    ))
}
fn hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub steam_root: String,
    pub installed: bool,
    pub can_undo: bool,
}
#[derive(Serialize, Deserialize)]
struct Entry {
    name: String,
    hash: String,
}
fn root(path: &Path) -> Result<PathBuf, AppError> {
    let root = path.canonicalize().map_err(io)?;
    if !root.join("steam.exe").is_file() {
        return Err(err("Choose the Steam folder containing steam.exe."));
    }
    Ok(root)
}
pub(crate) fn safe(root: &Path, name: &str) -> Result<PathBuf, AppError> {
    let rel = Path::new(name);
    if rel
        .components()
        .any(|c| !matches!(c, std::path::Component::Normal(_)))
    {
        return Err(err("Invalid runtime file path."));
    }
    let mut path = root.to_path_buf();
    for component in rel.components() {
        path.push(component);
        if let Ok(meta) = fs::symlink_metadata(&path) {
            if meta.file_type().is_symlink() || !path.canonicalize().map_err(io)?.starts_with(root)
            {
                return Err(err(
                    "A runtime path redirects outside Steam. Setup stopped.",
                ));
            }
        }
    }
    Ok(path)
}
fn bundle() -> Result<Vec<(String, Vec<u8>)>, AppError> {
    let mut archive = zip::ZipArchive::new(Cursor::new(BUNDLE)).map_err(io)?;
    let mut files = vec![];
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(io)?;
        let name = file.name().to_owned();
        if !(matches!(
            name.as_str(),
            "OpenSteamTool.dll" | "dwmapi.dll" | "xinput1_4.dll" | "opensteamtool.toml"
        ) || name.starts_with("opensteamtool/") && name.ends_with(".toml"))
        {
            return Err(err("Unexpected bundled runtime file."));
        }
        let mut bytes = vec![];
        file.read_to_end(&mut bytes).map_err(io)?;
        files.push((name, bytes));
    }
    Ok(files)
}
pub fn status(path: &Path) -> Result<Status, AppError> {
    let root = root(path)?;
    Ok(Status {
        steam_root: root.to_string_lossy().into_owned(),
        installed: super::lua::runtime_root(&root).is_ok(),
        can_undo: safe(&root, JOURNAL)?.is_file(),
    })
}
pub(crate) fn steam_closed() -> Result<(), AppError> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let output = std::process::Command::new("tasklist.exe")
            .args(["/FI", "IMAGENAME eq steam.exe", "/FO", "CSV", "/NH"])
            .creation_flags(0x08000000)
            .output()
            .map_err(io)?;
        if !output.status.success() {
            return Err(err("Could not check Steam. Close Steam and try again."));
        }
        if String::from_utf8_lossy(&output.stdout)
            .to_lowercase()
            .contains("\"steam.exe\"")
        {
            return Err(err(
                "Fully exit Steam, including its system tray icon, then try again.",
            ));
        }
    }
    Ok(())
}
pub fn change(path: &Path, undo: bool) -> Result<Status, AppError> {
    let _guard = LOCK
        .try_lock()
        .map_err(|_| err("Runtime setup is already running."))?;
    steam_closed()?;
    change_closed(path, undo)
}
fn change_closed(path: &Path, undo: bool) -> Result<Status, AppError> {
    let root = root(path)?;
    let journal = safe(&root, JOURNAL)?;
    let files = bundle()?;
    if undo {
        let entries: Vec<Entry> =
            serde_json::from_slice(&fs::read(&journal).map_err(io)?).map_err(io)?;
        // Validate the entire undo plan before touching any file.
        for entry in &entries {
            if !files
                .iter()
                .any(|(name, bytes)| name == &entry.name && hash(bytes) == entry.hash)
            {
                return Err(err("Invalid runtime rollback record."));
            }
            let dest = safe(&root, &entry.name)?;
            if dest.exists() && hash(&fs::read(&dest).map_err(io)?) != entry.hash {
                return Err(err(
                    "Runtime files changed since setup. Undo stopped to preserve those changes.",
                ));
            }
        }
        for entry in entries {
            let dest = safe(&root, &entry.name)?;
            if dest.exists() {
                fs::remove_file(dest).map_err(io)?;
            }
        }
        fs::remove_file(journal).map_err(io)?;
        return status(&root);
    }
    if root.join("stbase.dll").exists() {
        return Err(err("Another SteamTools runtime is already present. Setup preserved it; remove that runtime before installing OpenSteamTool."));
    }
    if journal.exists() {
        return Err(err(
            "A previous setup has an undo record. Undo that setup before reinstalling.",
        ));
    }
    let mut plan = vec![];
    for (name, bytes) in &files {
        let dest = safe(&root, name)?;
        if dest.exists() {
            if name.ends_with(".dll") && fs::read(dest).map_err(io)? != *bytes {
                return Err(err("A different runtime DLL already exists. Setup preserved it; back up and remove the old runtime before retrying."));
            }
        } else {
            plan.push(Entry {
                name: name.clone(),
                hash: hash(bytes),
            });
        }
    }
    if plan.is_empty() {
        return status(&root);
    }
    // Durable rollback record precedes all live writes; interrupted setup stays undoable.
    let mut record = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&journal)
        .map_err(io)?;
    let data = serde_json::to_vec(&plan).map_err(io)?;
    if let Err(e) = record.write_all(&data).and_then(|_| record.sync_all()) {
        drop(record);
        let _ = fs::remove_file(&journal);
        return Err(io(e));
    }
    drop(record);
    for entry in &plan {
        let dest = safe(&root, &entry.name)?;
        fs::create_dir_all(dest.parent().ok_or_else(|| err("Invalid destination."))?)
            .map_err(io)?;
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&dest)
            .map_err(io)?;
        let bytes = &files
            .iter()
            .find(|(name, _)| name == &entry.name)
            .ok_or_else(|| err("Missing bundled file."))?
            .1;
        if let Err(e) = output.write_all(bytes).and_then(|_| output.sync_all()) {
            drop(output);
            let _ = fs::remove_file(&dest);
            return Err(io(e));
        }
        if hash(&fs::read(dest).map_err(io)?) != entry.hash {
            return Err(err("Runtime verification failed. Use Undo runtime setup."));
        }
    }
    status(&root)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bundled_runtime_matches_reviewed_hashes() {
        let files = bundle().unwrap();
        for (name, expected) in [
            (
                "OpenSteamTool.dll",
                "68269030c5d0375e56b7a651055e47413f9c11f3965e2e36dda54d1abcfc616f",
            ),
            (
                "dwmapi.dll",
                "93afab3bbb101059b192e40435d1d3cfb47034ca3da222487316ff2faa228c49",
            ),
            (
                "xinput1_4.dll",
                "d9ee34197f55df793f28cc3adeabf00d2b4844af164687aa6fff69398e5c9f2d",
            ),
            (
                "opensteamtool/pattern/steamclient/669fa08e259277fbf5a1dfe15ce88afe734e89151194304b44d92f418dcc985b.toml",
                "1dd02ae291697a591fead5a3da200c5b96485fb3aee4f1077d775f6d50622d2c",
            ),
            (
                "opensteamtool/pattern/steamui/2dfb0a5d50dd90667549cc7d413c7bfb0794c9af4ebaf08bf1cf7d938a11ea93.toml",
                "16fb2095d56bd20e30883475bebfd0e8f43f91355f79d33839ebe1cd26c24103",
            ),
            (
                "opensteamtool/ipc/steamclient/669fa08e259277fbf5a1dfe15ce88afe734e89151194304b44d92f418dcc985b.toml",
                "f4cb4ee88b91c000d67112f9f56a901aecf6e789cd41e8a76a7171c394b99453",
            ),
        ] {
            assert_eq!(
                hash(&files.iter().find(|(n, _)| n == name).unwrap().1),
                expected
            );
        }
    }
    #[test]
    fn setup_preserves_config_and_undo_keeps_user_files() {
        let temp = tempfile::tempdir().unwrap();
        let p = temp.path();
        fs::write(p.join("steam.exe"), b"fixture").unwrap();
        fs::write(p.join("opensteamtool.toml"), b"user config").unwrap();
        let installed = change_closed(p, false).unwrap();
        assert!(installed.installed && installed.can_undo);
        fs::create_dir_all(p.join("config/lua")).unwrap();
        fs::write(p.join("config/lua/user.lua"), b"keep").unwrap();
        assert_eq!(
            fs::read(p.join("opensteamtool.toml")).unwrap(),
            b"user config"
        );
        let result = change_closed(p, true).unwrap();
        assert!(!result.installed && !result.can_undo);
        assert!(p.join("config/lua/user.lua").exists());
        assert!(p.join("opensteamtool.toml").exists());
    }
    #[test]
    fn conflicts_and_modified_undo_are_non_destructive() {
        let temp = tempfile::tempdir().unwrap();
        let p = temp.path();
        fs::write(p.join("steam.exe"), b"fixture").unwrap();
        fs::write(p.join("dwmapi.dll"), b"other tool").unwrap();
        assert!(change_closed(p, false).is_err());
        assert!(!p.join(JOURNAL).exists());
        fs::remove_file(p.join("dwmapi.dll")).unwrap();
        change_closed(p, false).unwrap();
        fs::write(p.join("dwmapi.dll"), b"changed").unwrap();
        assert!(change_closed(p, true).is_err());
        assert!(p.join("OpenSteamTool.dll").exists());
    }
    #[test]
    fn missing_loader_is_not_ready() {
        let temp = tempfile::tempdir().unwrap();
        let p = temp.path();
        fs::write(p.join("steam.exe"), b"fixture").unwrap();
        fs::write(p.join("OpenSteamTool.dll"), b"fixture").unwrap();
        assert!(!status(p).unwrap().installed);
    }
}

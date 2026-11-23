//! Reversible, hash-bound disabling of dedicated Lua configurations. Never uninstalls games.
use crate::contracts::AppError;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

fn error(message: impl AsRef<str>) -> AppError {
    AppError::new("LUA_REMOVAL", message.as_ref(), true)
}
fn io(e: impl std::fmt::Display) -> AppError {
    error(format!("Lua removal could not finish: {e}"))
}
fn hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
fn relocate(from: &Path, to: &Path, expected: &str) -> Result<(), AppError> {
    // Same-directory hard links reserve the destination without replacing an existing file.
    fs::hard_link(from, to).map_err(io)?;
    if hash(&fs::read(from).map_err(io)?) != expected
        || hash(&fs::read(to).map_err(io)?) != expected
    {
        return Err(error(
            "Lua content changed during removal. Both paths were preserved for review.",
        ));
    }
    if let Err(e) = fs::remove_file(from) {
        let _ = fs::remove_file(to);
        return Err(io(e));
    }
    Ok(())
}
#[derive(Serialize, Deserialize, Clone)]
struct File {
    root: PathBuf,
    relative: String,
    hash: String,
    size: u64,
}
#[derive(Serialize, Deserialize)]
struct Stored {
    app: String,
    name: String,
    created: String,
    files: Vec<File>,
    blocked: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub id: String,
    pub app: String,
    pub name: String,
    pub files: Vec<FileView>,
    pub blocked: Vec<String>,
    pub can_undo: bool,
}
#[derive(Serialize)]
pub struct FileView {
    path: String,
    size: u64,
}
fn linked(meta: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    meta.file_type().is_symlink()
}
fn safe(root: &Path, relative: &str) -> Result<PathBuf, AppError> {
    let mut path = root.to_path_buf();
    if Path::new(relative)
        .components()
        .any(|c| !matches!(c, std::path::Component::Normal(_)))
    {
        return Err(error("Invalid Lua file path."));
    }
    for part in Path::new(relative).components() {
        path.push(part);
        match fs::symlink_metadata(&path) {
            Ok(meta) if linked(&meta) => {
                return Err(error(
                    "Linked Lua paths are unsupported. Existing files were preserved.",
                ))
            }
            Ok(_) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(io(e)),
        }
    }
    Ok(path)
}
fn paths(file: &File, id: &str) -> Result<(PathBuf, PathBuf), AppError> {
    let pieces: Vec<_> = file.relative.split('/').collect();
    if pieces.len() != 3
        || pieces[0] != "config"
        || !["lua", "stplug-in"].contains(&pieces[1])
        || !pieces[2].to_ascii_lowercase().ends_with(".lua")
    {
        return Err(error("Invalid removal record."));
    }
    let root = file.root.canonicalize().map_err(io)?;
    if root != file.root || !root.join("steam.exe").is_file() {
        return Err(error("The original Steam installation is unavailable."));
    }
    Ok((
        safe(&root, &file.relative)?,
        safe(&root, &format!("{}.steamhub-removed-{id}", file.relative))?,
    ))
}
fn folder(directory: &Path) -> Result<PathBuf, AppError> {
    let root = directory.canonicalize().map_err(io)?;
    let path = safe(&root, "lua-removals")?;
    fs::create_dir_all(&path).map_err(io)?;
    Ok(path)
}
fn load(directory: &Path, id: &str) -> Result<Stored, AppError> {
    if id.len() != 64
        || !id
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return Err(error("Invalid removal ID."));
    }
    let path = safe(&folder(directory)?, &format!("{id}.json"))?;
    if fs::metadata(&path).map_err(io)?.len() > 1024 * 1024 {
        return Err(error("Removal record is too large."));
    }
    let bytes = fs::read(path).map_err(io)?;
    if hash(&bytes) != id {
        return Err(error("Removal record checksum mismatch."));
    }
    serde_json::from_slice(&bytes).map_err(io)
}
fn view(id: &str, stored: &Stored) -> Result<View, AppError> {
    let mut can_undo = false;
    let mut blocked = stored.blocked.clone();
    for file in &stored.files {
        let (original, backup) = paths(file, id)?;
        if backup.exists() {
            can_undo = true;
            if hash(&fs::read(&backup).map_err(io)?) != file.hash || original.exists() {
                blocked.push(format!(
                    "Restore conflict: {}. Existing files were preserved.",
                    original.display()
                ));
            }
        }
    }
    Ok(View {
        id: id.into(),
        app: stored.app.clone(),
        name: stored.name.clone(),
        files: stored
            .files
            .iter()
            .map(|f| FileView {
                path: f.root.join(&f.relative).to_string_lossy().into_owned(),
                size: f.size,
            })
            .collect(),
        can_undo: can_undo && blocked.is_empty(),
        blocked,
    })
}
fn dedicated(bytes: &[u8], app: &str) -> bool {
    use full_moon::ast::{Call, Expression, FunctionArgs, Prefix, Stmt, Suffix};
    let Ok(text) = std::str::from_utf8(bytes) else {
        return false;
    };
    let Ok(ast) = full_moon::parse(text.trim_start_matches('\u{feff}')) else {
        return false;
    };
    let mut first = true;
    for stmt in ast.nodes().stmts() {
        let Stmt::FunctionCall(call) = stmt else {
            return false;
        };
        let Prefix::Name(name) = call.prefix() else {
            return false;
        };
        let suffixes: Vec<_> = call.suffixes().collect();
        let [Suffix::Call(Call::AnonymousCall(args))] = suffixes.as_slice() else {
            return false;
        };
        let FunctionArgs::Parentheses { arguments, .. } = args.as_ref() else {
            return false;
        };
        let values: Option<Vec<String>> = arguments
            .iter()
            .map(|e| match e {
                Expression::Number(t) => Some(t.token().to_string()),
                Expression::String(t) => {
                    Some(t.token().to_string().trim_matches(['\'', '"']).into())
                }
                _ => None,
            })
            .collect();
        let Some(values) = values else { return false };
        match name.token().to_string().to_ascii_lowercase().as_str() {
            "addappid" if (1..=3).contains(&values.len()) => {
                if first {
                    if values[0] != app {
                        return false;
                    };
                    first = false;
                } else if values.len() == 1 || values[0] == app {
                    return false;
                }
            }
            "setmanifestid" if !first && (2..=3).contains(&values.len()) => (),
            _ => return false,
        }
    }
    !first
}
pub fn preview(
    directory: &Path,
    roots: &BTreeSet<PathBuf>,
    app: &str,
    name: &str,
) -> Result<View, AppError> {
    let app = super::workspace::app_id(app)?.ok_or_else(|| error("Choose a game."))?;
    let mut stored = Stored {
        app: app.clone(),
        name: name.chars().take(200).collect(),
        created: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(io)?
            .as_nanos()
            .to_string(),
        files: vec![],
        blocked: vec![],
    };
    let mut seen = BTreeSet::new();
    let mut total = 0;
    for root in roots {
        if !root.join("steam.exe").is_file() {
            continue;
        }
        let root = root.canonicalize().map_err(io)?;
        if !seen.insert(root.clone()) {
            continue;
        }
        for sub in ["config/lua", "config/stplug-in"] {
            let path = safe(&root, sub)?;
            if !path.exists() {
                continue;
            }
            for entry in fs::read_dir(path).map_err(io)?.take(10000) {
                let entry = entry.map_err(io)?;
                let path = entry.path();
                if !path
                    .extension()
                    .is_some_and(|e| e.eq_ignore_ascii_case("lua"))
                {
                    continue;
                }
                if linked(&entry.metadata().map_err(io)?)
                    || linked(&fs::symlink_metadata(&path).map_err(io)?)
                {
                    return Err(error("Linked Lua files are unsupported."));
                }
                let meta = entry.metadata().map_err(io)?;
                if !meta.is_file() || meta.len() > 1024 * 1024 {
                    return Err(error(
                        "Lua directory contains an unsupported file. No files were removed.",
                    ));
                }
                let bytes = fs::read(&path).map_err(io)?;
                let named = path
                    .file_stem()
                    .is_some_and(|s| s == app.as_str() || s == format!("steamhub_{app}").as_str());
                if !super::lua_tracking::declarations(&bytes).contains(&app) && !named {
                    continue;
                }
                if !dedicated(&bytes, &app) {
                    stored.blocked.push(format!("{} is shared or custom Lua. Review it manually; automatic removal was blocked.",path.display()));
                    continue;
                }
                total += bytes.len();
                if total > 32 * 1024 * 1024 || stored.files.len() >= 100 {
                    return Err(error("Too many matching Lua files. No files were removed."));
                }
                stored.files.push(File {
                    root: root.clone(),
                    relative: format!("{sub}/{}", entry.file_name().to_string_lossy()),
                    hash: hash(&bytes),
                    size: meta.len(),
                });
            }
        }
    }
    let bytes = serde_json::to_vec(&stored).map_err(io)?;
    let id = hash(&bytes);
    let path = safe(&folder(directory)?, &format!("{id}.json"))?;
    let mut f = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .map_err(io)?;
    f.write_all(&bytes).and_then(|_| f.sync_all()).map_err(io)?;
    view(&id, &stored)
}
pub fn apply(directory: &Path, id: &str) -> Result<View, AppError> {
    let stored = load(directory, id)?;
    if stored.files.is_empty() || !stored.blocked.is_empty() {
        return Err(error(
            "No safe removal plan. Review shared/custom Lua manually.",
        ));
    }
    let mut plan = vec![];
    for file in &stored.files {
        let (original, backup) = paths(file, id)?;
        if backup.exists() || hash(&fs::read(&original).map_err(io)?) != file.hash {
            return Err(error(
                "Lua files changed since the preview. Refresh the preview before removing them.",
            ));
        }
        plan.push((original, backup));
    }
    for (index, (original, backup)) in plan.iter().enumerate() {
        if let Err(e) = relocate(original, backup, &stored.files[index].hash) {
            for (j, (original, backup)) in plan[..index].iter().enumerate().rev() {
                if !original.exists() {
                    let _ = relocate(backup, original, &stored.files[j].hash);
                }
            }
            return Err(error(format!(
                "Removal interrupted: {}. Check removal history for any files requiring undo.",
                e.message
            )));
        }
    }
    view(id, &stored)
}
pub fn undo(directory: &Path, id: &str) -> Result<View, AppError> {
    let stored = load(directory, id)?;
    let mut plan = vec![];
    for file in &stored.files {
        let (original, backup) = paths(file, id)?;
        if backup.exists() {
            if original.exists() || hash(&fs::read(&backup).map_err(io)?) != file.hash {
                return Err(error(
                    "A Lua path or backup changed after removal. Undo preserved those changes.",
                ));
            }
            plan.push((original, backup, file.hash.clone()));
        } else if !original.exists() || hash(&fs::read(&original).map_err(io)?) != file.hash {
            return Err(error(
                "A Lua backup is missing. Existing files were preserved.",
            ));
        }
    }
    if plan.is_empty() {
        return Err(error("This removal has already been undone."));
    }
    for (index, (original, backup, hash)) in plan.iter().enumerate() {
        if let Err(e) = relocate(backup, original, hash) {
            for (original, backup, hash) in plan[..index].iter().rev() {
                if !backup.exists() {
                    let _ = relocate(original, backup, hash);
                }
            }
            return Err(e);
        }
    }
    view(id, &stored)
}
pub fn history(directory: &Path) -> Result<Vec<View>, AppError> {
    let mut records = vec![];
    for entry in fs::read_dir(folder(directory)?)
        .map_err(io)?
        .take(10000)
        .flatten()
    {
        let path = entry.path();
        if path.extension().is_none_or(|e| e != "json") {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let stored = match load(directory, id) {
            Ok(stored) => stored,
            Err(e) => {
                records.push((
                    String::new(),
                    View {
                        id: id.into(),
                        app: "unknown".into(),
                        name: "Unavailable removal record".into(),
                        files: vec![],
                        blocked: vec![format!(
                            "{}. Original files and backups were preserved.",
                            e.message
                        )],
                        can_undo: false,
                    },
                ));
                continue;
            }
        };
        if stored
            .files
            .iter()
            .any(|f| paths(f, id).is_ok_and(|(_, b)| b.exists()))
        {
            records.push((stored.created.clone(), view(id, &stored)?));
        }
    }
    records.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(records.into_iter().map(|(_, v)| v).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (tempfile::TempDir, PathBuf, PathBuf, BTreeSet<PathBuf>) {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("Steam");
        let profile = temp.path().join("profile");
        fs::create_dir_all(root.join("config/lua")).unwrap();
        fs::create_dir_all(&profile).unwrap();
        fs::write(root.join("steam.exe"), b"inert fixture").unwrap();
        let roots = BTreeSet::from([root.canonicalize().unwrap()]);
        (temp, root, profile, roots)
    }
    fn write(root: &Path, name: &str, bytes: &[u8]) {
        let p = root.join(name);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, bytes).unwrap();
    }
    #[test]
    fn remove_multiple_copies_and_restore_across_reload_without_touching_game_data() {
        let (_t, root, profile, roots) = fixture();
        let lua = b"addappid(620)\naddappid(621,1,'fixture-key')\nsetManifestid(621,'123')";
        write(&root, "config/lua/renamed copy.lua", lua);
        write(&root, "config/stplug-in/620.lua", lua);
        write(&root, "config/lua/999.lua", b"addappid(999)");
        write(&root, "steamapps/common/Game/save.dat", b"game data");
        write(&root, "depotcache/621_123.manifest", b"manifest");
        let p = preview(&profile, &roots, "620", "Fixture game").unwrap();
        assert_eq!(p.files.len(), 2);
        assert!(p.blocked.is_empty());
        assert!(apply(&profile, &p.id).unwrap().can_undo);
        assert!(!root.join("config/lua/renamed copy.lua").exists());
        assert!(!root.join("config/stplug-in/620.lua").exists());
        let history = history(&profile).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].id, p.id);
        assert!(!undo(&profile, &p.id).unwrap().can_undo);
        assert!(super::history(&profile).unwrap().is_empty());
        assert_eq!(
            fs::read(root.join("config/lua/renamed copy.lua")).unwrap(),
            lua
        );
        assert_eq!(
            fs::read(root.join("config/stplug-in/620.lua")).unwrap(),
            lua
        );
        assert_eq!(
            fs::read(root.join("config/lua/999.lua")).unwrap(),
            b"addappid(999)"
        );
        assert_eq!(
            fs::read(root.join("steamapps/common/Game/save.dat")).unwrap(),
            b"game data"
        );
        assert_eq!(
            fs::read(root.join("depotcache/621_123.manifest")).unwrap(),
            b"manifest"
        );
    }
    #[test]
    fn shared_or_custom_lua_blocks_the_entire_removal() {
        let (_t, root, profile, roots) = fixture();
        write(
            &root,
            "config/lua/shared.lua",
            b"addappid(620)\naddappid(570)",
        );
        write(&root, "config/lua/620.lua", b"addappid(620)");
        let p = preview(&profile, &roots, "620", "Fixture").unwrap();
        assert_eq!(p.blocked.len(), 1);
        assert_eq!(p.files.len(), 1);
        assert!(apply(&profile, &p.id).is_err());
        assert!(root.join("config/lua/620.lua").exists());
        assert!(root.join("config/lua/shared.lua").exists());
        assert!(!dedicated(b"addappid(620)\nos.execute('custom')", "620"));
    }
    #[test]
    fn edits_after_preview_stop_all_changes() {
        let (_t, root, profile, roots) = fixture();
        write(&root, "config/lua/620.lua", b"addappid(620)");
        let p = preview(&profile, &roots, "620", "Fixture").unwrap();
        write(&root, "config/lua/620.lua", b"addappid(620) -- user edit");
        assert!(apply(&profile, &p.id).is_err());
        assert!(history(&profile).unwrap().is_empty());
        assert_eq!(
            fs::read(root.join("config/lua/620.lua")).unwrap(),
            b"addappid(620) -- user edit"
        );
    }
    #[test]
    fn undo_preserves_occupied_paths_and_modified_backups() {
        let (_t, root, profile, roots) = fixture();
        write(&root, "config/lua/620.lua", b"addappid(620)");
        let p = preview(&profile, &roots, "620", "Fixture").unwrap();
        apply(&profile, &p.id).unwrap();
        write(&root, "config/lua/620.lua", b"new user file");
        assert!(undo(&profile, &p.id).is_err());
        assert_eq!(
            fs::read(root.join("config/lua/620.lua")).unwrap(),
            b"new user file"
        );
        fs::remove_file(root.join("config/lua/620.lua")).unwrap();
        let stored = load(&profile, &p.id).unwrap();
        let (_, backup) = paths(&stored.files[0], &p.id).unwrap();
        fs::write(&backup, b"edited backup").unwrap();
        assert!(undo(&profile, &p.id).is_err());
        assert_eq!(fs::read(backup).unwrap(), b"edited backup");
        assert!(!history(&profile).unwrap()[0].can_undo);
    }
    #[test]
    fn rejects_tampered_records_and_existing_backup_destinations() {
        let (_t, root, profile, roots) = fixture();
        write(&root, "config/lua/620.lua", b"addappid(620)");
        let p = preview(&profile, &roots, "620", "Fixture").unwrap();
        let stored = load(&profile, &p.id).unwrap();
        let (_, backup) = paths(&stored.files[0], &p.id).unwrap();
        fs::write(&backup, b"preserve existing backup").unwrap();
        assert!(apply(&profile, &p.id).is_err());
        assert_eq!(fs::read(backup).unwrap(), b"preserve existing backup");
        fs::write(
            folder(&profile).unwrap().join(format!("{}.json", p.id)),
            b"{}",
        )
        .unwrap();
        assert!(apply(&profile, &p.id).is_err());
        assert!(safe(&root, "../outside.lua").is_err());
        write(&root, "config/lua/999.lua", b"addappid(999)");
        let other = preview(&profile, &roots, "999", "Other fixture").unwrap();
        apply(&profile, &other.id).unwrap();
        let entries = history(&profile).unwrap();
        assert!(entries
            .iter()
            .any(|entry| entry.id == other.id && entry.can_undo));
        assert!(entries
            .iter()
            .any(|entry| entry.id == p.id && !entry.can_undo && !entry.blocked.is_empty()));
    }
}

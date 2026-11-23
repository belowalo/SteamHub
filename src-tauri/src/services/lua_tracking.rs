//! Deployment evidence, independent of game ownership and vault-only imports.
use crate::{contracts::AppError, storage::Database};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeSet, fs, io::Write, path::Path};
#[derive(Deserialize, Serialize)]
struct Deployment {
    app: String,
    steam_root: String,
    filename: String,
    hash: String,
}
fn hash(data: &[u8]) -> String {
    Sha256::digest(data)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
fn err(e: impl std::fmt::Display) -> AppError {
    AppError::new(
        "IO_ERROR",
        &format!("Could not update Lua deployment tracking: {e}"),
        true,
    )
}
fn active(d: &Deployment) -> bool {
    if super::workspace::app_id(&d.app).ok().flatten().as_deref() != Some(&d.app)
        || d.filename != format!("steamhub_{}.lua", d.app)
    {
        return false;
    }
    let root = Path::new(&d.steam_root);
    let Ok(root) = root.canonicalize() else {
        return false;
    };
    if !root.join("steam.exe").is_file() {
        return false;
    }
    let Ok(file) = root.join("config/lua").join(&d.filename).canonicalize() else {
        return false;
    };
    file.starts_with(&root)
        && fs::metadata(&file).is_ok_and(|m| m.len() <= 1024 * 1024)
        && fs::read(file).is_ok_and(|bytes| hash(&bytes) == d.hash)
}
pub fn record(directory: &Path, root: &Path, app: &str, text: &str) -> Result<(), AppError> {
    let root = root.canonicalize().map_err(err)?;
    let d = Deployment {
        app: app.into(),
        steam_root: root.to_string_lossy().into_owned(),
        filename: format!("steamhub_{app}.lua"),
        hash: hash(text.as_bytes()),
    };
    if !active(&d) {
        return Err(err("Deployed Lua could not be verified."));
    }
    let folder = directory.join("lua-deployments");
    fs::create_dir_all(&folder).map_err(err)?;
    let id = hash(d.steam_root.as_bytes());
    let target = folder.join(format!("{app}-{id}.json"));
    let temporary = folder.join(format!(".{app}-{}.tmp", super::workspace::now()));
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(err)?;
    file.write_all(&serde_json::to_vec(&d).map_err(err)?)
        .and_then(|_| file.sync_all())
        .map_err(err)?;
    drop(file);
    fs::rename(&temporary, target).map_err(err)
}
fn recorded_apps(directory: &Path, db: &Database) -> Result<Vec<String>, AppError> {
    let mut result = BTreeSet::new();
    let folder = directory.join("lua-deployments");
    if folder.exists() {
        for file in fs::read_dir(folder).map_err(err)?.take(10000) {
            let file = file.map_err(err)?;
            if file.path().extension().and_then(|s| s.to_str()) != Some("json")
                || !file.metadata().is_ok_and(|m| m.len() < 32768)
            {
                continue;
            }
            if let Ok(bytes) = fs::read(file.path()) {
                if let Ok(d) = serde_json::from_slice::<Deployment>(&bytes) {
                    if active(&d) {
                        result.insert(d.app);
                    }
                }
            }
        }
    }
    // Older builds recorded generated Lua in the vault, but no separate deployment log.
    // Recover only when those exact bytes still exist under the detected Steam install.
    if let Some(root) = detected_root() {
        for file in db.workspace_files()? {
            if file.extension != "lua"
                || !["AppID lookup v1", "SteamTools v1"].contains(&file.version.as_str())
            {
                continue;
            }
            if let Some(app) = file.app_id {
                let d = Deployment {
                    app: app.clone(),
                    steam_root: root.clone(),
                    filename: file.name,
                    hash: file.id,
                };
                if active(&d) {
                    result.insert(app);
                }
            }
        }
    }
    Ok(result.into_iter().collect())
}
pub(super) fn declarations(bytes: &[u8]) -> BTreeSet<String> {
    use full_moon::ast::{Call, Expression, FunctionArgs, Prefix, Stmt, Suffix};
    let mut apps = BTreeSet::new();
    if bytes.len() > 1024 * 1024 || super::workspace::inspect("detected.lua", bytes).is_err() {
        return apps;
    }
    let Ok(text) = std::str::from_utf8(bytes) else {
        return apps;
    };
    let Ok(ast) = full_moon::parse(text.trim_start_matches(char::from_u32(0xfeff).unwrap())) else {
        return apps;
    };
    let mut first = true;
    for statement in ast.nodes().stmts() {
        let Stmt::FunctionCall(call) = statement else {
            continue;
        };
        let Prefix::Name(name) = call.prefix() else {
            continue;
        };
        if !name.token().to_string().eq_ignore_ascii_case("addappid") {
            continue;
        }
        let suffixes: Vec<_> = call.suffixes().collect();
        let [Suffix::Call(Call::AnonymousCall(arguments))] = suffixes.as_slice() else {
            continue;
        };
        let FunctionArgs::Parentheses { arguments, .. } = arguments.as_ref() else {
            continue;
        };
        let values: Vec<_> = arguments.iter().collect();
        if !(1..=3).contains(&values.len()) {
            continue;
        }
        let id = match values[0] {
            Expression::Number(token) => token.token().to_string(),
            Expression::String(token) => token
                .token()
                .to_string()
                .trim_matches(|c| c == char::from(39) || c == char::from(34))
                .to_owned(),
            _ => continue,
        };
        if let Ok(Some(id)) = super::workspace::app_id(&id) {
            // Later keyed declarations are depots, not separate games.
            if first {
                apps.insert(id);
            }
            first = false;
        }
    }
    apps
}
fn scan_root(root: &Path) -> BTreeSet<String> {
    let mut apps = BTreeSet::new();
    let Ok(root) = root.canonicalize() else {
        return apps;
    };
    if !root.join("steam.exe").is_file() {
        return apps;
    }
    for folder in ["config/lua", "config/stplug-in"] {
        let Ok(folder) = root.join(folder).canonicalize() else {
            continue;
        };
        if !folder.starts_with(&root) {
            continue;
        }
        let Ok(entries) = fs::read_dir(folder) else {
            continue;
        };
        for entry in entries.take(10000).flatten() {
            let path = entry.path();
            if !path
                .extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("lua"))
            {
                continue;
            }
            let Ok(path) = path.canonicalize() else {
                continue;
            };
            if !path.starts_with(&root)
                || !fs::metadata(&path).is_ok_and(|m| m.is_file() && m.len() <= 1024 * 1024)
            {
                continue;
            }
            if let Ok(bytes) = fs::read(path) {
                apps.extend(declarations(&bytes));
            }
        }
    }
    apps
}
pub fn apps(directory: &Path, db: &Database) -> Result<Vec<String>, AppError> {
    let mut apps: BTreeSet<_> = recorded_apps(directory, db)?.into_iter().collect();
    for root in roots(directory, db)? {
        apps.extend(scan_root(&root));
    }
    Ok(apps.into_iter().collect())
}
pub fn roots(directory: &Path, db: &Database) -> Result<BTreeSet<std::path::PathBuf>, AppError> {
    let mut roots: BTreeSet<std::path::PathBuf> = db
        .library_known_roots()?
        .into_iter()
        .map(|(root, _)| root.into())
        .collect();
    if let Some(root) = detected_root() {
        roots.insert(root.into());
    }
    let folder = directory.join("lua-deployments");
    if folder.is_dir() {
        for file in fs::read_dir(folder).map_err(err)?.take(10000).flatten() {
            if file
                .metadata()
                .is_ok_and(|m| m.is_file() && m.len() < 32768)
            {
                if let Ok(bytes) = fs::read(file.path()) {
                    if let Ok(record) = serde_json::from_slice::<Deployment>(&bytes) {
                        roots.insert(record.steam_root.into());
                    }
                }
            }
        }
    }
    Ok(roots)
}
fn detected_root() -> Option<String> {
    #[cfg(windows)]
    {
        let hkcu = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
        if let Ok(key) = hkcu.open_subkey("Software\\Valve\\Steam") {
            return key.get_value("SteamPath").ok();
        }
    }
    None
}
pub fn require(directory: &Path, db: &Database, app: &str) -> Result<(), AppError> {
    if apps(directory, db)?.iter().any(|id| id == app) {
        Ok(())
    } else {
        Err(AppError::new(
            "NOT_FOUND",
            "No active Lua configuration was found for this game.",
            false,
        ))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn detects_existing_lua_files_without_filename_or_vault_dependency() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        fs::write(root.join("steam.exe"), b"fixture").unwrap();
        fs::create_dir_all(root.join("config/lua")).unwrap();
        fs::create_dir_all(root.join("config/stplug-in")).unwrap();
        fs::write(root.join("config/lua/renamed (1).lua"), b"-- addappid(999)\naddappid(620)\naddappid(621,1,'key')\nif true then addappid(888) end\nos.execute('never run')").unwrap();
        fs::write(
            root.join("config/stplug-in/config.lua"),
            b"addappid(2379780,1,'key')\naddappid(2379781,1,'depot')",
        )
        .unwrap();
        fs::write(
            root.join("config/lua/220200.lua.disabled"),
            b"addappid(220200)",
        )
        .unwrap();
        fs::write(root.join("config/lua/123.lua"), b"-- no declaration").unwrap();
        assert_eq!(
            scan_root(root),
            BTreeSet::from(["620".into(), "2379780".into()])
        );
    }
    #[test]
    fn only_verified_deployments_qualify_and_survive_restart() {
        let t = tempfile::tempdir().unwrap();
        let root = t.path().join("Steam");
        fs::create_dir_all(root.join("config/lua")).unwrap();
        fs::write(root.join("steam.exe"), b"fixture").unwrap();
        let profile = t.path().join("profile");
        fs::create_dir(&profile).unwrap();
        let db = Database::open(&profile.join("app.db")).unwrap();
        assert!(recorded_apps(&profile, &db).unwrap().is_empty());
        assert!(record(&profile, &root, "620", "addappid(620)").is_err());
        let lua = root.join("config/lua/steamhub_620.lua");
        fs::write(&lua, b"addappid(620)").unwrap();
        record(&profile, &root, "620", "addappid(620)").unwrap();
        drop(db);
        let db = Database::open(&profile.join("app.db")).unwrap();
        assert_eq!(recorded_apps(&profile, &db).unwrap(), vec!["620"]);
        assert!(require(&profile, &db, "570").is_err());
        fs::write(&lua, b"changed").unwrap();
        assert!(recorded_apps(&profile, &db).unwrap().is_empty());
        fs::remove_file(lua).unwrap();
        assert!(recorded_apps(&profile, &db).unwrap().is_empty());
    }
}

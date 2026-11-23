//! Public AppID archive lookup. Never executes downloaded scripts or extracts paths.
use crate::{
    contracts::AppError,
    services::{
        library::keyvalues as kv,
        lua::{self, GeneratedLua},
    },
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    io::{Cursor, Read},
    path::Path,
};

const REPOS: &[&str] = &[
    "Satisl/MAU",
    "tymolu233/ManifestAutoUpdate",
    "Auiowu/ManifestAutoUpdate",
];
fn error(message: &str) -> AppError {
    AppError::new("GAME_DATA_UNAVAILABLE", message, true)
}
pub fn digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
#[derive(Serialize, Deserialize)]
pub struct CachedLookup {
    pub app: String,
    pub source: String,
    pub archive: Vec<u8>,
    pub dlcs: String,
    #[serde(default = "zip_format")]
    pub format: String,
    #[serde(default)]
    pub extra_manifests: Vec<ManifestBlob>,
    #[serde(default)]
    pub warnings: Vec<String>,
}
#[derive(Serialize, Deserialize)]
pub struct ManifestBlob {
    pub name: String,
    pub data: Vec<u8>,
}
fn zip_format() -> String {
    "zip".into()
}

pub mod credentials;
mod enrich;
mod remote;
mod sources;
pub use remote::{fetch, LookupProgress};
#[cfg(test)]
pub use sources::default_sources;
pub use sources::{save_sources, sources, validate_sources, DataSource};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lookup {
    pub id: String,
    pub app: String,
    pub source: String,
    pub generated: GeneratedLua,
    pub steam_root: Option<String>,
}
pub struct Bundle {
    pub generated: GeneratedLua,
    pub manifests: Vec<(String, Vec<u8>)>,
}

pub fn parse_cached(cached: &CachedLookup) -> Result<Bundle, AppError> {
    let mut bundle = match cached.format.as_str() {
        "zip" => parse(&cached.app, &cached.archive, &cached.dlcs),
        "lua" => parse_lua(&cached.app, &cached.archive),
        _ => Err(error("Unsupported game-data format.")),
    }?;
    let pins = enrich::pins(&bundle.generated.text);
    let mut total = 0usize;
    for blob in &cached.extra_manifests {
        total = total.saturating_add(blob.data.len());
        if total > 32 * 1024 * 1024
            || blob.data.is_empty()
            || !pins
                .iter()
                .any(|(d, g)| blob.name == format!("{d}_{g}.manifest"))
            || bundle.manifests.iter().any(|(name, _)| name == &blob.name)
        {
            return Err(error("Invalid supplemental depot manifest."));
        }
        bundle
            .generated
            .manifests
            .push(crate::services::manifest::CachedManifest {
                name: blob.name.clone(),
                size: blob.data.len(),
                sha256: digest(&blob.data),
            });
        bundle
            .manifests
            .push((blob.name.clone(), blob.data.clone()));
    }
    bundle.generated.warnings.extend(cached.warnings.clone());
    Ok(bundle)
}

/// Extract only literal, top-level data declarations; no Lua interpreter is used.
pub fn parse_lua(app: &str, bytes: &[u8]) -> Result<Bundle, AppError> {
    use full_moon::ast::{Call, Expression, FunctionArgs, Prefix, Stmt, Suffix};
    if bytes.len() > 1024 * 1024 {
        return Err(error("Lua data exceeds 1 MiB."));
    }
    let app = crate::services::workspace::app_id(app)?.ok_or_else(|| error("Enter an AppID."))?;
    crate::services::workspace::inspect(&format!("{app}.lua"), bytes)?;
    let text = std::str::from_utf8(bytes)
        .map_err(|_| error("Lua data must be UTF-8."))?
        .trim_start_matches('\u{feff}');
    let ast = full_moon::parse(text).map_err(|_| error("Source returned invalid Lua data."))?;
    let mut keys = BTreeMap::new();
    let mut pins = BTreeMap::new();
    let mut apps = Vec::new();
    let mut ignored = 0usize;
    for statement in ast.nodes().stmts() {
        let Stmt::FunctionCall(call) = statement else {
            ignored += 1;
            continue;
        };
        let Prefix::Name(name) = call.prefix() else {
            ignored += 1;
            continue;
        };
        let suffixes: Vec<_> = call.suffixes().collect();
        let [Suffix::Call(Call::AnonymousCall(arguments))] = suffixes.as_slice() else {
            ignored += 1;
            continue;
        };
        let FunctionArgs::Parentheses { arguments, .. } = arguments.as_ref() else {
            ignored += 1;
            continue;
        };
        let values: Option<Vec<String>> = arguments
            .iter()
            .map(|expression| match expression {
                Expression::Number(t) => Some(t.token().to_string()),
                Expression::String(t) => {
                    let raw = t.token().to_string();
                    if raw.len() >= 2
                        && ((raw.starts_with('"') && raw.ends_with('"'))
                            || (raw.starts_with('\'') && raw.ends_with('\'')))
                    {
                        Some(raw[1..raw.len() - 1].to_owned())
                    } else {
                        None
                    }
                }
                _ => None,
            })
            .collect();
        let Some(values) = values else {
            ignored += 1;
            continue;
        };
        match name.token().to_string().to_ascii_lowercase().as_str() {
            "addappid" if values.len() == 1 || values.len() == 2 => {
                apps.push(values[0].clone());
            }
            "addappid" if values.len() == 3 => {
                if values[0] == app {
                    apps.push(app.clone());
                }
                if keys.insert(values[0].clone(), values[2].clone()).is_some() {
                    return Err(error("Duplicate depot in Lua source."));
                }
            }
            "setmanifestid" if values.len() >= 2 => {
                if pins.insert(values[0].clone(), values[1].clone()).is_some() {
                    return Err(error("Duplicate manifest pin in Lua source."));
                }
            }
            _ => ignored += 1,
        }
    }
    if !apps.contains(&app) {
        return Err(error("Lua file does not declare the requested game AppID."));
    }
    let mut rows = String::new();
    for (id, key) in keys {
        rows.push_str(&format!("{id},{key}"));
        if let Some(gid) = pins.get(&id) {
            rows.push(',');
            rows.push_str(gid);
        }
        rows.push('\n');
    }
    let mut generated = lua::generate(&app, &rows, &apps.join(","))?;
    generated.warnings.push("Lua depot data was parsed without execution. Steam will fetch manifests that are not supplied as files.".into());
    if ignored > 0 {
        generated.warnings.push(format!("Ignored {ignored} unsupported Lua statements; only literal app/depot/manifest data is regenerated."));
    }
    Ok(Bundle {
        generated,
        manifests: vec![],
    })
}

pub fn parse(app: &str, bytes: &[u8], dlcs: &str) -> Result<Bundle, AppError> {
    if bytes.len() > 32 * 1024 * 1024 {
        return Err(error("Game archive exceeds 32 MiB."));
    }
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|_| error("Provider did not return a valid game archive."))?;
    if zip.len() > 1000 {
        return Err(error("Game archive has too many entries."));
    }
    let mut keys = BTreeMap::new();
    let mut manifests = BTreeMap::new();
    let mut total = 0u64;
    let mut embedded_lua = Vec::new();
    for i in 0..zip.len() {
        let entry = zip
            .by_index(i)
            .map_err(|_| error("Could not read archive entry."))?;
        if entry.is_dir() {
            continue;
        }
        let path = entry
            .enclosed_name()
            .ok_or_else(|| error("Archive contains an unsafe path."))?;
        if entry.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000) {
            return Err(error("Archive contains a symbolic link."));
        }
        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or_else(|| error("Invalid archive filename."))?
            .to_owned();
        let is_lua = name.to_ascii_lowercase().ends_with(".lua");
        // Only known data files are inspected, and Lua is never executed.
        if name != "config.vdf" && !name.ends_with(".manifest") && !is_lua {
            continue;
        }
        total = total.saturating_add(entry.size());
        if entry.size() > 64 * 1024 * 1024 || total > 256 * 1024 * 1024 {
            return Err(error("Archive expands beyond supported limits."));
        }
        let mut data = Vec::new();
        entry
            .take(64 * 1024 * 1024 + 1)
            .read_to_end(&mut data)
            .map_err(|_| error("Could not decode archive entry."))?;
        if data.len() > 64 * 1024 * 1024 {
            return Err(error("Archive entry is too large."));
        }
        if is_lua {
            if data.len() <= 1024 * 1024 {
                if embedded_lua.len() >= 16 {
                    return Err(error("Too many Lua candidates in archive."));
                }
                embedded_lua.push(data);
            }
        } else if name == "config.vdf" {
            let text =
                std::str::from_utf8(&data).map_err(|_| error("Depot metadata is not UTF-8."))?;
            let pairs = kv::parse(text).map_err(|_| error("Invalid depot metadata."))?;
            let depots = kv::field(&pairs, "depots")
                .ok()
                .flatten()
                .and_then(|v| v.object().ok())
                .ok_or_else(|| error("Depot metadata is missing."))?;
            for (id, value) in depots {
                let key = value
                    .object()
                    .ok()
                    .and_then(|v| kv::required(v, "DecryptionKey").ok())
                    .ok_or_else(|| error("A depot key is missing."))?;
                if keys.insert(id.clone(), key.to_owned()).is_some() {
                    return Err(error("Duplicate depot key record."));
                }
            }
        } else {
            let (id, gid) = name
                .trim_end_matches(".manifest")
                .split_once('_')
                .ok_or_else(|| error("Invalid manifest filename."))?;
            let id = id
                .parse::<u32>()
                .ok()
                .filter(|n| *n > 0)
                .ok_or_else(|| error("Invalid depot ID."))?;
            let gid = gid
                .parse::<u64>()
                .ok()
                .filter(|n| *n > 0)
                .ok_or_else(|| error("Invalid manifest ID."))?;
            if name != format!("{id}_{gid}.manifest")
                || data.is_empty()
                || manifests.insert(id.to_string(), (gid, data)).is_some()
            {
                return Err(error("Duplicate, empty or ambiguous depot manifest."));
            }
        }
    }
    if keys.is_empty() {
        let mut matching = embedded_lua
            .iter()
            .filter_map(|data| parse_lua(app, data).ok());
        if let Some(mut bundle) = matching.next() {
            if matching.next().is_some() {
                return Err(error(
                    "Archive contains multiple conflicting game Lua files.",
                ));
            }
            for (id, (gid, bytes)) in manifests {
                let pin = format!("setManifestid({id},\"{gid}\")");
                let declared = bundle
                    .generated
                    .text
                    .lines()
                    .any(|line| line.starts_with(&format!("addappid({id},1,\"")));
                let pinned = bundle
                    .generated
                    .text
                    .lines()
                    .any(|line| line.starts_with(&format!("setManifestid({id},")));
                if declared && (!pinned || bundle.generated.text.lines().any(|line| line == pin)) {
                    if !pinned {
                        bundle.generated.text.push_str(&format!("{pin}\n"));
                    }
                    let name = format!("{id}_{gid}.manifest");
                    bundle
                        .generated
                        .manifests
                        .push(crate::services::manifest::CachedManifest {
                            name: name.clone(),
                            size: bytes.len(),
                            sha256: digest(&bytes),
                        });
                    bundle.manifests.push((name, bytes));
                }
            }
            return Ok(bundle);
        }
        return Err(error("Provider has no complete depot data for this AppID. Try again later or use Advanced to supply data."));
    }
    if manifests.is_empty() {
        let rows = keys
            .iter()
            .map(|(id, key)| format!("{id},{key}"))
            .collect::<Vec<_>>()
            .join("\n");
        let mut generated = lua::generate(app, &rows, dlcs)?;
        generated.warnings.push("Source supplied depot keys without manifest files. Steam must fetch the current manifests.".into());
        return Ok(Bundle {
            generated,
            manifests: vec![],
        });
    }
    let mut rows = String::new();
    let mut blobs = Vec::new();
    for (id, (gid, data)) in manifests {
        let key = keys
            .get(&id)
            .ok_or_else(|| error("Provider archive is missing a required depot key."))?;
        rows.push_str(&format!("{id},{key},{gid}\n"));
        blobs.push((format!("{id}_{gid}.manifest"), data));
    }
    let mut generated = lua::generate(app, &rows, dlcs)?;
    generated.warnings.push("Community-supplied data. Manifest signatures, access and runtime compatibility are not verified by lookup.".into());
    generated.manifests = blobs
        .iter()
        .map(|(name, data)| crate::services::manifest::CachedManifest {
            name: name.clone(),
            size: data.len(),
            sha256: digest(data),
        })
        .collect();
    Ok(Bundle {
        generated,
        manifests: blobs,
    })
}

pub fn load(directory: &Path, id: &str) -> Result<CachedLookup, AppError> {
    if id.len() != 64 || !id.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err(error("Look up the game again."));
    }
    let mut bytes = Vec::new();
    std::fs::File::open(directory.join(format!("{id}.json")))
        .and_then(|f| f.take(128 * 1024 * 1024 + 1).read_to_end(&mut bytes))
        .map_err(|_| error("Lookup expired or is missing. Look up the game again."))?;
    if bytes.len() > 128 * 1024 * 1024 || digest(&bytes) != id {
        return Err(error("Lookup data changed. Look up the game again."));
    }
    serde_json::from_slice(&bytes).map_err(|_| error("Lookup data is invalid."))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_matching_three_argument_game_declaration_without_executing_code() {
        let data = format!(
            "addappid(1091500,1,\"{}\")\nos.execute('never run')",
            "ab".repeat(32)
        );
        let parsed = parse_lua("1091500", data.as_bytes()).unwrap();
        assert!(parsed.generated.text.contains("addappid(1091500"));
        assert!(!parsed.generated.text.contains("os.execute"));
        assert!(parse_lua("620", data.as_bytes()).is_err());
    }
    #[test]
    fn supplemental_manifests_must_match_known_pins_and_old_cache_files_still_load() {
        let lua = format!(
            "addappid(620)\naddappid(621,1,\"{}\")\nsetManifestid(621,\"18446744073709551615\")",
            "ab".repeat(32)
        );
        let mut cached: CachedLookup = serde_json::from_value(serde_json::json!({ "app":"620", "source":"Local", "archive": lua.as_bytes(), "dlcs":"", "format":"lua" })).unwrap();
        assert!(parse_cached(&cached).unwrap().manifests.is_empty());
        cached.extra_manifests.push(ManifestBlob {
            name: "621_18446744073709551615.manifest".into(),
            data: b"opaque manifest".to_vec(),
        });
        assert_eq!(parse_cached(&cached).unwrap().manifests.len(), 1);
        cached.extra_manifests[0].name = "622_1.manifest".into();
        assert!(parse_cached(&cached).is_err());
    }
    #[test]
    fn lua_sources_are_static_data_and_validate_identity_and_ids() {
        let text=format!("\u{feff}-- source\nADDAPPID(620)\naddappid(621,1,'{}')\nsetManifestid(621,'18446744073709551615')\nos.execute('not executed')\nif true then addappid(999) end", "ab".repeat(32));
        let bundle = parse_lua("620", text.as_bytes()).unwrap();
        assert!(bundle.generated.text.contains("18446744073709551615"));
        assert!(!bundle.generated.text.contains("execute"));
        assert!(!bundle.generated.text.contains("999"));
        assert!(parse_lua("999", text.as_bytes()).is_err());
        assert!(parse_lua("620", b"addappid(620)\naddappid(621,1,'not-a-key')").is_err());
    }
    #[test]
    fn source_settings_are_replaceable_and_persist() {
        let dir = tempfile::tempdir().unwrap();
        let mut configured = default_sources();
        configured.insert(
            0,
            DataSource {
                name: "User source".into(),
                url_template: "https://data.example/{appid}.lua".into(),
                format: "lua".into(),
                enabled: true,
                kind: "custom".into(),
                has_credential: false,
            },
        );
        save_sources(dir.path(), &configured).unwrap();
        assert_eq!(sources(dir.path()).unwrap()[0].name, "User source");
        configured[0].url_template = "http://example.com/{appid}.lua".into();
        assert!(validate_sources(&configured).is_err());
        configured[0].url_template = "https://user:secret@example.com/{appid}.lua".into();
        assert!(validate_sources(&configured).is_err());
        configured[0].url_template = "https://example.com/no-id".into();
        assert!(validate_sources(&configured).is_err());
    }
    #[test]
    fn accepts_lua_archives_and_key_only_archives() {
        let lua = format!("addappid(620)\naddappid(621,1,\"{}\")", "ab".repeat(32));
        let zip = archive(&[
            ("620.lua", lua.as_bytes()),
            ("621_42.manifest", b"manifest"),
        ]);
        let bundle = parse("620", &zip, "").unwrap();
        assert_eq!(bundle.manifests.len(), 1);
        assert!(bundle.generated.text.contains("setManifestid(621,\"42\")"));
        let config = format!(
            "\"depots\" {{\"621\" {{\"DecryptionKey\" \"{}\"}}}}",
            "ab".repeat(32)
        );
        let bundle = parse("620", &archive(&[("config.vdf", config.as_bytes())]), "").unwrap();
        assert!(bundle.manifests.is_empty());
        assert!(bundle.generated.text.contains("addappid(621,1,"));
        let renamed = archive(&[
            ("nested/620_public.lua", lua.as_bytes()),
            (
                "manifest.lua",
                b"function fetch_manifest_code() return nil end",
            ),
        ]);
        assert!(parse("620", &renamed, "").is_ok());
        assert!(parse(
            "620",
            &archive(&[("a.lua", lua.as_bytes()), ("b.lua", lua.as_bytes())]),
            ""
        )
        .is_err());
    }
    fn archive(entries: &[(&str, &[u8])]) -> Vec<u8> {
        use std::io::Write;
        let mut z = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, bytes) in entries {
            z.start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            z.write_all(bytes).unwrap();
        }
        z.finish().unwrap().into_inner()
    }
    #[test]
    fn rebuilds_data_without_executing_scripts_and_rejects_bad_archives() {
        let config = format!(
            "\"depots\" {{ \"621\" {{ \"DecryptionKey\" \"{}\" }} }}",
            "ab".repeat(32)
        );
        let zip = archive(&[
            ("root/config.vdf", config.as_bytes()),
            ("root/621_18446744073709551615.manifest", b"manifest"),
            ("root/evil.lua", b"os.execute('never')"),
        ]);
        let b = parse("620", &zip, "622").unwrap();
        assert!(b.generated.text.contains("18446744073709551615"));
        assert!(!b.generated.text.contains("execute"));
        assert_eq!(b.manifests.len(), 1);
        assert!(parse("620", &archive(&[("../config.vdf", config.as_bytes())]), "").is_err());
        assert!(parse(
            "620",
            &archive(&[("config.vdf", config.as_bytes()), ("622_42.manifest", b"x")]),
            ""
        )
        .is_err());
    }
}

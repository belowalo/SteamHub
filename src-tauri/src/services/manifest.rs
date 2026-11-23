//! Local manifest cache handling and replaceable request-code provider generation.
use crate::{contracts::AppError, services::lua::GeneratedLua};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{fs::File, io::Read, path::Path};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedManifest {
    pub name: String,
    pub size: usize,
    pub sha256: String,
}

/// Only names derived from already validated generator output are considered.
pub fn collect(root: &Path, lua: &str) -> Result<Vec<(CachedManifest, Vec<u8>)>, AppError> {
    let mut files = Vec::new();
    let mut total = 0usize;
    for line in lua
        .lines()
        .filter(|line| line.starts_with("setManifestid("))
    {
        let body = line
            .strip_prefix("setManifestid(")
            .and_then(|s| s.strip_suffix(')'))
            .ok_or_else(|| error("Invalid manifest entry."))?;
        let (depot, gid) = body
            .split_once(',')
            .ok_or_else(|| error("Invalid manifest entry."))?;
        let gid = gid.trim_matches('"');
        if depot.parse::<u32>().ok().filter(|v| *v > 0).is_none()
            || gid.parse::<u64>().ok().filter(|v| *v > 0).is_none()
            || !depot.bytes().chain(gid.bytes()).all(|c| c.is_ascii_digit())
        {
            return Err(error("Invalid manifest identity."));
        }
        let name = format!("{depot}_{gid}.manifest");
        let path = root.join("depotcache").join(&name);
        if !path.exists() {
            continue;
        }
        let mut bytes = Vec::new();
        File::open(path)
            .and_then(|f| f.take(64 * 1024 * 1024 + 1).read_to_end(&mut bytes))
            .map_err(|_| error("Could not read a cached manifest."))?;
        total += bytes.len();
        if bytes.is_empty() || bytes.len() > 64 * 1024 * 1024 || total > 256 * 1024 * 1024 {
            return Err(error("Manifest cache exceeds import limits."));
        }
        let sha256 = Sha256::digest(&bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        files.push((
            CachedManifest {
                name,
                size: bytes.len(),
                sha256,
            },
            bytes,
        ));
    }
    Ok(files)
}
fn error(s: &str) -> AppError {
    AppError::new("INVALID_INPUT", s, false)
}

/// The callback's helpers are nested because runtimes may evaluate top-level chunks separately.
pub fn provider(base: &str) -> Result<GeneratedLua, AppError> {
    let url = reqwest::Url::parse(base)
        .map_err(|_| error("Enter an HTTPS provider base URL ending in /."))?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !base.ends_with('/')
    {
        return Err(error(
            "Use an HTTPS base URL ending in /, without credentials, query or fragment.",
        ));
    }
    let base = serde_json::to_string(url.as_str()).map_err(|_| error("Invalid provider URL."))?;
    let text = format!(
        r#"-- SteamHub request-code adapter. Returns decimal strings without float conversion.
function fetch_manifest_code(gid)
    local function valid(value)
        if type(value) ~= "string" then return nil end
        local code = value:match("^%s*(%d+)%s*$")
        if not code then return nil end
        code = code:gsub("^0+", "")
        if #code == 0 or #code > 20 then return nil end
        if #code == 20 and code > "18446744073709551615" then return nil end
        return code
    end
    local id = valid(tostring(gid))
    if not id then return nil end
    local body, status = http_get({base} .. id, {{["User-Agent"]="ManifestDeX/1.0"}})
    if status ~= 200 then return nil end
    return valid(body)
end
function fetch_manifest_code_ex(app_id, depot_id, gid)
    return fetch_manifest_code(gid)
end
"#
    );
    Ok(GeneratedLua {
        text,
        filename: "manifest.lua".into(),
        installed_path: None,
        manifests: vec![],
        warnings: vec![],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cache_only_selects_named_manifests() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("depotcache")).unwrap();
        std::fs::write(
            dir.path().join("depotcache/621_42.manifest"),
            b"opaque fixture",
        )
        .unwrap();
        let files = collect(
            dir.path(),
            "setManifestid(621,\"42\")\nsetManifestid(622,\"43\")",
        )
        .unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].0.sha256.len(), 64);
        assert!(collect(dir.path(), "setManifestid(../621,\"42\")").is_err());
    }
    #[test]
    fn provider_accepts_replaceable_https_and_generates_valid_lua() {
        let g = provider("https://manifest.manifestdex.com/").unwrap();
        assert!(full_moon::parse(&g.text).is_ok());
        for bad in [
            "http://example.com/",
            "https://user:pass@example.com/",
            "https://example.com/?token=secret",
            "https://example.com",
        ] {
            assert!(provider(bad).is_err());
        }
        assert!(provider("https://my-provider.example/api/").is_ok());
    }
}

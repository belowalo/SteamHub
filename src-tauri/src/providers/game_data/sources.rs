use super::error;
use crate::contracts::AppError;
use serde::{Deserialize, Serialize};
use std::{io::Read, path::Path};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DataSource {
    pub name: String,
    pub url_template: String,
    pub format: String,
    pub enabled: bool,
    #[serde(default = "custom_kind")]
    pub kind: String,
    #[serde(default)]
    pub has_credential: bool,
}
fn custom_kind() -> String {
    "custom".into()
}
pub fn requires_key(kind: &str) -> bool {
    ["hubcap", "ryuu", "manifestdex", "manifesthub"].contains(&kind)
}
pub fn automatic(kind: &str) -> bool {
    !["openlua", "luatools", "manifesthub"].contains(&kind)
}
fn builtin(kind: &str, name: &str, url: &str, format: &str, enabled: bool) -> DataSource {
    DataSource {
        kind: kind.into(),
        name: name.into(),
        url_template: url.into(),
        format: format.into(),
        enabled,
        has_credential: false,
    }
}
pub fn default_sources() -> Vec<DataSource> {
    let mut sources: Vec<_> = super::REPOS
        .iter()
        .map(|repo| {
            builtin(
                "custom",
                repo,
                &format!("https://codeload.github.com/{repo}/zip/refs/heads/{{appid}}"),
                "zip",
                true,
            )
        })
        .collect();
    sources.extend([
        builtin(
            "hubcap",
            "Hubcap / Morrenus",
            "https://hubcapmanifest.com/api/v1/manifest/{appid}",
            "zip",
            true,
        ),
        builtin(
            "ryuu",
            "Ryuu",
            "https://generator.ryuu.lol/api/download/{appid}?file_type=manifest",
            "zip",
            true,
        ),
        builtin(
            "manifestdex",
            "ManifestDeX",
            "https://manifestdex.com/api/cli/get/{appid}",
            "lua",
            true,
        ),
        builtin(
            "catmisteam",
            "CatmiSteam",
            "https://catmisteam.com/steam-game-list/lua/{appid}.lua",
            "lua",
            true,
        ),
        builtin("openlua", "OpenLua", "", "lua", false),
        builtin("luatools", "LuaTools", "", "zip", false),
        builtin("manifesthub", "ManifestHub", "", "zip", true),
    ]);
    sources
}
pub fn validate_sources(sources: &[DataSource]) -> Result<(), AppError> {
    if sources.is_empty() || sources.len() > 16 {
        return Err(error(
            "Configure between one and sixteen game-data sources.",
        ));
    }
    let builtins = default_sources();
    let mut seen = std::collections::HashSet::new();
    for source in sources {
        if source.name.trim().is_empty()
            || source.name.len() > 80
            || !["zip", "lua"].contains(&source.format.as_str())
            || source.url_template.len() > 2048
        {
            return Err(error("Each source needs a name and ZIP/Lua format."));
        }
        if source.kind != "custom" {
            let preset = builtins
                .iter()
                .find(|s| s.kind == source.kind)
                .ok_or_else(|| error("Unknown built-in source."))?;
            if source.url_template != preset.url_template
                || source.format != preset.format
                || source.name != preset.name
                || !seen.insert(&source.kind)
            {
                return Err(error("Built-in source addresses and identities cannot be changed. Use a custom source instead."));
            }
            if ["openlua", "luatools"].contains(&source.kind.as_str()) && source.enabled {
                return Err(error("OpenLua and LuaTools currently require a website download, followed by import."));
            }
            continue;
        }
        if source.url_template.matches("{appid}").count() != 1 {
            return Err(error(
                "Custom source URLs must contain {appid} exactly once.",
            ));
        }
        let url = reqwest::Url::parse(&source.url_template.replace("{appid}", "1"))
            .map_err(|_| error("Invalid source URL."))?;
        if url.scheme() != "https"
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.fragment().is_some()
        {
            return Err(error(
                "Sources must use HTTPS without embedded credentials or fragments.",
            ));
        }
        if url.query_pairs().any(|(name, _)| {
            ["api_key", "apikey", "auth_key", "token", "access_token"]
                .contains(&name.to_ascii_lowercase().as_str())
        }) {
            return Err(error("Use a built-in provider's private key field instead of placing credentials in a source URL."));
        }
    }
    if !sources.iter().any(|s| s.enabled && automatic(&s.kind)) {
        return Err(error("Enable at least one automatic game-data source."));
    }
    Ok(())
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Settings {
    version: u32,
    sources: Vec<DataSource>,
}
pub fn sources(directory: &Path) -> Result<Vec<DataSource>, AppError> {
    let path = directory.join("game-data-sources.json");
    let mut parsed = if !path.exists() {
        default_sources()
    } else {
        let mut bytes = Vec::new();
        std::fs::File::open(path)
            .and_then(|f| f.take(65537).read_to_end(&mut bytes))
            .map_err(|_| error("Could not read source settings."))?;
        if bytes.len() > 65536 {
            return Err(error("Source settings are too large."));
        }
        if let Ok(settings) = serde_json::from_slice::<Settings>(&bytes) {
            if settings.version != 2 {
                return Err(error("Source settings require a newer SteamHub version."));
            }
            settings.sources
        } else {
            let mut legacy: Vec<DataSource> =
                serde_json::from_slice(&bytes).map_err(|_| error("Invalid source settings."))?;
            // Migrate the earlier plain array while retaining custom sources and their order.
            for source in default_sources().into_iter().filter(|s| s.kind != "custom") {
                if legacy.len() < 16 && !legacy.iter().any(|s| s.kind == source.kind) {
                    legacy.push(source);
                }
            }
            legacy
        }
    };
    validate_sources(&parsed)?;
    for source in &mut parsed {
        source.has_credential = requires_key(&source.kind)
            && super::credentials::load(directory, &source.kind)
                .ok()
                .flatten()
                .is_some();
    }
    Ok(parsed)
}
pub fn save_sources(directory: &Path, sources: &[DataSource]) -> Result<(), AppError> {
    validate_sources(sources)?;
    let mut stored = sources.to_vec();
    for source in &mut stored {
        source.has_credential = false;
    }
    let bytes = serde_json::to_vec_pretty(&Settings {
        version: 2,
        sources: stored,
    })
    .map_err(|_| error("Invalid source settings."))?;
    let temp = directory.join("game-data-sources.json.tmp");
    std::fs::write(&temp, bytes)
        .and_then(|_| std::fs::rename(&temp, directory.join("game-data-sources.json")))
        .map_err(|_| error("Could not save source settings."))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_array_migrates_without_losing_custom_settings_and_saved_disables_persist() {
        let directory = tempfile::tempdir().unwrap();
        let mut legacy = default_sources()[..3].to_vec();
        legacy[0].name = "My feed".into();
        legacy[0].enabled = false;
        std::fs::write(
            directory.path().join("game-data-sources.json"),
            serde_json::to_vec(&legacy).unwrap(),
        )
        .unwrap();
        let mut loaded = sources(directory.path()).unwrap();
        assert_eq!(loaded.len(), 10);
        assert_eq!(loaded[0].name, "My feed");
        assert!(!loaded[0].enabled);
        loaded
            .iter_mut()
            .find(|s| s.kind == "catmisteam")
            .unwrap()
            .enabled = false;
        save_sources(directory.path(), &loaded).unwrap();
        assert!(
            !sources(directory.path())
                .unwrap()
                .iter()
                .find(|s| s.kind == "catmisteam")
                .unwrap()
                .enabled
        );
        let hub = loaded.iter_mut().find(|s| s.kind == "hubcap").unwrap();
        hub.url_template = "https://unrelated.example/{appid}".into();
        assert!(validate_sources(&loaded).is_err());
    }
    #[test]
    fn rejects_manual_sources_as_automatic_and_credentials_in_custom_urls() {
        let mut sources = default_sources();
        sources
            .iter_mut()
            .find(|s| s.kind == "openlua")
            .unwrap()
            .enabled = true;
        assert!(validate_sources(&sources).is_err());
        sources
            .iter_mut()
            .find(|s| s.kind == "openlua")
            .unwrap()
            .enabled = false;
        sources[0].url_template = "https://example.com/{appid}?api_key=private".into();
        assert!(validate_sources(&sources).is_err());
    }
}

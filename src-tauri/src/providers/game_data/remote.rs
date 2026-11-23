use super::{credentials, error, parse_cached, CachedLookup, DataSource, REPOS};
use crate::contracts::AppError;
use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue, LOCATION},
    Client, Url,
};
use std::{
    path::Path,
    time::{Duration, Instant},
};

pub(super) fn client() -> Result<Client, AppError> {
    Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("SteamHub/0.1.0")
        .build()
        .map_err(|_| error("Could not initialize game-data lookup."))
}
fn safe_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
}
pub(super) fn same_origin(a: &Url, b: &Url) -> bool {
    a.origin() == b.origin()
}
pub(super) fn status_message(status: u16) -> &'static str {
    match status {
        401 | 403 => "access/account required",
        404 => "no entry",
        429 => "rate limited",
        300..=399 => "unsupported redirect",
        _ => "service unavailable",
    }
}
/// Redirects are explicit so custom authentication headers never follow cross-origin hops.
pub(super) async fn get(
    client: &Client,
    mut url: Url,
    headers: HeaderMap,
    limit: usize,
    deadline: Instant,
) -> Result<Vec<u8>, AppError> {
    let origin = url.clone();
    for redirects in 0..=3 {
        if !safe_url(&url) {
            return Err(error("Provider returned an unsafe download address."));
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(error("request timed out"));
        }
        let mut request = client
            .get(url.clone())
            .timeout(remaining.min(Duration::from_secs(15)));
        if same_origin(&origin, &url) {
            request = request.headers(headers.clone());
        }
        let response = request
            .send()
            .await
            .map_err(|_| error("network request failed (connection, TLS or timeout)"))?;
        if response.status().is_redirection() && redirects < 3 {
            let location = response
                .headers()
                .get(LOCATION)
                .and_then(|s| s.to_str().ok())
                .ok_or_else(|| error("Provider returned an invalid redirect."))?;
            let mut next = url
                .join(location)
                .map_err(|_| error("Provider returned an invalid redirect."))?;
            if !same_origin(&origin, &next) {
                // Never forward a query credential, including one echoed into a redirect.
                let pairs: Vec<_> = next
                    .query_pairs()
                    .filter(|(k, _)| {
                        !["api_key", "apikey", "auth_key", "access_token"]
                            .contains(&k.to_ascii_lowercase().as_str())
                    })
                    .map(|(k, v)| (k.into_owned(), v.into_owned()))
                    .collect();
                next.set_query(None);
                if !pairs.is_empty() {
                    next.query_pairs_mut().extend_pairs(pairs);
                }
            }
            url = next;
            continue;
        }
        if !response.status().is_success() {
            return Err(error(status_message(response.status().as_u16())));
        }
        return super::super::read_limited_response(response, limit).await;
    }
    Err(error("too many redirects"))
}
pub(super) fn request(
    source: &DataSource,
    app: &str,
    key: Option<&str>,
) -> Result<(Url, HeaderMap), AppError> {
    let mut url = Url::parse(&source.url_template.replace("{appid}", app))
        .map_err(|_| error("Invalid source URL."))?;
    let mut headers = HeaderMap::new();
    if super::sources::requires_key(&source.kind) {
        let key = key.ok_or_else(|| error("API key needed"))?;
        if source.kind == "hubcap" {
            url.query_pairs_mut().append_pair("api_key", key);
        } else {
            let name = if source.kind == "ryuu" {
                "x-auth-key"
            } else {
                "x-manifestdex-key"
            };
            let mut value =
                HeaderValue::from_str(key).map_err(|_| error("Invalid provider API key."))?;
            value.set_sensitive(true);
            headers.insert(HeaderName::from_static(name), value);
        }
    }
    Ok((url, headers))
}
pub(super) fn manifestdex_lua(app: &str, bytes: &[u8]) -> Result<Vec<u8>, AppError> {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Key {
        depot_id: u32,
        key: String,
    }
    #[derive(serde::Deserialize)]
    struct Payload {
        success: bool,
        keys: Vec<Key>,
    }
    let payload: Payload = serde_json::from_slice(bytes)
        .map_err(|_| error("ManifestDeX returned invalid key data."))?;
    if !payload.success || payload.keys.is_empty() || payload.keys.len() > 1000 {
        return Err(error("ManifestDeX has no usable keys for this game."));
    }
    let rows = payload
        .keys
        .iter()
        .map(|k| format!("{},{}", k.depot_id, k.key))
        .collect::<Vec<_>>()
        .join("\n");
    Ok(crate::services::lua::generate(app, &rows, "")?
        .text
        .into_bytes())
}
#[derive(Clone, serde::Serialize)]
pub struct LookupProgress {
    pub index: usize,
    pub source: String,
    pub status: &'static str,
    pub detail: String,
}

pub async fn fetch(
    app: &str,
    sources: &[DataSource],
    directory: &Path,
    progress: impl Fn(LookupProgress) + Send + Sync,
) -> Result<CachedLookup, AppError> {
    super::validate_sources(sources)?;
    let app =
        crate::services::workspace::app_id(app)?.ok_or_else(|| error("Enter a valid AppID."))?;
    let client = client()?;
    let deadline = Instant::now() + Duration::from_secs(90);
    let mut failures = Vec::new();
    for (index, source) in sources
        .iter()
        .filter(|s| s.enabled && super::sources::automatic(&s.kind))
        .enumerate()
    {
        let report = |status, detail: &str| {
            progress(LookupProgress {
                index,
                source: source.name.clone(),
                status,
                detail: detail.chars().take(300).collect(),
            })
        };
        let key = if super::sources::requires_key(&source.kind) {
            match credentials::load(directory, &source.kind) {
                Ok(Some(key)) => Some(key),
                Ok(None) => {
                    report(
                        "skipped",
                        "API key needed. Configure it in Source Providers.",
                    );
                    failures.push(format!("{}: API key needed", source.name));
                    continue;
                }
                Err(_) => {
                    report(
                        "skipped",
                        "Saved API key could not be read. Save it again in Source Providers.",
                    );
                    failures.push(format!("{}: stored key unavailable", source.name));
                    continue;
                }
            }
        } else {
            None
        };
        if Instant::now() >= deadline {
            failures.push("lookup time limit reached".into());
            break;
        }
        let source_deadline = deadline.min(Instant::now() + Duration::from_secs(15));
        report("trying", "Downloading game data…");
        let result = async {
            let (url, headers) = request(source, &app, key.as_deref())?;
            let body = get(&client, url, headers, 32 * 1024 * 1024, source_deadline).await?;
            report("validating", "Checking game identity and file contents…");
            let archive = if source.kind == "manifestdex" {
                manifestdex_lua(&app, &body)?
            } else {
                body
            };
            let source_url = REPOS
                .iter()
                .find(|repo| {
                    format!("https://codeload.github.com/{repo}/zip/refs/heads/{{appid}}")
                        == source.url_template
                })
                .map(|repo| format!("https://github.com/{repo}/tree/{app}"))
                .unwrap_or_else(|| source.url_template.replace("{appid}", &app));
            let mut cached = CachedLookup {
                app: app.clone(),
                source: source_url,
                archive,
                dlcs: String::new(),
                format: source.format.clone(),
                extra_manifests: vec![],
                warnings: vec![],
            };
            let bundle = parse_cached(&cached)?;
            report(
                "validating",
                "Game data is valid. Checking supplemental metadata…",
            );
            // Optional metadata is enrichment, never a key source or a prerequisite for success.
            if let Ok(url) = Url::parse(&format!("https://api.steamcmd.net/v1/info/{app}")) {
                if let Ok(body) = get(
                    &client,
                    url,
                    HeaderMap::new(),
                    4 * 1024 * 1024,
                    deadline.min(Instant::now() + Duration::from_secs(5)),
                )
                .await
                {
                    if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&body) {
                        if let Some(ids) = json["data"][&app]["extended"]["listofdlc"].as_str() {
                            cached.dlcs = ids
                                .split(',')
                                .filter_map(|s| {
                                    crate::services::workspace::app_id(s).ok().flatten()
                                })
                                .collect::<Vec<_>>()
                                .join(",");
                        }
                    }
                }
            }
            if let Some(hub) = sources
                .iter()
                .find(|s| s.kind == "manifesthub" && s.enabled)
            {
                super::enrich::manifests(&client, hub, directory, &bundle, &mut cached, deadline)
                    .await;
            }
            Ok::<_, AppError>(cached)
        }
        .await;
        match result {
            Ok(cached) => {
                report("ready", "Usable game data found.");
                return Ok(cached);
            }
            Err(e) => {
                report("failed", &e.message);
                failures.push(format!("{}: {}", source.name, e.message));
            }
        }
    }
    Err(error(&format!("Configured sources could not supply game data for AppID {app}. Configure source keys or import a Lua/ZIP downloaded from OpenLua, LuaTools or another source. {}", failures.join("; "))))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn authentication_is_provider_specific_and_cannot_change_hosts() {
        let sources = super::super::default_sources();
        for (kind, header) in [("ryuu", "x-auth-key"), ("manifestdex", "x-manifestdex-key")] {
            let source = sources.iter().find(|s| s.kind == kind).unwrap();
            assert!(request(source, "620", None).is_err());
            let (url, headers) = request(source, "620", Some("test-private-key")).unwrap();
            assert!(!url.as_str().contains("test-private-key"));
            assert_eq!(headers[header], "test-private-key");
            assert!(!same_origin(
                &url,
                &Url::parse("https://another.example/download").unwrap()
            ));
            assert!(!same_origin(
                &url,
                &Url::parse(&format!(
                    "https://{}:8443/download",
                    url.host_str().unwrap()
                ))
                .unwrap()
            ));
        }
        let hub = sources.iter().find(|s| s.kind == "hubcap").unwrap();
        let (url, headers) = request(hub, "620", Some("key?with&delimiters")).unwrap();
        assert_eq!(
            url.query_pairs().find(|(k, _)| k == "api_key").unwrap().1,
            "key?with&delimiters"
        );
        assert!(headers.is_empty());
        assert_eq!(status_message(429), "rate limited");
    }
    #[test]
    fn manifestdex_requires_real_valid_key_data() {
        let json = format!(
            r#"{{"success":true,"keys":[{{"depotId":621,"key":"{}"}}]}}"#,
            "ab".repeat(32)
        );
        let lua = manifestdex_lua("620", json.as_bytes()).unwrap();
        assert!(super::super::parse_lua("620", &lua).is_ok());
        assert!(manifestdex_lua("620", br#"{"success":true,"keys":[]}"#).is_err());
        assert!(manifestdex_lua(
            "620",
            br#"{"success":false,"keys":[{"depotId":621,"key":"bad"}]}"#
        )
        .is_err());
    }
}

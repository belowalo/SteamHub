//! Read-only setup checks, sourced requirements, and private launch reports.
use crate::contracts::AppError;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::Path,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const TTL: u64 = 7 * 24 * 60 * 60;
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn error(message: &str) -> AppError {
    AppError::new("IO_ERROR", message, true)
}
pub fn app(value: &str) -> Result<String, AppError> {
    super::workspace::app_id(value)?
        .ok_or_else(|| AppError::new("INVALID_INPUT", "Select a game.", false))
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum LaunchResult {
    Untested,
    Launched,
    Failed,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Personal {
    pub result: LaunchResult,
    pub note: String,
    pub updated_at: Option<u64>,
    pub build: String,
}
impl Default for Personal {
    fn default() -> Self {
        Self {
            result: LaunchResult::Untested,
            note: String::new(),
            updated_at: None,
            build: String::new(),
        }
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Requirement {
    pub kind: String,
    pub detail: String,
    pub source: String,
}
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Compatibility {
    pub checked_at: Option<u64>,
    pub complete: bool,
    pub requirements: Vec<Requirement>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub app_id: String,
    pub lua: bool,
    pub installation: String,
    pub runtime: Option<bool>,
    pub fix: String,
    pub compatibility: Compatibility,
    pub stale: bool,
    pub personal: Personal,
    pub report_outdated: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Rule {
    app_id: String,
    expires_at: u64,
    requirements: Vec<Requirement>,
}
#[derive(Deserialize)]
struct Rules {
    entries: Vec<Rule>,
}

fn read<T: for<'de> Deserialize<'de>>(directory: &Path, area: &str, app: &str) -> Option<T> {
    let path = directory
        .join("game-status")
        .join(area)
        .join(format!("{app}.json"));
    if fs::metadata(&path).ok()?.len() > 64 * 1024 {
        return None;
    }
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}
fn write(directory: &Path, area: &str, app: &str, value: &impl Serialize) -> Result<(), AppError> {
    let folder = directory.join("game-status").join(area);
    fs::create_dir_all(&folder).map_err(|_| error("Could not create game status storage."))?;
    let temporary = folder.join(format!(
        ".{app}-{}.tmp",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    let bytes = serde_json::to_vec(value).map_err(|_| error("Could not encode game status."))?;
    fs::write(&temporary, bytes)
        .and_then(|_| fs::rename(&temporary, folder.join(format!("{app}.json"))))
        .map_err(|_| {
            let _ = fs::remove_file(&temporary);
            error("Could not save game status.")
        })
}
pub fn personal(directory: &Path, app: &str) -> Personal {
    read(directory, "personal", app).unwrap_or_default()
}
pub fn report(
    directory: &Path,
    app_id: &str,
    result: LaunchResult,
    note: String,
    build: String,
) -> Result<Personal, AppError> {
    let app = app(app_id)?;
    if note.chars().count() > 500 {
        return Err(AppError::new(
            "INVALID_INPUT",
            "Keep the launch note under 500 characters.",
            false,
        ));
    }
    let value = Personal {
        result,
        note,
        updated_at: Some(now()),
        build,
    };
    write(directory, "personal", &app, &value)?;
    Ok(value)
}
fn rules(app: &str, value: &mut Compatibility) {
    let database: Rules = serde_json::from_str(include_str!("../../data/compatibility.json"))
        .expect("bundled compatibility data");
    if let Some(rule) = database
        .entries
        .into_iter()
        .find(|r| r.app_id == app && r.expires_at > now())
    {
        for requirement in rule.requirements {
            if !value
                .requirements
                .iter()
                .any(|r| r.kind == requirement.kind)
            {
                value.requirements.push(requirement);
            }
        }
    }
}
pub fn cached(directory: &Path, app: &str) -> Compatibility {
    let mut value = read(directory, "requirements", app).unwrap_or_default();
    rules(app, &mut value);
    value
}
pub fn stale(value: &Compatibility) -> bool {
    value
        .checked_at
        .is_none_or(|at| now().saturating_sub(at) >= TTL)
}

fn text(html: &str) -> String {
    let mut result = String::new();
    let mut tag = false;
    for c in html.chars() {
        match c {
            '<' => {
                tag = true;
                result.push(' ');
            }
            '>' => tag = false,
            _ if !tag => result.push(c),
            _ => {}
        }
    }
    result = result
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&#39;", "'")
        .replace("&quot;", "\"");
    result
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(1000)
        .collect()
}
fn kind(value: &str) -> Option<&'static str> {
    let lower = value.to_ascii_lowercase();
    if lower.contains("anti-cheat") || lower.contains("anticheat") {
        Some("anticheat")
    } else if lower.contains("3rd-party account") || lower.contains("third-party account") {
        Some("account")
    } else if lower.contains("launcher") || lower.contains("ea app") {
        Some("launcher")
    } else if lower.contains("drm") || lower.contains("denuvo") {
        Some("drm")
    } else {
        None
    }
}
fn parse(html: &str, app: &str) -> Compatibility {
    let source = format!("https://store.steampowered.com/app/{app}/");
    let mut value = Compatibility {
        checked_at: Some(now()),
        complete: html.contains("id=\"appHubAppName\"")
            && html.contains("game_area_purchase")
            && html.contains("game_area_details_specs"),
        requirements: vec![],
    };
    let mut rest = html;
    while let Some(start) = rest.find("<div") {
        rest = &rest[start..];
        let Some(end) = rest.find('>') else { break };
        let opening = &rest[..end];
        rest = &rest[end + 1..];
        if !opening.contains("DRM_notice") {
            continue;
        }
        let content = rest;
        let mut depth = 1;
        let mut offset = 0;
        let mut finish = None;
        while let Some(at) = rest[offset..].find('<') {
            let at = offset + at;
            let Some(end) = rest[at..].find('>') else {
                break;
            };
            let tag = &rest[at..at + end + 1];
            if tag.starts_with("</div") {
                depth -= 1;
            } else if tag.starts_with("<div") {
                depth += 1;
            }
            offset = at + end + 1;
            if depth == 0 {
                finish = Some(at);
                break;
            }
        }
        if let Some(end) = finish {
            let detail = text(&content[..end]);
            if let Some(kind) = kind(&detail) {
                value.requirements.push(Requirement {
                    kind: kind.into(),
                    detail,
                    source: source.clone(),
                });
            }
            rest = &rest[offset..];
        } else {
            value.complete = false;
            break;
        }
        if value.requirements.len() >= 20 {
            value.complete = false;
            break;
        }
    }
    value
}
pub async fn compatibility(directory: &Path, app: &str, refresh: bool) -> Compatibility {
    let old = cached(directory, app);
    if !refresh && !stale(&old) {
        return old;
    }
    let fetched = async {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(12))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .ok()?;
        let response = client
            .get(format!(
                "https://store.steampowered.com/app/{app}/?l=english"
            ))
            .send()
            .await
            .ok()?;
        if !response.status().is_success() {
            return None;
        }
        let bytes = crate::providers::read_limited_response(response, 4 * 1024 * 1024)
            .await
            .ok()?;
        let html = std::str::from_utf8(&bytes).ok()?;
        let value = parse(html, app);
        (value.complete || !value.requirements.is_empty()).then_some(value)
    }
    .await;
    if let Some(mut value) = fetched {
        let _ = write(directory, "requirements", app, &value);
        rules(app, &mut value);
        value
    } else {
        old
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub app_id: String,
    pub compatibility: Compatibility,
    pub personal: Personal,
    pub stale: bool,
}
pub fn summaries(directory: &Path, apps: Vec<String>) -> Result<Vec<Summary>, AppError> {
    if apps.len() > 1000 {
        return Err(AppError::new(
            "INVALID_INPUT",
            "Too many game statuses requested.",
            false,
        ));
    }
    apps.into_iter()
        .map(|id| {
            let app = app(&id)?;
            let compatibility = cached(directory, &app);
            Ok(Summary {
                stale: stale(&compatibility),
                personal: personal(directory, &app),
                app_id: app,
                compatibility,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn requirements_are_scoped_to_store_notices() {
        let html = r#"<div id="appHubAppName">Game</div><div class="game_area_purchase game_area_details_specs"></div><p>A launcher appears in the story.</p><div class="DRM_notice">Requires 3rd-Party Account:&nbsp;EA Account</div><div class="DRM_notice"><div>Uses Kernel Level Anti-Cheat</div><div>Example &amp; Co</div></div><div class="DRM_notice">Requires agreement to a 3rd-party EULA</div>"#;
        let value = parse(html, "42");
        assert!(value.complete);
        assert_eq!(value.requirements.len(), 2);
        assert_eq!(value.requirements[0].kind, "account");
        assert_eq!(
            value.requirements[1].detail,
            "Uses Kernel Level Anti-Cheat Example & Co"
        );
        assert!(!parse("<h1>Age verification</h1>", "42").complete);
        assert!(!parse(r#"<div class="DRM_notice">truncated"#, "42").complete);
        assert!(parse(
            r#"<div id="appHubAppName"></div>game_area_purchase game_area_details_specs"#,
            "42"
        )
        .requirements
        .is_empty());
        assert_eq!(kind("Incorporates 3rd-party DRM: Denuvo"), Some("drm"));
    }
    #[test]
    fn reports_are_private_per_game_and_paths_validated() {
        let t = tempfile::tempdir().unwrap();
        report(
            t.path(),
            "42",
            LaunchResult::Failed,
            "Won't open".into(),
            "build1".into(),
        )
        .unwrap();
        assert_eq!(personal(t.path(), "42").result, LaunchResult::Failed);
        assert_eq!(personal(t.path(), "43").result, LaunchResult::Untested);
        assert!(report(
            t.path(),
            "../x",
            LaunchResult::Failed,
            String::new(),
            String::new()
        )
        .is_err());
        assert!(report(
            t.path(),
            "42",
            LaunchResult::Failed,
            "x".repeat(501),
            String::new()
        )
        .is_err());
        report(
            t.path(),
            "42",
            LaunchResult::Launched,
            String::new(),
            "build2".into(),
        )
        .unwrap();
        assert_eq!(personal(t.path(), "42").build, "build2");
        assert!(stale(&Compatibility::default()));
    }
}

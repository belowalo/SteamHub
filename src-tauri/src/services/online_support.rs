//! Online PvP/co-op classification from Steam, cached independently of fix availability.
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
#[derive(Deserialize, Serialize)]
struct Cached {
    online: Option<bool>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    item_type: Option<String>,
    checked: u64,
}
#[derive(Serialize)]
pub struct Eligibility {
    pub apps: Vec<String>,
    pub unknown: Vec<String>,
}
fn classify(data: &serde_json::Value) -> Option<bool> {
    match data["type"].as_str() {
        Some("game") => {}
        Some(_) => return Some(false),
        None => return None,
    }
    let categories = data["categories"].as_array()?;
    let ids: Vec<_> = categories
        .iter()
        .filter_map(|category| category["id"].as_u64())
        .collect();
    if ids.is_empty() {
        return None;
    }
    if ids.iter().any(|id| [20, 36, 38].contains(id)) {
        return Some(true);
    }
    if ids.iter().any(|id| [1, 9].contains(id))
        && !ids.iter().any(|id| [24, 37, 39, 47, 48].contains(id))
    {
        return None;
    }
    Some(false)
}
fn cached(directory: &Path, app: &str) -> Option<Cached> {
    let value: Cached = serde_json::from_slice(
        &fs::read(directory.join("online-support").join(format!("{app}.json"))).ok()?,
    )
    .ok()?;
    (now().saturating_sub(value.checked) < TTL).then_some(value)
}
pub fn require_cached(directory: &Path, app: &str) -> Result<(), AppError> {
    if cached(directory, app).and_then(|value| value.online) == Some(true) {
        Ok(())
    } else {
        Err(AppError::new("NOT_FOUND", "Online multiplayer/co-op support is not confirmed. Refresh Online Fixes to check again.", true))
    }
}
async fn load(directory: &Path, app: &str, refresh: bool) -> Option<Cached> {
    let app = super::workspace::app_id(app).ok().flatten()?;
    if !refresh {
        if let Some(value) = cached(directory, &app) {
            return Some(value);
        }
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .ok()?;
    let response = client
        .get(format!(
            "https://store.steampowered.com/api/appdetails?appids={app}&l=english"
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
    let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    if value[&app]["success"].as_bool() != Some(true) {
        return None;
    }
    let data = &value[&app]["data"];
    let online = classify(data);
    let record = Cached {
        online,
        checked: now(),
        name: data["name"].as_str().map(str::to_owned),
        item_type: data["type"].as_str().map(str::to_owned),
    };
    let folder = directory.join("online-support");
    fs::create_dir_all(&folder).ok()?;
    let temporary = folder.join(format!(
        ".{app}-{}.tmp",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    fs::write(&temporary, serde_json::to_vec(&record).ok()?).ok()?;
    fs::rename(temporary, folder.join(format!("{app}.json"))).ok()?;
    Some(record)
}
pub async fn check(directory: &Path, app: &str, refresh: bool) -> Option<bool> {
    load(directory, app, refresh).await?.online
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LuaGame {
    pub app_id: String,
    pub name: Option<String>,
}
pub async fn inventory(directory: &Path, apps: Vec<String>) -> Vec<LuaGame> {
    let mut result = vec![];
    for batch in apps.chunks(4) {
        let mut tasks = vec![];
        for app in batch {
            let directory = directory.to_path_buf();
            let app = app.clone();
            tasks.push(tauri::async_runtime::spawn(async move {
                let data = load(&directory, &app, false).await;
                (app, data)
            }));
        }
        for task in tasks {
            if let Ok((app, data)) = task.await {
                if data
                    .as_ref()
                    .and_then(|d| d.item_type.as_deref())
                    .is_none_or(|kind| ["game", "application"].contains(&kind))
                {
                    result.push(LuaGame {
                        app_id: app,
                        name: data.and_then(|d| d.name),
                    });
                }
            }
        }
    }
    result
}
pub async fn eligible(directory: &Path, apps: Vec<String>, refresh: bool) -> Eligibility {
    let mut result = Eligibility {
        apps: vec![],
        unknown: vec![],
    };
    for batch in apps.chunks(4) {
        let mut tasks = vec![];
        for app in batch {
            let app = app.clone();
            let directory = directory.to_path_buf();
            tasks.push(tauri::async_runtime::spawn(async move {
                let online = check(&directory, &app, refresh).await;
                (app, online)
            }));
        }
        for task in tasks {
            if let Ok((app, online)) = task.await {
                match online {
                    Some(true) => result.apps.push(app),
                    None => result.unknown.push(app),
                    Some(false) => {}
                }
            }
        }
    }
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn distinguishes_online_singleplayer_local_and_unknown() {
        let game = |ids: &[u64]| serde_json::json!({"type":"game","categories":ids.iter().map(|id|serde_json::json!({"id":id})).collect::<Vec<_>>()});
        assert_eq!(classify(&game(&[2, 38, 39])), Some(true));
        assert_eq!(classify(&game(&[1, 36])), Some(true));
        assert_eq!(classify(&game(&[20])), Some(true));
        assert_eq!(classify(&game(&[2, 22, 29])), Some(false));
        assert_eq!(classify(&game(&[1, 9, 39])), Some(false));
        assert_eq!(classify(&game(&[1])), None);
        assert_eq!(classify(&serde_json::json!({"type":"game"})), None);
        assert_eq!(
            classify(&serde_json::json!({"type":"application","categories":[{"id":36}]})),
            Some(false)
        );
    }
}

//! Public discovery only; fix payloads require a separate provider sign-in.
use crate::contracts::AppError;
use serde::{Deserialize, Serialize};
use std::time::Duration;
#[derive(Deserialize, Serialize)]
pub struct Tag {
    pub name: String,
    pub slug: String,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Vec<Tag>,
    #[serde(default)]
    pub has_fix: bool,
}
#[derive(Deserialize)]
struct Listing {
    appid: String,
    fixes: Vec<Release>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Discovery {
    pub app_id: String,
    pub fixes: Vec<Release>,
    pub warnings: Vec<String>,
    pub provider_error: Option<String>,
    pub source_url: String,
}
pub async fn discover(app: &str) -> Result<Discovery, AppError> {
    let app = super::workspace::app_id(app)?
        .ok_or_else(|| AppError::new("INVALID_INPUT", "Enter an AppID.", false))?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("SteamHub/0.1.0")
        .build()
        .map_err(|_| {
            AppError::new(
                "PROVIDER_UNAVAILABLE",
                "Could not initialize fix discovery.",
                true,
            )
        })?;
    let mut result = Discovery {
        app_id: app.clone(),
        fixes: vec![],
        warnings: vec![],
        provider_error: None,
        source_url: format!("https://lua.tools/fixes/{app}"),
    };
    match client.get(format!("https://lua.tools/api/denuvo/fixes?appid={app}")).send().await {
        Ok(response) if response.status().is_success() => {
            let bytes=crate::providers::read_limited_response(response,2*1024*1024).await?;
            match serde_json::from_slice::<Listing>(&bytes) {
                Ok(list) if list.appid == app => result.fixes=list.fixes.into_iter().map(|mut fix|{fix.description=fix.description.map(|text|plain(&text));fix}).collect(),
                _ => result.provider_error=Some("The fix provider returned an unexpected response.".into()),
            }
        }
        Ok(response) if response.status().as_u16()==404 => {},
        Ok(response) => result.provider_error=Some(format!("Fix provider returned HTTP {}. Try its website.",response.status().as_u16())),
        Err(_) => result.provider_error=Some("Could not securely connect to the fix provider (connection, certificate or timeout). Try again later.".into()),
    }
    match client
        .get(format!(
            "https://store.steampowered.com/api/appdetails?appids={app}&l=english"
        ))
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => {
            let bytes = crate::providers::read_limited_response(response, 4 * 1024 * 1024).await?;
            if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                let data = &value[&app]["data"];
                for key in ["drm_notice", "ext_user_account_notice"] {
                    if let Some(notice) = data[key].as_str().filter(|s| !s.trim().is_empty()) {
                        result.warnings.push(plain(notice));
                    }
                }
                if !value[&app]["success"].as_bool().unwrap_or(false) {
                    result.warnings.push(
                        "Steam did not return launcher/DRM information for this game.".into(),
                    );
                }
            } else {
                result
                    .warnings
                    .push("Steam launcher/DRM information could not be read.".into());
            }
        }
        _ => result
            .warnings
            .push("Steam launcher/DRM information could not be checked.".into()),
    }
    Ok(result)
}
fn plain(text: &str) -> String {
    let mut inside = false;
    text.chars()
        .filter(|c| match c {
            '<' => {
                inside = true;
                false
            }
            '>' => {
                inside = false;
                false
            }
            _ => !inside,
        })
        .take(3000)
        .collect()
}

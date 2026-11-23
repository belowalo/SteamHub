use super::{validate_url, MAX_OFFICIAL_RESPONSE_BYTES};
use crate::contracts::{
    catalog::{CatalogGameSummary, SourceAttribution},
    AppError,
};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct OfficialAppItem {
    appid: u64,
    name: Option<String>,
    last_modified: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct OfficialResponsePayload {
    apps: Option<Vec<OfficialAppItem>>,
    have_more_results: Option<bool>,
    last_appid: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct OfficialResponseWrapper {
    response: Option<OfficialResponsePayload>,
}

pub struct OfficialPageResult {
    pub games: Vec<CatalogGameSummary>,
    pub next_cursor: Option<String>,
    pub have_more: bool,
}

pub async fn fetch_app_list_page(
    client: &reqwest::Client,
    api_key: &str,
    max_results: usize,
    last_appid: Option<u64>,
) -> Result<OfficialPageResult, AppError> {
    let trimmed_key = api_key.trim();
    if trimmed_key.is_empty() {
        return Err(AppError::new(
            "PROVIDER_UNAVAILABLE",
            "Steam Web API key is required to sync from the official provider.",
            false,
        ));
    }

    let mut url = reqwest::Url::parse("https://api.steampowered.com/IStoreService/GetAppList/v1/")
        .map_err(|_| AppError::new("INTERNAL", "Could not parse official API URL.", false))?;

    url.query_pairs_mut()
        .append_pair("key", trimmed_key)
        .append_pair("max_results", &max_results.clamp(1, 10000).to_string());

    if let Some(cursor) = last_appid {
        url.query_pairs_mut()
            .append_pair("last_appid", &cursor.to_string());
    }

    let validated_url = validate_url(url.as_str())?;

    let response = client.get(validated_url).send().await.map_err(|e| {
        if e.is_timeout() {
            AppError::new("IO_ERROR", "Steam Web API request timed out.", true)
        } else {
            AppError::new(
                "PROVIDER_UNAVAILABLE",
                "Steam Web API is unreachable.",
                true,
            )
        }
    })?;

    let status = response.status();
    if status == reqwest::StatusCode::FORBIDDEN || status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(AppError::new(
            "PROVIDER_UNAVAILABLE",
            "Steam Web API key is invalid or not authorized.",
            false,
        ));
    }
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err(AppError::new(
            "RATE_LIMITED",
            "Steam Web API rate limit exceeded. Retry later.",
            true,
        ));
    }
    if !status.is_success() {
        return Err(AppError::new(
            "PROVIDER_UNAVAILABLE",
            "Steam Web API returned an error.",
            true,
        ));
    }

    let bytes = super::read_limited_response(response, MAX_OFFICIAL_RESPONSE_BYTES).await?;

    if bytes.len() > MAX_OFFICIAL_RESPONSE_BYTES {
        return Err(AppError::new(
            "UNSUPPORTED_FORMAT",
            "Steam Web API response exceeded safe size budget.",
            false,
        ));
    }

    let parsed: OfficialResponseWrapper = serde_json::from_slice(&bytes).map_err(|_| {
        AppError::new(
            "UNSUPPORTED_FORMAT",
            "Invalid response format from Steam Web API.",
            false,
        )
    })?;

    let payload = match parsed.response {
        Some(p) => p,
        None => {
            return Ok(OfficialPageResult {
                games: Vec::new(),
                next_cursor: None,
                have_more: false,
            })
        }
    };

    let now = chrono_now();
    let apps = payload.apps.unwrap_or_default();
    let have_more = payload.have_more_results.unwrap_or(false);
    let next_cursor = payload.last_appid.map(|id| id.to_string());

    let games: Vec<CatalogGameSummary> = apps
        .into_iter()
        .map(|item| {
            let app_id = item.appid.to_string();
            CatalogGameSummary {
                app_id,
                name: item.name,
                artwork_url: None,
                installed: false,
                metadata_source: Some(SourceAttribution {
                    provider_id: "steam-official".to_string(),
                    fetched_at: now.clone(),
                    freshness: "fresh".to_string(),
                    documentation_url: Some(
                        "https://partner.steamgames.com/doc/webapi/IStoreService".to_string(),
                    ),
                }),
                item_type: Some("app".to_string()),
                last_modified_unix: item.last_modified,
            }
        })
        .collect();

    Ok(OfficialPageResult {
        games,
        next_cursor,
        have_more,
    })
}

fn chrono_now() -> String {
    let now = std::time::SystemTime::now();
    let duration = now
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = duration.as_secs();

    let days = secs / 86400;
    let day_secs = secs % 86400;
    let hours = day_secs / 3600;
    let minutes = (day_secs % 3600) / 60;
    let seconds = day_secs % 60;

    let (year, month, day) = days_to_date(days);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, month, day, hours, minutes, seconds
    )
}

fn days_to_date(days: u64) -> (u64, u64, u64) {
    let z = days + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

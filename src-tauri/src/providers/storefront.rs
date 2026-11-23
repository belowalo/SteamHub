use super::{validate_url, MAX_RESPONSE_BYTES};
use crate::contracts::{
    catalog::{CatalogGameDetail, CatalogGameSummary, SourceAttribution},
    AppError,
};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct StoreSearchItem {
    id: u64,
    name: String,
    #[serde(rename = "type")]
    item_type: Option<String>,
    tiny_image: Option<String>,
}

#[derive(Debug, Deserialize)]
struct StoreSearchResponse {
    items: Option<Vec<StoreSearchItem>>,
}

#[derive(Debug, Deserialize)]
struct AppDetailsGenre {
    description: String,
}

#[derive(Debug, Deserialize)]
struct AppDetailsReleaseDate {
    date: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AppDetailsData {
    name: Option<String>,
    #[serde(rename = "type")]
    item_type: Option<String>,
    short_description: Option<String>,
    detailed_description: Option<String>,
    header_image: Option<String>,
    capsule_image: Option<String>,
    website: Option<String>,
    genres: Option<Vec<AppDetailsGenre>>,
    release_date: Option<AppDetailsReleaseDate>,
}

#[derive(Debug, Deserialize)]
struct AppDetailsWrapper {
    success: bool,
    data: Option<AppDetailsData>,
}

pub async fn search(
    client: &reqwest::Client,
    query: &str,
    limit: usize,
) -> Result<Vec<CatalogGameSummary>, AppError> {
    let mut url = reqwest::Url::parse("https://store.steampowered.com/api/storesearch/")
        .map_err(|_| AppError::new("INTERNAL", "Could not parse storefront URL.", false))?;
    url.query_pairs_mut()
        .append_pair("term", query)
        .append_pair("l", "english")
        .append_pair("cc", "US");
    let url = validate_url(url.as_str())?;

    let response = client.get(url).send().await.map_err(|e| {
        if e.is_timeout() {
            AppError::new("IO_ERROR", "Catalog search request timed out.", true)
        } else {
            AppError::new(
                "PROVIDER_UNAVAILABLE",
                "Steam Storefront service unreachable.",
                true,
            )
        }
    })?;

    let status = response.status();
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err(AppError::new(
            "RATE_LIMITED",
            "Steam Storefront rate limit exceeded. Please wait a moment and try again.",
            true,
        ));
    }
    if !status.is_success() {
        return Err(AppError::new(
            "PROVIDER_UNAVAILABLE",
            "Steam Storefront returned an error.",
            true,
        ));
    }

    let bytes = super::read_limited_response(response, MAX_RESPONSE_BYTES).await?;

    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err(AppError::new(
            "UNSUPPORTED_FORMAT",
            "Storefront response exceeded safe size budget.",
            false,
        ));
    }

    let parsed: StoreSearchResponse = serde_json::from_slice(&bytes).map_err(|_| {
        AppError::new(
            "UNSUPPORTED_FORMAT",
            "Invalid catalog response format from Steam Storefront.",
            false,
        )
    })?;

    let now = chrono_now();
    let safe_limit = limit.clamp(1, 50);

    let items = parsed.items.unwrap_or_default();
    let results: Vec<CatalogGameSummary> = items
        .into_iter()
        .take(safe_limit)
        .map(|item| {
            let app_id = item.id.to_string();
            CatalogGameSummary {
                app_id,
                name: Some(item.name),
                artwork_url: item.tiny_image,
                installed: false, // will be reconciled with local library index
                metadata_source: Some(SourceAttribution {
                    provider_id: "steam-storefront".to_string(),
                    fetched_at: now.clone(),
                    freshness: "fresh".to_string(),
                    documentation_url: Some("https://store.steampowered.com".to_string()),
                }),
                item_type: item.item_type.or(Some("app".to_string())),
                last_modified_unix: None,
            }
        })
        .collect();

    Ok(results)
}

pub async fn get_details(
    client: &reqwest::Client,
    app_id: &str,
) -> Result<Option<CatalogGameDetail>, AppError> {
    let mut url = reqwest::Url::parse("https://store.steampowered.com/api/appdetails")
        .map_err(|_| AppError::new("INTERNAL", "Could not parse appdetails URL.", false))?;
    url.query_pairs_mut()
        .append_pair("appids", app_id)
        .append_pair("l", "english");
    let url = validate_url(url.as_str())?;

    let response = client.get(url).send().await.map_err(|e| {
        if e.is_timeout() {
            AppError::new("IO_ERROR", "Catalog detail request timed out.", true)
        } else {
            AppError::new(
                "PROVIDER_UNAVAILABLE",
                "Steam Storefront service unreachable.",
                true,
            )
        }
    })?;

    let status = response.status();
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err(AppError::new(
            "RATE_LIMITED",
            "Steam Storefront rate limit exceeded. Please wait a moment and try again.",
            true,
        ));
    }
    if !status.is_success() {
        return Err(AppError::new(
            "PROVIDER_UNAVAILABLE",
            "Steam Storefront returned an error.",
            true,
        ));
    }

    let bytes = super::read_limited_response(response, MAX_RESPONSE_BYTES).await?;

    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err(AppError::new(
            "UNSUPPORTED_FORMAT",
            "App details response exceeded safe size budget.",
            false,
        ));
    }

    let map: std::collections::HashMap<String, AppDetailsWrapper> = serde_json::from_slice(&bytes)
        .map_err(|_| {
            AppError::new(
                "UNSUPPORTED_FORMAT",
                "Invalid response format from Steam Storefront.",
                false,
            )
        })?;

    let wrapper = match map.into_iter().next() {
        Some((_, w)) => w,
        None => return Ok(None),
    };

    if !wrapper.success || wrapper.data.is_none() {
        return Ok(None);
    }

    let data = wrapper.data.unwrap();
    let now = chrono_now();

    let genres = data
        .genres
        .unwrap_or_default()
        .into_iter()
        .map(|g| g.description)
        .collect();

    let artwork_url = data
        .header_image
        .clone()
        .or_else(|| data.capsule_image.clone());

    Ok(Some(CatalogGameDetail {
        app_id: app_id.to_string(),
        name: data.name,
        artwork_url,
        installed: false, // will be reconciled with local library index
        metadata_source: Some(SourceAttribution {
            provider_id: "steam-storefront".to_string(),
            fetched_at: now,
            freshness: "fresh".to_string(),
            documentation_url: Some("https://store.steampowered.com".to_string()),
        }),
        item_type: data.item_type.or(Some("game".to_string())),
        description: data.detailed_description,
        short_description: data.short_description,
        release_date: data.release_date.and_then(|r| r.date),
        website: data.website,
        header_image: data.header_image,
        capsule_image: data.capsule_image,
        genres,
        local_installations: Vec::new(),
        local_installation_derived: false,
    }))
}

fn chrono_now() -> String {
    // Standard ISO 8601 UTC timestamp format: YYYY-MM-DDTHH:MM:SSZ
    let now = std::time::SystemTime::now();
    let duration = now
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = duration.as_secs();

    // Compute calendar date and time from epoch seconds
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

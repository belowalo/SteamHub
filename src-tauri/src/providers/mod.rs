use crate::contracts::AppError;
use std::time::Duration;

pub const ALLOWED_HOSTS: &[&str] = &["store.steampowered.com", "api.steampowered.com"];
pub const MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024; // 4 MB safety limit
pub const MAX_OFFICIAL_RESPONSE_BYTES: usize = 16 * 1024 * 1024; // 16 MB limit for paginated app lists

pub fn create_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .connect_timeout(Duration::from_secs(6))
        .user_agent("SteamHub/0.1.0 (Windows; Desktop; +https://github.com/steamhub)")
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            // Only allow redirects if destination host is also allowlisted
            if attempt.previous().len() < 5 {
                if validate_url(attempt.url().as_str()).is_ok() {
                    attempt.follow()
                } else {
                    attempt.stop()
                }
            } else {
                attempt.stop()
            }
        }))
        .build()
        .expect("Valid reqwest HTTP client")
}

pub fn validate_url(url_str: &str) -> Result<reqwest::Url, AppError> {
    let url = reqwest::Url::parse(url_str)
        .map_err(|_| AppError::new("INVALID_INPUT", "Invalid service URL.", false))?;
    if url.scheme() != "https" {
        return Err(AppError::new(
            "UNTRUSTED_SOURCE",
            "Insecure HTTP protocol is not permitted.",
            false,
        ));
    }
    let host = url.host_str().unwrap_or("");
    if !ALLOWED_HOSTS.contains(&host)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return Err(AppError::new(
            "UNTRUSTED_SOURCE",
            "Requested host is not in the permitted provider allowlist.",
            false,
        ));
    }
    Ok(url)
}

pub async fn read_limited_response(
    mut response: reqwest::Response,
    limit: usize,
) -> Result<Vec<u8>, AppError> {
    let oversized = || {
        AppError::new(
            "UNSUPPORTED_FORMAT",
            "Provider response exceeded the safe size limit.",
            false,
        )
    };
    if response.content_length().is_some_and(|n| n > limit as u64) {
        return Err(oversized());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| AppError::new("IO_ERROR", "Could not read provider response.", true))?
    {
        if chunk.len() > limit.saturating_sub(body.len()) {
            return Err(oversized());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

pub mod game_data;
pub mod official;
pub mod storefront;

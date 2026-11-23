use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogSearchRequest {
    pub query: String,
    pub limit: Option<usize>,
    #[allow(dead_code)]
    pub cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceAttribution {
    pub provider_id: String,
    pub fetched_at: String,
    pub freshness: String, // "fresh" | "stale" | "unknown"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub documentation_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogGameSummary {
    pub app_id: String,
    pub name: Option<String>,
    pub artwork_url: Option<String>,
    pub installed: bool,
    pub metadata_source: Option<SourceAttribution>,
    pub item_type: Option<String>,
    pub last_modified_unix: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSearchResult {
    pub games: Vec<CatalogGameSummary>,
    pub next_cursor: Option<String>,
    pub origin: String, // "live" | "cache" | "local"
    pub stale: bool,
    pub provider_id: Option<String>,
    pub provider_status: String, // "ready" | "needs_configuration" | "offline" | "rate_limited" | "failed"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogGameDetail {
    pub app_id: String,
    pub name: Option<String>,
    pub artwork_url: Option<String>,
    pub installed: bool,
    pub metadata_source: Option<SourceAttribution>,
    pub item_type: Option<String>,
    pub description: Option<String>,
    pub short_description: Option<String>,
    pub release_date: Option<String>,
    pub website: Option<String>,
    pub header_image: Option<String>,
    pub capsule_image: Option<String>,
    pub genres: Vec<String>,
    pub local_installations: Vec<crate::contracts::library::LocalInstallation>,
    pub local_installation_derived: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogProviderStatus {
    pub id: String,
    pub display_name: String,
    pub kind: String,
    pub enabled: bool,
    pub documentation_url: Option<String>,
    pub capabilities: Vec<String>,
    pub status: String, // "ready" | "needs_configuration" | "offline" | "rate_limited" | "failed"
    pub last_sync_time: Option<String>,
    pub setup_needed: bool,
    pub last_redacted_error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogSetApiKeyRequest {
    pub api_key: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogSyncRequest {
    pub resume: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSyncResult {
    pub status: String,
    pub processed: usize,
    pub message: String,
}

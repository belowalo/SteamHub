use serde::{Deserialize, Serialize};

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LibraryScanRequest {
    pub root_paths: Option<Vec<String>>,
    pub force: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanDiagnostic {
    pub code: String,
    pub message: String,
    pub path: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryRootStatus {
    pub path: String,
    pub source: String,
    pub status: String,
    pub last_scanned_at: Option<String>,
    pub attempted_at: Option<String>,
    pub diagnostics: Vec<ScanDiagnostic>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalGameSummary {
    pub app_id: String,
    pub name: Option<String>,
    pub artwork_url: Option<String>,
    pub installed: bool,
    pub metadata_source: LocalSource,
    pub install_status: String,
    pub installation_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSource {
    pub provider_id: &'static str,
    pub fetched_at: String,
    pub freshness: &'static str,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalInstallation {
    pub id: i64,
    pub app_id: String,
    pub library_root: String,
    pub install_path: String,
    pub build_id: Option<String>,
    pub source_acf_path: String,
    pub last_seen_at: String,
    pub status: String,
    pub checked_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalGameDetail {
    #[serde(flatten)]
    pub summary: LocalGameSummary,
    pub description: Option<String>,
    pub release_date: Option<String>,
    pub installations: Vec<LocalInstallation>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySnapshot {
    pub games: Vec<LocalGameSummary>,
    pub roots: Vec<LibraryRootStatus>,
    pub last_scan_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryScanResult {
    pub snapshot: LibrarySnapshot,
    pub verified_installations: usize,
    pub observed_installations: usize,
    pub diagnostic_count: usize,
}

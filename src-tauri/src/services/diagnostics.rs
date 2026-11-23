use crate::{
    contracts::{ApiResult, HealthResult},
    storage::Database,
};
use serde::Serialize;
use std::{
    fs::OpenOptions,
    io::Write,
    path::Path,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticEvent {
    Startup,
    DatabaseReady,
    DatabaseInitializationFailed,
    HealthCheckFailed,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticEntry {
    timestamp_ms: u128,
    event: DiagnosticEvent,
    app_version: &'static str,
}

/// Redaction by allowlist: no arbitrary messages, paths, credentials, payloads,
/// or raw errors can enter diagnostics. Extend this schema deliberately.
pub struct Diagnostics {
    file: Mutex<std::fs::File>,
}

impl Diagnostics {
    pub fn open(path: &Path) -> std::io::Result<Self> {
        Ok(Self {
            file: Mutex::new(OpenOptions::new().create(true).append(true).open(path)?),
        })
    }

    pub fn record(&self, event: DiagnosticEvent) -> std::io::Result<()> {
        let entry = DiagnosticEntry {
            timestamp_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis(),
            event,
            app_version: env!("CARGO_PKG_VERSION"),
        };
        let mut file = self
            .file
            .lock()
            .map_err(|_| std::io::Error::other("Diagnostic log unavailable"))?;
        serde_json::to_writer(&mut *file, &entry).map_err(std::io::Error::other)?;
        file.write_all(b"\n")?;
        file.flush()
    }
}

pub fn health(database: &Database, diagnostics: &Diagnostics) -> ApiResult<HealthResult> {
    if !database.is_ready() {
        let _ = diagnostics.record(DiagnosticEvent::HealthCheckFailed);
        return ApiResult::internal(
            "The local database could not be verified. Restart SteamHub and try again.",
        );
    }
    ApiResult::success(HealthResult {
        api_version: 1,
        database_ready: true,
        app_version: env!("CARGO_PKG_VERSION"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logs_only_allowlisted_metadata_as_json_lines() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("private-user-token.log");
        let diagnostics = Diagnostics::open(&path).unwrap();
        diagnostics.record(DiagnosticEvent::Startup).unwrap();
        diagnostics.record(DiagnosticEvent::DatabaseReady).unwrap();
        let contents = std::fs::read_to_string(path).unwrap();
        assert!(!contents.contains("private-user-token"));
        let lines: Vec<serde_json::Value> = contents
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0]["event"], "startup");
        assert_eq!(lines[1]["event"], "database_ready");
        assert_eq!(lines[0].as_object().unwrap().len(), 3);
    }

    #[test]
    fn health_uses_the_versioned_envelope() {
        let dir = tempfile::tempdir().unwrap();
        let diagnostics = Diagnostics::open(&dir.path().join("test.log")).unwrap();
        let database = Database::open(Path::new(":memory:")).unwrap();
        let result = serde_json::to_value(health(&database, &diagnostics)).unwrap();
        assert_eq!(
            result,
            serde_json::json!({
                "ok": true,
                "data": { "apiVersion": 1, "databaseReady": true, "appVersion": env!("CARGO_PKG_VERSION") }
            })
        );
    }

    #[test]
    fn unavailable_database_returns_a_structured_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("broken.sqlite3");
        let diagnostics = Diagnostics::open(&dir.path().join("test.log")).unwrap();
        let database = Database::open(&path).unwrap();
        rusqlite::Connection::open(&path)
            .unwrap()
            .execute("DROP TABLE settings", [])
            .unwrap();
        let result = serde_json::to_value(health(&database, &diagnostics)).unwrap();
        assert_eq!(result["ok"], false);
        assert_eq!(result["error"]["code"], "INTERNAL");
        assert_eq!(result["error"]["retryable"], true);
        assert!(result.get("data").is_none());
    }
}

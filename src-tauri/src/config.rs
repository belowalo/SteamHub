use std::path::PathBuf;
use tauri::Manager;

/// Runtime paths come from Tauri's platform directories, never frontend input.
pub struct AppConfig {
    pub database_file: PathBuf,
    pub diagnostic_file: PathBuf,
}

impl AppConfig {
    pub fn load(app: &tauri::App) -> tauri::Result<Self> {
        // Explicit alternate profile for portable use and isolated desktop QA.
        if let Some(directory) = std::env::var_os("STEAMHUB_PROFILE_DIR") {
            let directory = PathBuf::from(directory);
            if !directory.is_absolute() {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "STEAMHUB_PROFILE_DIR must be absolute",
                )
                .into());
            }
            return Ok(Self {
                database_file: directory.join("steamhub.sqlite3"),
                diagnostic_file: directory.join("logs/steamhub.jsonl"),
            });
        }
        Ok(Self {
            database_file: app.path().app_data_dir()?.join("steamhub.sqlite3"),
            diagnostic_file: app.path().app_log_dir()?.join("foundation.jsonl"),
        })
    }
}

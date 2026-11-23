use crate::{contracts::AppError, services::workspace::*, storage::Database};
use rusqlite::{params, OptionalExtension};

fn db_error(_: rusqlite::Error) -> AppError {
    AppError::new(
        "IO_ERROR",
        "Could not read or update the workspace database.",
        true,
    )
}
impl Database {
    pub fn workspace_files(&self) -> Result<Vec<ManagedFile>, AppError> {
        let db = self
            .connection
            .lock()
            .map_err(|_| AppError::new("INTERNAL", "Database lock unavailable.", true))?;
        let mut stmt = db.prepare("SELECT id,name,extension,size,app_id,source,version,imported_at,warnings_json FROM workspace_files ORDER BY imported_at DESC, name").map_err(db_error)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(ManagedFile {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    extension: r.get(2)?,
                    size: r.get(3)?,
                    app_id: r.get(4)?,
                    source: r.get(5)?,
                    version: r.get(6)?,
                    imported_at: r.get(7)?,
                    warnings: serde_json::from_str(&r.get::<_, String>(8)?).unwrap_or_default(),
                })
            })
            .map_err(db_error)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(db_error)
    }
    pub fn workspace_insert(&self, f: &ManagedFile) -> Result<(), AppError> {
        self.connection
            .lock()
            .map_err(|_| AppError::new("INTERNAL", "Database lock unavailable.", true))?
            .execute(
                "INSERT INTO workspace_files VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                params![
                    f.id,
                    f.name,
                    f.extension,
                    f.size,
                    f.app_id,
                    f.source,
                    f.version,
                    f.imported_at,
                    serde_json::to_string(&f.warnings).unwrap_or_else(|_| "[]".into())
                ],
            )
            .map_err(db_error)?;
        Ok(())
    }
    pub fn workspace_delete(&self, id: &str) -> Result<(), AppError> {
        self.connection
            .lock()
            .map_err(|_| AppError::new("INTERNAL", "Database lock unavailable.", true))?
            .execute("DELETE FROM workspace_files WHERE id=?1", [id])
            .map_err(db_error)?;
        Ok(())
    }
    pub fn workspace_associate(
        &self,
        id: &str,
        app: Option<String>,
        source: &str,
        version: &str,
    ) -> Result<(), AppError> {
        let n = self
            .connection
            .lock()
            .map_err(|_| AppError::new("INTERNAL", "Database lock unavailable.", true))?
            .execute(
                "UPDATE workspace_files SET app_id=?2,source=?3,version=?4 WHERE id=?1",
                params![id, app, source, version],
            )
            .map_err(db_error)?;
        if n == 0 {
            return Err(AppError::new("NOT_FOUND", "File no longer exists.", false));
        }
        Ok(())
    }
    pub fn workspace_event(
        &self,
        kind: &str,
        status: &str,
        message: &str,
    ) -> Result<i64, AppError> {
        let db = self
            .connection
            .lock()
            .map_err(|_| AppError::new("INTERNAL", "Database lock unavailable.", true))?;
        db.execute(
            "INSERT INTO workspace_activity(kind,status,message,created_at) VALUES (?1,?2,?3,?4)",
            params![kind, status, message, now()],
        )
        .map_err(db_error)?;
        Ok(db.last_insert_rowid())
    }
    pub fn workspace_event_finish(
        &self,
        id: i64,
        status: &str,
        message: &str,
    ) -> Result<(), AppError> {
        self.connection
            .lock()
            .map_err(|_| AppError::new("INTERNAL", "Database lock unavailable.", true))?
            .execute(
                "UPDATE workspace_activity SET status=?2,message=?3 WHERE id=?1",
                params![id, status, message],
            )
            .map_err(db_error)?;
        Ok(())
    }
    pub fn workspace_events(&self) -> Result<Vec<WorkspaceEvent>, AppError> {
        let db = self
            .connection
            .lock()
            .map_err(|_| AppError::new("INTERNAL", "Database lock unavailable.", true))?;
        let mut s = db.prepare("SELECT id,kind,status,message,created_at FROM workspace_activity ORDER BY id DESC LIMIT 300").map_err(db_error)?;
        let rows = s
            .query_map([], |r| {
                Ok(WorkspaceEvent {
                    id: r.get(0)?,
                    kind: r.get(1)?,
                    status: r.get(2)?,
                    message: r.get(3)?,
                    created_at: r.get(4)?,
                })
            })
            .map_err(db_error)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(db_error)
    }
    pub fn workspace_recover(&self) -> Result<(), AppError> {
        self.connection.lock().map_err(|_| AppError::new("INTERNAL", "Database lock unavailable.", true))?.execute("UPDATE workspace_activity SET status='interrupted',message='Application closed before this operation finished. Completed file imports are preserved; retry the operation.' WHERE status='running'", []).map_err(db_error)?;
        Ok(())
    }
    pub fn workspace_settings(&self) -> Result<WorkspaceSettings, AppError> {
        let db = self
            .connection
            .lock()
            .map_err(|_| AppError::new("INTERNAL", "Database lock unavailable.", true))?;
        let text: Option<String> = db
            .query_row(
                "SELECT value_json FROM settings WHERE key='workspace.v1'",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(db_error)?;
        Ok(text
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default())
    }
    pub fn workspace_save_settings(&self, value: &WorkspaceSettings) -> Result<(), AppError> {
        self.connection.lock().map_err(|_| AppError::new("INTERNAL", "Database lock unavailable.", true))?.execute("INSERT INTO settings(key,value_json,updated_at) VALUES ('workspace.v1',?1,?2) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at", params![serde_json::to_string(value).unwrap_or_default(),now()]).map_err(db_error)?;
        Ok(())
    }
    pub fn workspace_notes(&self) -> Result<Vec<CompatibilityNote>, AppError> {
        let db = self
            .connection
            .lock()
            .map_err(|_| AppError::new("INTERNAL", "Database lock unavailable.", true))?;
        let mut s = db
            .prepare(
                "SELECT app_id,body,updated_at FROM compatibility_notes ORDER BY updated_at DESC",
            )
            .map_err(db_error)?;
        let rows = s
            .query_map([], |r| {
                Ok(CompatibilityNote {
                    app_id: r.get(0)?,
                    body: r.get(1)?,
                    updated_at: r.get(2)?,
                })
            })
            .map_err(db_error)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(db_error)
    }
    pub fn workspace_save_note(&self, app: &str, body: &str) -> Result<(), AppError> {
        let db = self
            .connection
            .lock()
            .map_err(|_| AppError::new("INTERNAL", "Database lock unavailable.", true))?;
        if body.trim().is_empty() {
            db.execute("DELETE FROM compatibility_notes WHERE app_id=?1", [app])
                .map_err(db_error)?;
        } else {
            db.execute("INSERT INTO compatibility_notes VALUES (?1,?2,?3) ON CONFLICT(app_id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at", params![app,body,now()]).map_err(db_error)?;
        }
        Ok(())
    }
}

//! App-owned configuration vault. Input is parsed as data and never executed.
use crate::{contracts::AppError, services::library::keyvalues, storage::Database};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

const MAX_FILE: u64 = 64 * 1024 * 1024;
const MAX_TOTAL: u64 = 256 * 1024 * 1024;
const MAX_ENTRIES: usize = 500;
pub fn now() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}
fn error(message: impl Into<String>) -> AppError {
    AppError::new("INVALID_INPUT", &message.into(), false)
}
fn io_error(e: impl std::fmt::Display) -> AppError {
    AppError::new("IO_ERROR", &format!("File operation failed: {e}"), true)
}
fn digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
fn valid_id(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}
pub fn app_id(value: &str) -> Result<Option<String>, AppError> {
    if value.trim().is_empty() {
        return Ok(None);
    }
    let n: u32 = value
        .trim()
        .parse()
        .map_err(|_| error("AppID must be a positive 32-bit decimal number."))?;
    if n == 0 {
        return Err(error("AppID must be greater than zero."));
    }
    Ok(Some(n.to_string()))
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManagedFile {
    pub id: String,
    pub name: String,
    pub extension: String,
    pub size: u64,
    pub app_id: Option<String>,
    pub source: String,
    pub version: String,
    pub imported_at: String,
    pub warnings: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEvent {
    pub id: i64,
    pub kind: String,
    pub status: String,
    pub message: String,
    pub created_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompatibilityNote {
    pub app_id: String,
    pub body: String,
    pub updated_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceSettings {
    pub theme: String,
    pub scan_on_start: bool,
    #[serde(default = "default_store_country")]
    pub store_country: String,
}
fn default_store_country() -> String {
    "US".into()
}
impl Default for WorkspaceSettings {
    fn default() -> Self {
        Self {
            theme: "dark".into(),
            scan_on_start: false,
            store_country: default_store_country(),
        }
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    pub lua_apps: Vec<String>,
    pub files: Vec<ManagedFile>,
    pub activity: Vec<WorkspaceEvent>,
    pub notes: Vec<CompatibilityNote>,
    pub settings: WorkspaceSettings,
    pub data_directory: String,
    pub log_file: String,
    pub busy: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OperationRequest {
    pub action: Operation,
    #[serde(default)]
    pub paths: Vec<String>,
    #[serde(default)]
    pub ids: Vec<String>,
}
#[derive(Deserialize, Debug)]
#[serde(rename_all = "snake_case")]
pub enum Operation {
    Import,
    Restore,
    Backup,
    Export,
    Delete,
    Verify,
    Report,
}
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationResult {
    pub processed: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
    pub output: Option<String>,
    pub cancelled: bool,
}
impl OperationResult {
    fn message(&self) -> String {
        format!(
            "{} processed, {} duplicates skipped, {} errors.{}{}",
            self.processed,
            self.skipped,
            self.errors.len(),
            if self.cancelled {
                " Cancelled; completed items were preserved."
            } else {
                ""
            },
            self.output
                .as_ref()
                .map(|p| format!(" Saved: {p}"))
                .unwrap_or_default()
        )
    }
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackupIndex {
    format: u32,
    files: Vec<ManagedFile>,
    notes: Vec<CompatibilityNote>,
    settings: WorkspaceSettings,
}

pub struct WorkspaceService {
    pub directory: PathBuf,
    pub log_file: PathBuf,
    pub lock: Mutex<()>,
    pub cancel: AtomicBool,
    pub busy: AtomicBool,
}
impl WorkspaceService {
    pub fn new(directory: PathBuf, log_file: PathBuf) -> std::io::Result<Self> {
        fs::create_dir_all(directory.join("vault"))?;
        Ok(Self {
            directory,
            log_file,
            lock: Mutex::new(()),
            cancel: AtomicBool::new(false),
            busy: AtomicBool::new(false),
        })
    }
    pub fn snapshot(&self, db: &Database) -> Result<WorkspaceSnapshot, AppError> {
        Ok(WorkspaceSnapshot {
            lua_apps: super::lua_tracking::apps(&self.directory, db)?,
            files: db.workspace_files()?,
            activity: db.workspace_events()?,
            notes: db.workspace_notes()?,
            settings: db.workspace_settings()?,
            data_directory: self.directory.display().to_string(),
            log_file: self.log_file.display().to_string(),
            busy: self.busy.load(Ordering::SeqCst),
        })
    }
    fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::SeqCst)
    }
    fn stored(&self, record: &ManagedFile) -> Result<PathBuf, AppError> {
        if !valid_id(&record.id)
            || !["lua", "acf", "vdf", "manifest"].contains(&record.extension.as_str())
        {
            return Err(error("Invalid vault record."));
        }
        let path = self
            .directory
            .join("vault")
            .join(format!("{}.{}", record.id, record.extension));
        let metadata = fs::symlink_metadata(&path).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::new("NOT_FOUND", "Managed copy is missing.", false)
            } else {
                io_error(e)
            }
        })?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err(error("Vault entry is not a regular file."));
        }
        let base = self
            .directory
            .join("vault")
            .canonicalize()
            .map_err(io_error)?;
        let actual = path.canonicalize().map_err(io_error)?;
        if actual.parent() != Some(base.as_path()) {
            return Err(error("Vault path escapes its storage directory."));
        }
        Ok(actual)
    }
    fn read_verified(&self, record: &ManagedFile) -> Result<Vec<u8>, AppError> {
        let bytes = read_bounded(&self.stored(record)?, MAX_FILE)?;
        if bytes.len() as u64 != record.size || digest(&bytes) != record.id {
            return Err(AppError::new(
                "INTEGRITY_FAILURE",
                &format!(
                    "{} has changed or is damaged. Export/backup refused.",
                    record.name
                ),
                false,
            ));
        }
        Ok(bytes)
    }
    pub fn preview(&self, record: &ManagedFile) -> Result<String, AppError> {
        let bytes = self.read_verified(record)?;
        if record.extension == "manifest" {
            return Ok(format!("Opaque binary manifest\n{} bytes\nSHA-256 {}\nStructural authenticity and signatures are unverified.",record.size,record.id));
        }
        let text = std::str::from_utf8(&bytes).map_err(|_| error("File is not UTF-8 text."))?;
        let mut end = text.len().min(256 * 1024);
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        Ok(format!(
            "{}{}",
            &text[..end],
            if end < text.len() {
                "\n[Preview truncated at 256 KiB]"
            } else {
                ""
            }
        ))
    }
    pub fn create(
        &self,
        db: &Database,
        name: &str,
        text: &str,
        app: &str,
        source: &str,
        version: &str,
    ) -> Result<bool, AppError> {
        let _guard = self.lock.try_lock().map_err(|_| {
            AppError::new(
                "CONFLICT",
                "Wait for the current workspace operation.",
                true,
            )
        })?;
        if source.len() > 1024 || version.len() > 128 {
            return Err(error("Source or version is too long."));
        }
        let associated = app_id(app)?;
        let added = self.import_bytes(db, name, text.as_bytes(), None)?;
        if added {
            db.workspace_associate(&digest(text.as_bytes()), associated, source, version)?;
        }
        db.workspace_event(
            "save_configuration",
            "completed",
            if added {
                "Created a validated configuration version."
            } else {
                "Identical content already exists; existing metadata preserved."
            },
        )?;
        Ok(added)
    }
    pub fn import_bytes(
        &self,
        db: &Database,
        name: &str,
        bytes: &[u8],
        restored: Option<&ManagedFile>,
    ) -> Result<bool, AppError> {
        let (ext, mut warnings, detected) = inspect(name, bytes)?;
        let id = digest(bytes);
        if let Some(original) = restored {
            if original.id != id || original.size != bytes.len() as u64 || original.extension != ext
            {
                return Err(error(
                    "Backup hash, size or file type does not match metadata.",
                ));
            }
        }
        if let Some(existing) = db.workspace_files()?.iter().find(|r| r.id == id) {
            self.read_verified(existing)?;
            return Ok(false);
        }
        let record = ManagedFile {
            id: id.clone(),
            name: name.into(),
            extension: ext.clone(),
            size: bytes.len() as u64,
            app_id: if let Some(r) = restored {
                app_id(r.app_id.as_deref().unwrap_or(""))?
            } else {
                detected
            },
            source: restored
                .map(|r| r.source.chars().take(1024).collect())
                .unwrap_or_else(|| "Local import".into()),
            version: restored
                .map(|r| r.version.chars().take(128).collect())
                .unwrap_or_else(|| "Imported".into()),
            imported_at: restored.map(|r| r.imported_at.clone()).unwrap_or_else(now),
            warnings: {
                warnings.push(
                    "Stored as data; not applied to Steam and not proof of ownership.".into(),
                );
                warnings
            },
        };
        let target = self.directory.join("vault").join(format!("{id}.{ext}"));
        // Publish only complete bytes. A crash may leave an unindexed file, never an indexed partial write.
        let temp = self.directory.join("vault").join(format!("{id}.partial"));
        if temp.exists() {
            fs::remove_file(&temp).map_err(io_error)?;
        }
        let mut f = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(io_error)?;
        if let Err(e) = f.write_all(bytes).and_then(|_| f.sync_all()) {
            let _ = fs::remove_file(&temp);
            return Err(io_error(e));
        }
        drop(f);
        if target.exists() {
            let metadata = fs::symlink_metadata(&target).map_err(io_error)?;
            if !metadata.is_file() || metadata.file_type().is_symlink() {
                let _ = fs::remove_file(&temp);
                return Err(error("Existing vault target is not a regular file."));
            }
            if digest(&read_bounded(&target, MAX_FILE)?) != id {
                let _ = fs::remove_file(&temp);
                return Err(error("Unindexed vault file has an unexpected hash."));
            }
            fs::remove_file(&temp).map_err(io_error)?;
        } else {
            fs::rename(&temp, &target).map_err(io_error)?;
        }
        db.workspace_insert(&record)?;
        Ok(true)
    }
    fn import_archive(
        &self,
        db: &Database,
        path: &Path,
        result: &mut OperationResult,
        restore: bool,
    ) -> Result<(), AppError> {
        let file = File::open(path).map_err(io_error)?;
        if file.metadata().map_err(io_error)?.len() > MAX_TOTAL {
            return Err(error("ZIP exceeds 256 MiB."));
        }
        let mut archive = ZipArchive::new(file).map_err(io_error)?;
        if archive.len() > MAX_ENTRIES + 1 {
            return Err(error("ZIP has more than 500 file entries."));
        }
        let mut total = 0_u64;
        let mut names = HashSet::new();
        for i in 0..archive.len() {
            let entry = archive.by_index(i).map_err(io_error)?;
            if entry.enclosed_name().is_none()
                || entry.name().contains(['\\', ':'])
                || entry.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000)
            {
                return Err(error("ZIP contains an unsafe path or symbolic link."));
            }
            if !names.insert(entry.name().to_owned()) {
                return Err(error("ZIP contains duplicate entry names."));
            }
            total = total
                .checked_add(entry.size())
                .ok_or_else(|| error("ZIP size overflow."))?;
            if entry.size() > MAX_FILE || total > MAX_TOTAL {
                return Err(error(
                    "ZIP exceeds file or expanded size limits (64 / 256 MiB).",
                ));
            }
        }
        let index = match archive.by_name("steamhub-backup.json") {
            Ok(mut e) => {
                let mut bytes = Vec::new();
                (&mut e)
                    .take(2 * 1024 * 1024 + 1)
                    .read_to_end(&mut bytes)
                    .map_err(io_error)?;
                if bytes.len() > 2 * 1024 * 1024 {
                    return Err(error("Backup index too large."));
                }
                Some(
                    serde_json::from_slice::<BackupIndex>(&bytes)
                        .map_err(|_| error("Invalid SteamHub backup index."))?,
                )
            }
            Err(zip::result::ZipError::FileNotFound) => None,
            Err(e) => return Err(io_error(e)),
        };
        if restore && index.is_none() {
            return Err(error(
                "Choose a SteamHub backup ZIP. Use Import for ordinary ZIP files.",
            ));
        }
        if let Some(index) = &index {
            if index.format != 1
                || index.files.len() > MAX_ENTRIES
                || index.notes.len() > MAX_ENTRIES
            {
                return Err(error("Unsupported or oversized backup index."));
            }
            validate_settings(&index.settings)?;
            let mut seen = HashSet::new();
            // Validate the complete backup before importing its first file.
            for record in &index.files {
                if !valid_id(&record.id) || !seen.insert(&record.id) {
                    return Err(error("Invalid or duplicate backup file ID."));
                }
                let entry_name = format!("files/{}.{}", record.id, record.extension);
                let mut entry = archive.by_name(&entry_name).map_err(io_error)?;
                let mut bytes = Vec::new();
                (&mut entry)
                    .take(MAX_FILE + 1)
                    .read_to_end(&mut bytes)
                    .map_err(io_error)?;
                let (ext, _, _) = inspect(&record.name, &bytes)?;
                if digest(&bytes) != record.id
                    || bytes.len() as u64 != record.size
                    || ext != record.extension
                {
                    return Err(error("Backup integrity verification failed."));
                }
                app_id(record.app_id.as_deref().unwrap_or(""))?;
            }
            for note in &index.notes {
                if app_id(&note.app_id)?.is_none() || note.body.len() > 32768 {
                    return Err(error("Invalid backup compatibility note."));
                }
            }
        }
        let count = index
            .as_ref()
            .map(|i| i.files.len())
            .unwrap_or(archive.len());
        for i in 0..count {
            if self.cancelled() {
                result.cancelled = true;
                break;
            }
            let record = index.as_ref().map(|idx| &idx.files[i]);
            let mut entry = if let Some(r) = record {
                archive.by_name(&format!("files/{}.{}", r.id, r.extension))
            } else {
                archive.by_index(i)
            }
            .map_err(io_error)?;
            if entry.is_dir() {
                continue;
            }
            let name = record
                .map(|r| r.name.clone())
                .unwrap_or_else(|| entry.name().rsplit('/').next().unwrap_or("").to_string());
            if !supported_name(&name) {
                result
                    .errors
                    .push(format!("{name}: unsupported file type."));
                continue;
            }
            let mut bytes = Vec::new();
            (&mut entry)
                .take(MAX_FILE + 1)
                .read_to_end(&mut bytes)
                .map_err(io_error)?;
            match self.import_bytes(db, &name, &bytes, record) {
                Ok(true) => result.processed += 1,
                Ok(false) => result.skipped += 1,
                Err(e) => result.errors.push(format!("{name}: {}", e.message)),
            }
        }
        if restore && !result.cancelled && result.errors.is_empty() {
            if let Some(index) = index {
                // Restores merge files and notes, preserving unrelated existing data.
                for note in index.notes {
                    db.workspace_save_note(&note.app_id, &note.body)?;
                }
                db.workspace_save_settings(&index.settings)?;
            }
        }
        Ok(())
    }
    fn backup(
        &self,
        db: &Database,
        path: &Path,
        result: &mut OperationResult,
    ) -> Result<(), AppError> {
        let files = db.workspace_files()?;
        if files.len() > MAX_ENTRIES {
            return Err(error("Backup supports up to 500 files."));
        }
        if files.iter().map(|r| r.size).sum::<u64>() > MAX_TOTAL {
            return Err(error("Backup exceeds the 256 MiB restore limit."));
        }
        let index = BackupIndex {
            format: 1,
            files: files.clone(),
            notes: db.workspace_notes()?,
            settings: db.workspace_settings()?,
        };
        let index_bytes = serde_json::to_vec_pretty(&index).map_err(io_error)?;
        if index.notes.len() > MAX_ENTRIES
            || index_bytes.len() > 2 * 1024 * 1024
            || files.iter().map(|r| r.size).sum::<u64>() + index_bytes.len() as u64 > MAX_TOTAL
        {
            return Err(error("Backup metadata or total size exceeds restore limits. Export files in smaller groups."));
        }
        let mut zip = ZipWriter::new(
            OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path)
                .map_err(io_error)?,
        );
        let opts =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        let outcome = (|| {
            zip.start_file("steamhub-backup.json", opts)
                .map_err(io_error)?;
            zip.write_all(&index_bytes).map_err(io_error)?;
            for record in files {
                if self.cancelled() {
                    return Err(AppError::new("CANCELLED", "Backup cancelled.", false));
                }
                let bytes = self.read_verified(&record)?;
                zip.start_file(format!("files/{}.{}", record.id, record.extension), opts)
                    .map_err(io_error)?;
                zip.write_all(&bytes).map_err(io_error)?;
                result.processed += 1;
            }
            zip.finish().map_err(io_error)?.sync_all().map_err(io_error)
        })();
        if outcome.is_err() {
            let _ = fs::remove_file(path);
        }
        outcome?;
        result.output = Some(path.display().to_string());
        Ok(())
    }
    pub fn operate(
        &self,
        db: &Database,
        mut req: OperationRequest,
    ) -> Result<OperationResult, AppError> {
        let _guard = self.lock.try_lock().map_err(|_| {
            AppError::new(
                "CONFLICT",
                "A workspace operation is already running.",
                true,
            )
        })?;
        self.cancel.store(false, Ordering::SeqCst);
        self.busy.store(true, Ordering::SeqCst);
        struct Busy<'a>(&'a AtomicBool);
        impl Drop for Busy<'_> {
            fn drop(&mut self) {
                self.0.store(false, Ordering::SeqCst);
            }
        }
        let _busy = Busy(&self.busy);
        if req.paths.len() > 100 || req.ids.len() > MAX_ENTRIES {
            return Err(error("Too many requested files."));
        }
        let kind = format!("{:?}", req.action).to_lowercase();
        let job = db.workspace_event(&kind, "running", "Working…")?;
        let outcome = (|| {
            let mut result = OperationResult::default();
            match req.action {
                Operation::Import | Operation::Restore => {
                    if req.paths.is_empty() {
                        let paths = if matches!(req.action, Operation::Restore) {
                            rfd::FileDialog::new()
                                .set_title("Restore SteamHub backup")
                                .add_filter("SteamHub backup", &["zip"])
                                .pick_file()
                                .map(|p| vec![p])
                        } else {
                            rfd::FileDialog::new()
                                .set_title("Import configurations")
                                .add_filter(
                                    "Supported configurations",
                                    &["lua", "manifest", "acf", "vdf", "zip"],
                                )
                                .pick_files()
                        };
                        let Some(paths) = paths else {
                            result.cancelled = true;
                            return Ok(result);
                        };
                        req.paths = paths.iter().map(|p| p.display().to_string()).collect();
                    }
                    for path in req.paths {
                        if self.cancelled() {
                            result.cancelled = true;
                            break;
                        }
                        let path = Path::new(&path);
                        let one = if path
                            .extension()
                            .is_some_and(|e| e.eq_ignore_ascii_case("zip"))
                        {
                            self.import_archive(
                                db,
                                path,
                                &mut result,
                                matches!(req.action, Operation::Restore),
                            )
                        } else if matches!(req.action, Operation::Restore) {
                            Err(error("Restore requires a ZIP backup."))
                        } else {
                            read_bounded(path, MAX_FILE)
                                .and_then(|bytes| {
                                    self.import_bytes(
                                        db,
                                        path.file_name().and_then(|n| n.to_str()).unwrap_or(""),
                                        &bytes,
                                        None,
                                    )
                                })
                                .map(|added| {
                                    if added {
                                        result.processed += 1
                                    } else {
                                        result.skipped += 1
                                    }
                                })
                        };
                        if let Err(e) = one {
                            result
                                .errors
                                .push(format!("{}: {}", path.display(), e.message));
                        }
                    }
                }
                Operation::Backup => {
                    let Some(path) = rfd::FileDialog::new()
                        .set_title("Save workspace backup (choose a new filename)")
                        .set_file_name(format!("SteamHub-{}.zip", now()))
                        .add_filter("ZIP archive", &["zip"])
                        .save_file()
                    else {
                        result.cancelled = true;
                        return Ok(result);
                    };
                    self.backup(db, &path, &mut result)?;
                }
                Operation::Report => {
                    let Some(path) = rfd::FileDialog::new()
                        .set_file_name(format!("SteamHub-diagnostics-{}.json", now()))
                        .add_filter("JSON report", &["json"])
                        .save_file()
                    else {
                        result.cancelled = true;
                        return Ok(result);
                    };
                    let report = serde_json::json!({"version":env!("CARGO_PKG_VERSION"),"databaseReady":db.is_ready(),"workspace":self.snapshot(db)?,"library":db.library_snapshot()?});
                    write_new(
                        &path,
                        &serde_json::to_vec_pretty(&report).map_err(io_error)?,
                    )?;
                    result.output = Some(path.display().to_string());
                    result.processed = 1;
                }
                Operation::Export | Operation::Delete | Operation::Verify => {
                    let records = db.workspace_files()?;
                    if req
                        .ids
                        .iter()
                        .any(|id| !records.iter().any(|r| &r.id == id))
                    {
                        return Err(error("Selected file no longer exists."));
                    }
                    if !matches!(req.action, Operation::Verify) && req.ids.is_empty() {
                        return Err(error("Select at least one file."));
                    }
                    let directory = if matches!(req.action, Operation::Export) {
                        let Some(p) = rfd::FileDialog::new()
                            .set_title("Export copies to folder")
                            .pick_folder()
                        else {
                            result.cancelled = true;
                            return Ok(result);
                        };
                        Some(p)
                    } else {
                        None
                    };
                    for record in records
                        .into_iter()
                        .filter(|r| req.ids.is_empty() || req.ids.contains(&r.id))
                    {
                        if self.cancelled() {
                            result.cancelled = true;
                            break;
                        }
                        let one = match req.action {
                            Operation::Verify => self.read_verified(&record).map(|_| ()),
                            Operation::Export => self.read_verified(&record).and_then(|bytes| {
                                write_new(
                                    &directory
                                        .as_ref()
                                        .expect("export directory")
                                        .join(safe_name(&record.name)?),
                                    &bytes,
                                )
                            }),
                            Operation::Delete => {
                                // Move out of the indexed location before committing deletion; restore on DB failure.
                                let path = self.stored(&record);
                                match path {
                                    Ok(p) => {
                                        let tomb = self
                                            .directory
                                            .join("vault")
                                            .join(format!("{}.deleted", record.id));
                                        fs::rename(&p, &tomb).map_err(io_error).and_then(|_| {
                                            if let Err(e) = db.workspace_delete(&record.id) {
                                                let _ = fs::rename(&tomb, &p);
                                                return Err(e);
                                            }
                                            fs::remove_file(&tomb).map_err(io_error)
                                        })
                                    }
                                    Err(e) if e.code == "NOT_FOUND" => {
                                        db.workspace_delete(&record.id)
                                    }
                                    Err(e) => Err(e),
                                }
                            }
                            _ => unreachable!(),
                        };
                        match one {
                            Ok(()) => result.processed += 1,
                            Err(e) => result
                                .errors
                                .push(format!("{}: {}", record.name, e.message)),
                        }
                    }
                    result.output = directory.map(|p| p.display().to_string());
                }
            }
            Ok(result)
        })();
        match &outcome {
            Ok(result) => db.workspace_event_finish(
                job,
                if result.cancelled {
                    "cancelled"
                } else if result.errors.is_empty() {
                    "completed"
                } else {
                    "completed_with_errors"
                },
                &result.message(),
            )?,
            Err(e) => db.workspace_event_finish(
                job,
                if e.code == "CANCELLED" {
                    "cancelled"
                } else {
                    "failed"
                },
                &e.message,
            )?,
        }
        outcome
    }
}

fn safe_name(name: &str) -> Result<&str, AppError> {
    if name.is_empty()
        || name.len() > 240
        || name.contains(['/', '\\', ':', '\0'])
        || name.ends_with(['.', ' '])
        || name.chars().any(|c| c.is_control())
    {
        return Err(error("Invalid filename."));
    }
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ]
    .contains(&stem.as_str())
    {
        return Err(error("Reserved Windows filename."));
    }
    Ok(name)
}
fn supported_name(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| {
            ["lua", "acf", "vdf", "manifest"].contains(&e.to_ascii_lowercase().as_str())
        })
}
fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>, AppError> {
    let meta = fs::metadata(path).map_err(io_error)?;
    if !meta.is_file() || meta.len() == 0 || meta.len() > limit {
        return Err(error(
            "Input must be a nonempty regular file within the size limit.",
        ));
    }
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(io_error)?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(io_error)?;
    if bytes.is_empty() || bytes.len() as u64 > limit {
        return Err(error("File exceeds size limit or changed during reading."));
    }
    Ok(bytes)
}
fn write_new(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(io_error)?;
    if let Err(e) = file.write_all(bytes).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(path);
        return Err(io_error(e));
    }
    Ok(())
}
pub(crate) fn inspect(
    name: &str,
    bytes: &[u8],
) -> Result<(String, Vec<String>, Option<String>), AppError> {
    safe_name(name)?;
    if !supported_name(name) {
        return Err(error("Supported files: .lua, .acf, .vdf and .manifest."));
    }
    if bytes.is_empty() || bytes.len() as u64 > MAX_FILE {
        return Err(error("Empty or oversized input (64 MiB maximum)."));
    }
    let ext = Path::new(name)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let mut warnings = Vec::new();
    let mut detected = Path::new(name)
        .file_stem()
        .and_then(|s| s.to_str())
        .and_then(|s| {
            s.strip_prefix("appmanifest_")
                .unwrap_or(s)
                .parse::<u32>()
                .ok()
        })
        .filter(|n| *n > 0)
        .map(|n| n.to_string());
    match ext.as_str() {
        "lua" => {
            if bytes.len() > 1024 * 1024 {
                return Err(error("Lua inspection limit is 1 MiB."));
            }
            let text = std::str::from_utf8(bytes).map_err(|_| error("Lua must be UTF-8 text."))?;
            if text.contains('\0') {
                return Err(error("Lua contains binary NUL bytes."));
            }
            // Conservative pre-parser nesting and line limits bound work on untrusted inputs.
            let mut depth = 0usize;
            for c in text.chars() {
                if "([{ ".contains(c) && c != ' ' {
                    depth += 1;
                    if depth > 128 {
                        return Err(error("Lua exceeds the conservative nesting limit."));
                    }
                } else if ")] }".contains(c) && c != ' ' {
                    depth = depth.saturating_sub(1);
                }
            }
            if text.lines().any(|l| l.len() > 32768) {
                return Err(error("Lua contains an oversized line."));
            }
            let keywords = text
                .split(|c: char| !c.is_ascii_alphanumeric() && c != '_')
                .filter(|word| ["function", "if", "do", "repeat", "elseif"].contains(word))
                .count();
            if keywords > 128
                || text
                    .chars()
                    .filter(|c| "+-*/%^=<>.,;(){}[]".contains(*c))
                    .count()
                    > 8192
            {
                return Err(error(
                    "Lua exceeds the conservative parser complexity limit.",
                ));
            }
            full_moon::parse(text.trim_start_matches('\u{feff}'))
                .map_err(|_| error("Lua syntax validation failed (supported syntax: Lua 5.1)."))?;
            let lower = text.to_ascii_lowercase();
            for api in [
                "os.",
                "io.",
                "loadstring",
                "loadfile",
                "dofile",
                "package.",
                "require",
                "ffi.",
                "debug.",
            ] {
                if lower.contains(api) {
                    warnings.push(format!("Static warning: {api} API reference. Review before using in an external tool."));
                }
            }
            warnings.push("Lua 5.1 syntax checked without executing code. Static inspection cannot prove safety.".into());
        }
        "acf" | "vdf" => {
            if bytes.len() > 8 * 1024 * 1024 {
                return Err(error("KeyValues inspection limit is 8 MiB."));
            }
            let text =
                std::str::from_utf8(bytes).map_err(|_| error("KeyValues must be UTF-8 text."))?;
            let pairs =
                keyvalues::parse(text).map_err(|e| error(format!("Invalid KeyValues: {e}")))?;
            if ext == "acf" {
                let state = keyvalues::field(&pairs, "AppState")
                    .map_err(error)?
                    .ok_or_else(|| error("ACF needs an AppState object."))?
                    .object()
                    .map_err(error)?;
                let id = keyvalues::required(state, "appid").map_err(error)?;
                detected = app_id(id)?;
            }
        }
        "manifest" => {
            warnings.push("Opaque depot manifest: size and SHA-256 checked; binary structure, signature, authenticity and entitlement are unverified.".into());
            detected = None;
        }
        _ => unreachable!(),
    }
    Ok((ext, warnings, detected))
}
pub fn validate_settings(s: &WorkspaceSettings) -> Result<(), AppError> {
    if ![
        "US", "CA", "GB", "DE", "FR", "AU", "NZ", "JP", "KR", "BR", "IN", "PL", "MX",
    ]
    .contains(&s.store_country.as_str())
    {
        return Err(error("Choose a supported Steam store country."));
    }
    if !["dark", "light"].contains(&s.theme.as_str()) {
        Err(error("Choose dark or light appearance."))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests;

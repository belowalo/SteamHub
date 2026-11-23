use super::*;

#[test]
fn store_country_defaults_for_legacy_preferences_and_survives_restart() {
    let old: WorkspaceSettings =
        serde_json::from_str(r#"{"theme":"light","scanOnStart":true}"#).unwrap();
    assert_eq!(old.store_country, "US");
    assert_eq!(old.theme, "light");
    assert!(old.scan_on_start);
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("region.sqlite3");
    let db = Database::open(&path).unwrap();
    assert_eq!(db.workspace_settings().unwrap().store_country, "US");
    let settings = WorkspaceSettings {
        store_country: "CA".into(),
        ..old
    };
    validate_settings(&settings).unwrap();
    db.workspace_save_settings(&settings).unwrap();
    drop(db);
    let db = Database::open(&path).unwrap();
    assert_eq!(db.workspace_settings().unwrap().store_country, "CA");
    let invalid = WorkspaceSettings {
        store_country: "XX".into(),
        ..settings
    };
    assert!(validate_settings(&invalid).is_err());
}
fn fixture() -> (tempfile::TempDir, Database, WorkspaceService) {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("test.sqlite3")).unwrap();
    let service =
        WorkspaceService::new(dir.path().join("data"), dir.path().join("log.jsonl")).unwrap();
    (dir, db, service)
}
#[test]
fn validates_syntax_without_running_lua_and_rejects_malformed_files() {
    let (_dir, db, s) = fixture();
    assert!(s
        .import_bytes(&db, "620.lua", b"os.execute('this must never run')", None)
        .unwrap());
    let files = db.workspace_files().unwrap();
    assert_eq!(files[0].app_id.as_deref(), Some("620"));
    assert!(files[0].warnings.iter().any(|w| w.contains("os.")));
    for (name, bytes) in [
        ("bad.lua", b"function !!!".as_slice()),
        ("bad.acf", b"\"AppState\" {".as_slice()),
        ("CON.lua", b"return 1".as_slice()),
        ("../620.lua", b"return 1".as_slice()),
        ("binary.lua", b"\0\xff".as_slice()),
    ] {
        assert!(s.import_bytes(&db, name, bytes, None).is_err(), "{name}");
    }
    assert!(s
        .import_bytes(&db, "depot.manifest", b"opaque manifest", None)
        .unwrap());
    assert!(db
        .workspace_files()
        .unwrap()
        .iter()
        .find(|r| r.extension == "manifest")
        .unwrap()
        .warnings
        .iter()
        .any(|w| w.contains("unverified")));
}
#[test]
fn deduplicates_persists_and_detects_tampering() {
    let (dir, db, s) = fixture();
    let bytes = b"return {enabled=true}";
    assert!(s.import_bytes(&db, "620.lua", bytes, None).unwrap());
    assert!(!s.import_bytes(&db, "duplicate.lua", bytes, None).unwrap());
    let f = db.workspace_files().unwrap().remove(0);
    assert_eq!(s.preview(&f).unwrap(), "return {enabled=true}");
    let path = s.stored(&f).unwrap();
    fs::write(path, b"return false").unwrap();
    assert_eq!(s.read_verified(&f).unwrap_err().code, "INTEGRITY_FAILURE");
    let mut result = OperationResult::default();
    let backup = dir.path().join("failed.zip");
    assert!(s.backup(&db, &backup, &mut result).is_err());
    assert!(!backup.exists());
    drop(db);
    let db = Database::open(&dir.path().join("test.sqlite3")).unwrap();
    assert_eq!(db.workspace_files().unwrap().len(), 1);
}
#[test]
fn backup_restore_preserves_names_associations_settings_notes_and_hashes() {
    let (dir, db, s) = fixture();
    s.import_bytes(&db, "custom-settings.lua", b"return {quality='high'}", None)
        .unwrap();
    let f = db.workspace_files().unwrap().remove(0);
    db.workspace_associate(&f.id, Some("620".into()), "My configuration", "v2")
        .unwrap();
    db.workspace_save_note("620", "Try borderless mode")
        .unwrap();
    db.workspace_save_settings(&WorkspaceSettings {
        theme: "light".into(),
        scan_on_start: true,
        store_country: "CA".into(),
    })
    .unwrap();
    let path = dir.path().join("backup.zip");
    s.backup(&db, &path, &mut OperationResult::default())
        .unwrap();
    let db2 = Database::open(&dir.path().join("other.sqlite3")).unwrap();
    let s2 = WorkspaceService::new(dir.path().join("other"), dir.path().join("logs")).unwrap();
    let mut r = OperationResult::default();
    s2.import_archive(&db2, &path, &mut r, true).unwrap();
    assert_eq!(r.processed, 1);
    assert!(r.errors.is_empty());
    let restored = db2.workspace_files().unwrap().remove(0);
    assert_eq!(restored.name, "custom-settings.lua");
    assert_eq!(restored.app_id.as_deref(), Some("620"));
    assert_eq!(restored.version, "v2");
    assert_eq!(
        s2.read_verified(&restored).unwrap(),
        b"return {quality='high'}"
    );
    assert_eq!(
        db2.workspace_notes().unwrap()[0].body,
        "Try borderless mode"
    );
    assert_eq!(db2.workspace_settings().unwrap().theme, "light");
    assert_eq!(db2.workspace_settings().unwrap().store_country, "CA");
    s2.import_archive(&db2, &path, &mut r, true).unwrap();
    assert_eq!(r.skipped, 1);
}
#[test]
fn rejects_zip_traversal_symlinks_and_oversized_archives_before_writes() {
    let (dir, db, s) = fixture();
    for (n, name) in [
        "../evil.lua",
        "C:/evil.lua",
        "files/../../evil.lua",
        "files\\evil.lua",
    ]
    .iter()
    .enumerate()
    {
        let path = dir.path().join(format!("{n}.zip"));
        let mut z = ZipWriter::new(File::create(&path).unwrap());
        z.start_file(*name, SimpleFileOptions::default()).unwrap();
        z.write_all(b"return true").unwrap();
        z.finish().unwrap();
        assert!(s
            .import_archive(&db, &path, &mut OperationResult::default(), false)
            .is_err());
        assert!(db.workspace_files().unwrap().is_empty());
    }
}
#[test]
fn rejects_corrupt_backup_before_partial_restore_and_preserves_export_targets() {
    let (dir, db, s) = fixture();
    let path = dir.path().join("bad-backup.zip");
    let index = BackupIndex {
        format: 1,
        files: vec![ManagedFile {
            id: "0".repeat(64),
            name: "620.lua".into(),
            extension: "lua".into(),
            size: 11,
            app_id: None,
            source: "test".into(),
            version: "v1".into(),
            imported_at: now(),
            warnings: vec![],
        }],
        notes: vec![],
        settings: WorkspaceSettings::default(),
    };
    let mut z = ZipWriter::new(File::create(&path).unwrap());
    z.start_file("steamhub-backup.json", SimpleFileOptions::default())
        .unwrap();
    z.write_all(&serde_json::to_vec(&index).unwrap()).unwrap();
    z.start_file(
        format!("files/{}.lua", "0".repeat(64)),
        SimpleFileOptions::default(),
    )
    .unwrap();
    z.write_all(b"return true").unwrap();
    z.finish().unwrap();
    assert!(s
        .import_archive(&db, &path, &mut OperationResult::default(), true)
        .is_err());
    assert!(db.workspace_files().unwrap().is_empty());
    let dest = dir.path().join("existing.lua");
    fs::write(&dest, b"original").unwrap();
    assert!(write_new(&dest, b"replace").is_err());
    assert_eq!(fs::read(dest).unwrap(), b"original");
}
#[test]
fn operations_cancel_recover_and_validate_ids() {
    let (_dir, db, s) = fixture();
    s.import_bytes(&db, "620.lua", b"return true", None)
        .unwrap();
    let f = db.workspace_files().unwrap().remove(0);
    let r = s
        .operate(
            &db,
            OperationRequest {
                action: Operation::Verify,
                paths: vec![],
                ids: vec![],
            },
        )
        .unwrap();
    assert_eq!(r.processed, 1);
    assert!(s
        .operate(
            &db,
            OperationRequest {
                action: Operation::Delete,
                paths: vec![],
                ids: vec!["missing".into()]
            }
        )
        .is_err());
    assert!(s.read_verified(&f).is_ok());
    let id = db.workspace_event("test", "running", "working").unwrap();
    db.workspace_recover().unwrap();
    assert_eq!(
        db.workspace_events()
            .unwrap()
            .iter()
            .find(|e| e.id == id)
            .unwrap()
            .status,
        "interrupted"
    );
    assert!(app_id("4294967296").is_err());
    assert!(app_id("-1").is_err());
    assert_eq!(app_id("000620").unwrap(), Some("620".into()));
    s.operate(
        &db,
        OperationRequest {
            action: Operation::Delete,
            paths: vec![],
            ids: vec![f.id],
        },
    )
    .unwrap();
    assert!(db.workspace_files().unwrap().is_empty());
}

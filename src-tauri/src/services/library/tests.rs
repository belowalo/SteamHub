use super::*;

fn sandbox() -> tempfile::TempDir {
    let parent = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("test-results");
    fs::create_dir_all(&parent).unwrap();
    tempfile::tempdir_in(parent).unwrap()
}
fn root(parent: &Path, name: &str) -> PathBuf {
    let path = parent.join(name);
    fs::create_dir_all(path.join("steamapps/common")).unwrap();
    path
}
fn acf(root: &Path, id: &str, dir: &str) -> PathBuf {
    fs::create_dir_all(root.join("steamapps/common").join(dir)).unwrap();
    let path = root.join(format!("steamapps/appmanifest_{id}.acf"));
    fs::write(&path, format!("\"AppState\" {{ \"appid\" \"{id}\" \"name\" \"Fixture 日本語 {id}\" \"installdir\" \"{dir}\" \"buildid\" \"10001\" \"StateFlags\" \"4\" }}")).unwrap();
    path
}
fn request(root: &Path) -> LibraryScanRequest {
    LibraryScanRequest {
        root_paths: Some(vec![display(root)]),
        force: None,
    }
}
fn source_tree(path: &Path) -> Vec<(PathBuf, Vec<u8>, std::time::SystemTime)> {
    let mut result = Vec::new();
    for entry in fs::read_dir(path).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            result.extend(source_tree(&path));
        } else {
            result.push((
                path.clone(),
                fs::read(&path).unwrap(),
                fs::metadata(path).unwrap().modified().unwrap(),
            ));
        }
    }
    result.sort_by(|a, b| a.0.cmp(&b.0));
    result
}
#[test]
fn multi_root_unicode_duplicates_persistence_and_no_source_writes() {
    let sandbox = sandbox();
    let first = root(sandbox.path(), "First library 日本語");
    let second = root(sandbox.path(), "Second library");
    acf(&first, "123", "Game One");
    acf(&second, "123", "Game Two");
    acf(&second, "18446744073709551615", "Large ID");
    let escaped = display(&second).replace('\\', "\\\\");
    fs::write(
        first.join("steamapps/libraryfolders.vdf"),
        format!("\"libraryfolders\" {{ \"0\" {{ \"path\" \"{escaped}\" }} \"1\" \"{escaped}\" }}"),
    )
    .unwrap();
    let before = source_tree(&first);
    let second_before = source_tree(&second);
    let db_path = sandbox.path().join("index.sqlite3");
    {
        let db = Database::open(&db_path).unwrap();
        let report = scan(&db, request(&first)).unwrap();
        assert_eq!(report.snapshot.roots.len(), 2);
        assert_eq!(report.snapshot.games.len(), 2);
        assert_eq!(report.verified_installations, 3);
        assert_eq!(db.library_get("123").unwrap().installations.len(), 2);
    }
    let reopened = Database::open(&db_path).unwrap();
    assert_eq!(reopened.library_get("123").unwrap().installations.len(), 2);
    assert!(
        reopened
            .library_get("18446744073709551615")
            .unwrap()
            .summary
            .installed
    );
    assert_eq!(source_tree(&first), before);
    assert_eq!(source_tree(&second), second_before);
}
#[test]
fn corrupt_inventory_does_not_turn_old_records_into_verified_or_delete_them() {
    let sandbox = sandbox();
    let path = root(sandbox.path(), "Steam");
    let manifest = acf(&path, "123", "Game");
    let db = Database::open(Path::new(":memory:")).unwrap();
    scan(&db, request(&path)).unwrap();
    fs::write(&manifest, "malformed {").unwrap();
    let result = scan(&db, request(&path)).unwrap();
    assert_eq!(result.snapshot.games[0].install_status, "scan_failed");
    assert!(!result.snapshot.games[0].installed);
    assert_eq!(result.snapshot.roots[0].status, "partial");
    fs::remove_file(&manifest).unwrap();
    let result = scan(&db, request(&path)).unwrap();
    assert_eq!(result.snapshot.games.len(), 1);
    assert_eq!(result.snapshot.games[0].install_status, "absent");
    assert_eq!(db.library_get("123").unwrap().installations.len(), 1);
}
#[test]
fn malformed_mismatched_oversized_non_utf8_and_traversal_records_are_diagnosed() {
    let sandbox = sandbox();
    let path = root(sandbox.path(), "Steam");
    acf(&path, "123", "Good");
    fs::write(
        path.join("steamapps/appmanifest_124.acf"),
        "AppState { appid 125 installdir Good StateFlags 4 }",
    )
    .unwrap();
    fs::write(
        path.join("steamapps/appmanifest_126.acf"),
        "AppState { appid 126 installdir ../escape StateFlags 4 }",
    )
    .unwrap();
    fs::write(path.join("steamapps/appmanifest_127.acf"), [0xff, 0xfe]).unwrap();
    fs::write(
        path.join("steamapps/appmanifest_128.acf"),
        "x".repeat(256 * 1024 + 1),
    )
    .unwrap();
    fs::write(
        path.join("steamapps/libraryfolders.vdf"),
        "libraryfolders {",
    )
    .unwrap();
    let db = Database::open(Path::new(":memory:")).unwrap();
    let result = scan(&db, request(&path)).unwrap();
    assert_eq!(result.verified_installations, 1);
    let codes: Vec<_> = result.snapshot.roots[0]
        .diagnostics
        .iter()
        .map(|item| item.code.as_str())
        .collect();
    for code in [
        "APP_ID_MISMATCH",
        "PATH_ESCAPE",
        "INVALID_ENCODING",
        "SIZE_LIMIT",
        "MALFORMED_VDF",
    ] {
        assert!(codes.contains(&code), "{code}");
    }
}
#[test]
fn missing_install_dir_and_incomplete_flags_never_mean_installed() {
    let sandbox = sandbox();
    let path = root(sandbox.path(), "Steam");
    fs::write(
        path.join("steamapps/appmanifest_1.acf"),
        "AppState { appid 1 installdir Missing StateFlags 4 }",
    )
    .unwrap();
    fs::create_dir_all(path.join("steamapps/common/Pending")).unwrap();
    fs::write(
        path.join("steamapps/appmanifest_2.acf"),
        "AppState { appid 2 installdir Pending StateFlags 2 }",
    )
    .unwrap();
    let db = Database::open(Path::new(":memory:")).unwrap();
    scan(&db, request(&path)).unwrap();
    assert_eq!(
        db.library_get("1").unwrap().summary.install_status,
        "absent"
    );
    assert_eq!(
        db.library_get("2").unwrap().summary.install_status,
        "not_checked"
    );
}
#[test]
fn missing_steam_inputs_and_io_errors_are_structured() {
    let sandbox = sandbox();
    let db = Database::open(Path::new(":memory:")).unwrap();
    assert_eq!(
        scan_with_detected(&db, LibraryScanRequest::default(), vec![])
            .unwrap_err()
            .code,
        "NO_STEAM_INSTALLATION"
    );
    assert_eq!(
        scan(&db, request(&sandbox.path().join("missing")))
            .unwrap_err()
            .code,
        "NOT_FOUND"
    );
    assert_eq!(
        scan(
            &db,
            LibraryScanRequest {
                root_paths: Some(vec!["relative".into()]),
                force: None
            }
        )
        .unwrap_err()
        .code,
        "INVALID_INPUT"
    );
    assert_eq!(
        scan(
            &db,
            LibraryScanRequest {
                root_paths: Some(vec![]),
                force: None
            }
        )
        .unwrap_err()
        .code,
        "INVALID_INPUT"
    );
    assert_eq!(
        io_diagnostic(std::io::Error::from(std::io::ErrorKind::PermissionDenied)).0,
        "PERMISSION_DENIED"
    );
    for id in ["", "0", "-1", "123x", "1 OR 1=1", "123456789012345678901"] {
        assert!(normalized_id(id).is_err());
    }
    assert_eq!(normalized_id("000123").unwrap(), "123");
}
#[test]
fn transaction_failure_rolls_back_all_roots() {
    let sandbox = sandbox();
    let path = root(sandbox.path(), "Steam");
    acf(&path, "123", "Good");
    let mut budget = MAX_MANIFESTS;
    let (valid, _) = scan_root(&display(&path), "user_selected", &mut budget);
    let invalid = ObservedRoot {
        path: "invalid".into(),
        source: "user_selected".into(),
        status: "bad_status".into(),
        diagnostics: vec![],
        installations: vec![],
    };
    let db = Database::open(Path::new(":memory:")).unwrap();
    assert!(db.library_persist(&[valid, invalid]).is_err());
    let result = db.library_snapshot().unwrap();
    assert!(result.games.is_empty());
    assert!(result.roots.is_empty());
}
#[test]
fn populated_v1_database_is_migrated_without_inventing_verification() {
    let sandbox = sandbox();
    let path = sandbox.path().join("v1.sqlite3");
    {
        let connection = rusqlite::Connection::open(&path).unwrap();
        connection
            .execute_batch(include_str!("../../../../db/001_initial.sql"))
            .unwrap();
        connection.execute_batch("INSERT INTO settings VALUES ('preserve','42','2026-01-01T00:00:00Z'); INSERT INTO games(app_id) VALUES ('123'); INSERT INTO library_roots(path,source) VALUES ('D:/old','user_selected'); INSERT INTO installations VALUES (1,'123',1,'D:/old/game','D:/old/appmanifest_123.acf',NULL,'2026-01-01T00:00:00Z');").unwrap();
    }
    let db = Database::open(&path).unwrap();
    assert!(db.is_ready());
    assert_eq!(
        db.library_get("123").unwrap().summary.install_status,
        "not_checked"
    );
    let connection = rusqlite::Connection::open(path).unwrap();
    assert_eq!(
        connection
            .query_row(
                "SELECT value_json FROM settings WHERE key='preserve'",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
        "42"
    );
}

#[test]
fn total_manifest_budget_reports_partial_instead_of_false_absence() {
    let sandbox = sandbox();
    let path = root(sandbox.path(), "Steam");
    acf(&path, "1", "First");
    acf(&path, "2", "Second");
    let mut remaining = 1;
    let (result, _) = scan_root(&display(&path), "user_selected", &mut remaining);
    assert_eq!(result.installations.len(), 1);
    assert_eq!(remaining, 0);
    assert_eq!(result.status, "partial");
    assert!(result
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.code == "MANIFEST_LIMIT"));
}
#[cfg(windows)]
#[test]
fn junction_escape_is_rejected() {
    let sandbox = sandbox();
    let path = root(sandbox.path(), "Steam");
    let outside = sandbox.path().join("Outside");
    fs::create_dir_all(&outside).unwrap();
    let link = path.join("steamapps/common/Escape");
    let output = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(link.to_string_lossy().replace('/', "\\"))
        .arg(outside.to_string_lossy().replace('/', "\\"))
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "Junction setup failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    fs::write(
        path.join("steamapps/appmanifest_123.acf"),
        "AppState { appid 123 installdir Escape StateFlags 4 }",
    )
    .unwrap();
    let db = Database::open(Path::new(":memory:")).unwrap();
    let result = scan(&db, request(&path)).unwrap();
    assert_eq!(result.verified_installations, 0);
    assert!(result.snapshot.roots[0]
        .diagnostics
        .iter()
        .any(|item| item.code == "PATH_ESCAPE"));
}

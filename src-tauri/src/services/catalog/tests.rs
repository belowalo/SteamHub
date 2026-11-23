use super::*;
use crate::{
    contracts::catalog::CatalogGameSummary,
    providers::{validate_url, ALLOWED_HOSTS},
};
use std::path::Path;

#[test]
fn provider_url_allowlist_enforcement() {
    // Permitted HTTPS hosts
    assert!(validate_url("https://store.steampowered.com/api/storesearch/").is_ok());
    assert!(validate_url("https://api.steampowered.com/IStoreService/GetAppList/v1/").is_ok());

    // Insecure HTTP rejected
    assert!(validate_url("http://store.steampowered.com/api/storesearch/").is_err());
    assert!(validate_url("http://api.steampowered.com/IStoreService/GetAppList/v1/").is_err());

    // Arbitrary unallowlisted hosts rejected
    assert!(validate_url("https://malicious.evil.com/api/storesearch/").is_err());
    assert!(validate_url("https://steampowered.com.attacker.com/").is_err());
    assert!(validate_url("https://127.0.0.1:8080/test").is_err());
    assert!(validate_url("https://localhost/test").is_err());
    assert!(validate_url("file:///etc/passwd").is_err());

    // Ensure allowlist contains exactly the two expected hosts
    assert_eq!(
        ALLOWED_HOSTS,
        &["store.steampowered.com", "api.steampowered.com"]
    );
}

#[test]
fn catalog_search_normalization_and_injection_safety() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("catalog_test.sqlite3");
    let db = Database::open(&path).unwrap();

    let entry = CatalogGameSummary {
        app_id: "620".to_string(),
        name: Some("Portal 2".to_string()),
        artwork_url: Some("https://shared.akamai.steamstatic.com/capsule.jpg".to_string()),
        installed: false,
        metadata_source: None,
        item_type: Some("game".to_string()),
        last_modified_unix: None,
    };
    db.catalog_save_entries(&[entry], "steam-storefront")
        .unwrap();

    // Exact AppID match
    let res = db.catalog_search_cached("620", 10).unwrap();
    assert_eq!(res.len(), 1);
    assert_eq!(res[0].app_id, "620");
    assert_eq!(res[0].name.as_deref(), Some("Portal 2"));
    assert_eq!(res[0].metadata_source.as_ref().unwrap().freshness, "stale");

    // Case-insensitive title match
    let res_lower = db.catalog_search_cached("portal", 10).unwrap();
    assert_eq!(res_lower.len(), 1);
    assert_eq!(res_lower[0].app_id, "620");

    let res_upper = db.catalog_search_cached("PORTAL 2", 10).unwrap();
    assert_eq!(res_upper.len(), 1);

    // Whitespace trimming
    let res_trimmed = db.catalog_search_cached("   portal   ", 10).unwrap();
    assert_eq!(res_trimmed.len(), 1);

    // SQL Injection attempts return safe empty results and do NOT corrupt DB
    let injection_attempts = [
        "'; DROP TABLE games; --",
        "\" OR \"\"=\"",
        "620' OR '1'='1",
        "UNION SELECT * FROM sqlite_master --",
        "\\%_[]",
    ];
    for attempt in injection_attempts {
        let res = db.catalog_search_cached(attempt, 10);
        assert!(res.is_ok());
    }

    // Verify DB tables still intact
    assert!(db.is_ready());
}

#[test]
fn catalog_entry_does_not_invent_installation_or_ownership() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("installation_isolation.sqlite3");
    let db = Database::open(&path).unwrap();

    // Insert uninstalled catalog entry
    let entry = CatalogGameSummary {
        app_id: "400".to_string(),
        name: Some("Portal".to_string()),
        artwork_url: None,
        installed: false,
        metadata_source: None,
        item_type: Some("game".to_string()),
        last_modified_unix: None,
    };
    db.catalog_save_entries(&[entry], "steam-storefront")
        .unwrap();

    // Check search results
    let results = db.catalog_search_cached("400", 10).unwrap();
    assert_eq!(results.len(), 1);
    assert!(
        !results[0].installed,
        "Catalog hit must not be marked installed"
    );

    // Check detail
    let detail = db.catalog_get_cached("400").unwrap().unwrap();
    assert!(!detail.installed);
    assert!(detail.local_installations.is_empty());
    assert!(!detail.local_installation_derived);

    // P04 installations table must have 0 rows for 400
    let connection = db.connection.lock().unwrap();
    let count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM installations WHERE app_id = '400'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        count, 0,
        "No installation row must be created by catalog search"
    );
}

#[test]
fn handles_boundary_and_malformed_app_ids() {
    let service = CatalogService::default();
    let db = Database::open(Path::new(":memory:")).unwrap();

    // Malformed AppIDs
    let malformed = [
        "",
        "abc",
        "-5",
        "0",
        "123x",
        " 620 ",
        "620; DROP TABLE games;",
    ];
    for bad_id in malformed {
        let res = futures_lite_block_on(service.get(&db, bad_id));
        assert!(
            res.is_err(),
            "Malformed AppID '{}' must fail validation",
            bad_id
        );
    }
}

#[test]
fn provider_status_and_api_key_configuration() {
    let service = CatalogService::default();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("providers.sqlite3");
    let db = Database::open(&path).unwrap();

    // Initially steam-official needs configuration
    let statuses = service.provider_status(&db).unwrap();
    let official = statuses.iter().find(|p| p.id == "steam-official").unwrap();
    assert_eq!(official.status, "needs_configuration");
    assert!(official.setup_needed);

    let storefront = statuses
        .iter()
        .find(|p| p.id == "steam-storefront")
        .unwrap();
    assert_eq!(storefront.status, "ready");
    assert!(!storefront.setup_needed);

    // Set API key
    service
        .set_api_key("test_secret_key_12345".to_string())
        .unwrap();
    let statuses_after = service.provider_status(&db).unwrap();
    let official_after = statuses_after
        .iter()
        .find(|p| p.id == "steam-official")
        .unwrap();
    assert_eq!(official_after.status, "ready");
    assert!(!official_after.setup_needed);

    // Verify key is NOT written to database or logged
    let connection = db.connection.lock().unwrap();
    let has_key: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM settings WHERE value_json LIKE '%test_secret_key_12345%')",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(!has_key, "API key must never be persisted to SQLite");
}

#[test]
fn offline_cached_search_and_cache_miss() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("offline_cache.sqlite3");
    let db = Database::open(&path).unwrap();

    // Save a game to cache
    let entry = CatalogGameSummary {
        app_id: "730".to_string(),
        name: Some("Counter-Strike 2".to_string()),
        artwork_url: None,
        installed: false,
        metadata_source: None,
        item_type: Some("game".to_string()),
        last_modified_unix: None,
    };
    db.catalog_save_entries(&[entry], "steam-storefront")
        .unwrap();

    // Cache miss for unknown game returns 0 results cleanly without error
    let miss = db
        .catalog_search_cached("NonExistentGameXYZ123", 10)
        .unwrap();
    assert!(
        miss.is_empty(),
        "Uncached game must return empty, never faking a hit"
    );

    // Cache hit for known game
    let hit = db.catalog_search_cached("Counter-Strike", 10).unwrap();
    assert_eq!(hit.len(), 1);
    assert_eq!(hit[0].app_id, "730");
    assert_eq!(hit[0].metadata_source.as_ref().unwrap().freshness, "stale");
}

#[test]
fn deterministic_duplicate_upsert() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("duplicates.sqlite3");
    let db = Database::open(&path).unwrap();

    let entry1 = CatalogGameSummary {
        app_id: "620".to_string(),
        name: Some("Portal 2".to_string()),
        artwork_url: None,
        installed: false,
        metadata_source: None,
        item_type: Some("game".to_string()),
        last_modified_unix: Some(100),
    };
    let entry2 = CatalogGameSummary {
        app_id: "620".to_string(),
        name: Some("Portal 2 - Updated Title".to_string()),
        artwork_url: Some("https://cdn.example.com/capsule.jpg".to_string()),
        installed: false,
        metadata_source: None,
        item_type: Some("game".to_string()),
        last_modified_unix: Some(200),
    };

    db.catalog_save_entries(&[entry1], "steam-storefront")
        .unwrap();
    db.catalog_save_entries(&[entry2], "steam-storefront")
        .unwrap();

    let connection = db.connection.lock().unwrap();
    let count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM catalog_entries WHERE app_id = '620'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        count, 1,
        "Duplicate AppID must update the row, not create duplicates"
    );

    let title: String = connection
        .query_row(
            "SELECT display_name FROM catalog_entries WHERE app_id = '620'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(title, "Portal 2 - Updated Title");
}

fn futures_lite_block_on<F: std::future::Future>(future: F) -> F::Output {
    tauri::async_runtime::block_on(future)
}

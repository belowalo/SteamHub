//! Short-lived, region-specific public Steam store quotes. No account access.
use crate::contracts::AppError;
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    sync::{LazyLock, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Quote {
    pub app_id: String,
    pub country: String,
    pub kind: String,
    pub currency: Option<String>,
    pub current: Option<String>,
    pub original: Option<String>,
    pub discount: u64,
    pub checked_at: u64,
    pub amount_minor: Option<u64>,
}
static CACHE: LazyLock<Mutex<HashMap<(String, String), Quote>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn unknown(app: &str, country: &str) -> Quote {
    Quote {
        app_id: app.into(),
        country: country.into(),
        kind: "unavailable".into(),
        currency: None,
        current: None,
        original: None,
        discount: 0,
        checked_at: now(),
        amount_minor: None,
    }
}
fn formatted(value: &serde_json::Value) -> Option<String> {
    value
        .as_str()
        .filter(|s| !s.trim().is_empty() && s.len() < 150)
        .map(str::to_owned)
}
fn parse(app: &str, country: &str, value: &serde_json::Value) -> Quote {
    let mut quote = unknown(app, country);
    if value[app]["success"].as_bool() != Some(true) {
        return quote;
    }
    let data = &value[app]["data"];
    let price = &data["price_overview"];
    let free = data["is_free"].as_bool() == Some(true);
    let Some(current) = price["final"].as_u64() else {
        if free {
            quote.kind = "free".into();
            quote.amount_minor = Some(0);
        }
        return quote;
    };
    let Some(initial) = price["initial"].as_u64() else {
        return quote;
    };
    let Some(discount) = price["discount_percent"].as_u64() else {
        return quote;
    };
    let Some(currency) = price["currency"]
        .as_str()
        .filter(|s| s.len() == 3 && s.bytes().all(|b| b.is_ascii_uppercase()))
    else {
        return quote;
    };
    if discount > 100 || current > initial || free && current > 0 {
        return quote;
    }
    if current == 0 && !free && !(initial > 0 && discount == 100) {
        return quote;
    }
    let Some(final_text) = formatted(&price["final_formatted"]) else {
        return quote;
    };
    quote.kind = if current == 0 { "free" } else { "paid" }.into();
    quote.currency = Some(currency.into());
    quote.amount_minor = Some(current);
    quote.current = Some(final_text);
    quote.discount = if current < initial { discount } else { 0 };
    if quote.discount > 0 {
        quote.original = formatted(&price["initial_formatted"]);
    }
    quote
}
fn cached(app: &str, country: &str) -> Option<Quote> {
    CACHE
        .lock()
        .ok()?
        .get(&(app.into(), country.into()))
        .filter(|q| {
            now().saturating_sub(q.checked_at) < if q.kind == "unavailable" { 30 } else { 300 }
        })
        .cloned()
}
async fn fetch(app: String, country: String, refresh: bool) -> Quote {
    if !refresh {
        if let Some(quote) = cached(&app, &country) {
            return quote;
        }
    }
    let fetched = async {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(8))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .ok()?;
        let response = client
            .get(format!(
                "https://store.steampowered.com/api/appdetails?appids={app}&cc={country}&l=english"
            ))
            .send()
            .await
            .ok()?;
        if !response.status().is_success() {
            return None;
        }
        let bytes = crate::providers::read_limited_response(response, 4 * 1024 * 1024)
            .await
            .ok()?;
        let value = serde_json::from_slice(&bytes).ok()?;
        Some(parse(&app, &country, &value))
    }
    .await;
    let quote = fetched.unwrap_or_else(|| unknown(&app, &country));
    if let Ok(mut cache) = CACHE.lock() {
        if cache.len() >= 500 {
            cache.retain(|_, q| now().saturating_sub(q.checked_at) < 30);
            if cache.len() >= 500 {
                if let Some(key) = cache
                    .iter()
                    .min_by_key(|(_, q)| q.checked_at)
                    .map(|(key, _)| key.clone())
                {
                    cache.remove(&key);
                }
            }
        }
        cache.insert((app, country), quote.clone());
    }
    quote
}
pub async fn prices(
    apps: Vec<String>,
    country: String,
    refresh: bool,
) -> Result<Vec<Quote>, AppError> {
    if apps.len() > 16 || country.len() != 2 || !country.bytes().all(|b| b.is_ascii_alphabetic()) {
        return Err(AppError::new(
            "INVALID_INPUT",
            "Choose a store country and up to 16 games.",
            false,
        ));
    }
    let country = country.to_ascii_uppercase();
    let mut seen = HashSet::new();
    let mut ids = vec![];
    for value in apps {
        let app = super::game_status::app(&value)?;
        if seen.insert(app.clone()) {
            ids.push(app);
        }
    }
    let mut result = vec![];
    for batch in ids.chunks(4) {
        let mut tasks = vec![];
        for app in batch {
            let app = app.clone();
            let country = country.clone();
            tasks.push(tauri::async_runtime::spawn(fetch(app, country, refresh)));
        }
        for task in tasks {
            result.push(
                task.await.map_err(|_| {
                    AppError::new("IO_ERROR", "Could not check Steam prices.", true)
                })?,
            );
        }
    }
    Ok(result)
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn free_sale_full_price_and_unknown_are_distinct() {
        let quote = |data| parse("42", "CA", &json!({"42":{"success":true,"data":data}}));
        assert_eq!(quote(json!({"is_free":true})).kind, "free");
        assert_eq!(quote(json!({"is_free":false})).kind, "unavailable");
        let mut price = json!({"currency":"CAD","initial":2499,"final":1249,"discount_percent":50,"initial_formatted":"CDN$ 24.99","final_formatted":"CDN$ 12.49"});
        let sale = quote(json!({"is_free":false,"price_overview":price}));
        assert_eq!(sale.kind, "paid");
        assert_eq!(sale.discount, 50);
        assert_eq!(sale.currency.as_deref(), Some("CAD"));
        assert_eq!(sale.country, "CA");
        assert_eq!(sale.amount_minor, Some(1249));
        price["final"] = json!(2499);
        price["discount_percent"] = json!(0);
        assert_eq!(quote(json!({"price_overview":price})).discount, 0);
        price["final"] = json!(0);
        price["discount_percent"] = json!(100);
        assert_eq!(
            quote(json!({"is_free":false,"price_overview":price})).kind,
            "free"
        );
        price["discount_percent"] = json!(0);
        assert_eq!(
            quote(json!({"is_free":false,"price_overview":price})).kind,
            "unavailable"
        );
        assert_eq!(
            parse("42", "CA", &json!({"42":{"success":false}})).kind,
            "unavailable"
        );
        price["final"] = json!(3000);
        assert_eq!(quote(json!({"price_overview":price})).kind, "unavailable");
    }
    #[test]
    fn price_cache_is_country_specific() {
        let q = parse(
            "4294967294",
            "CA",
            &json!({"4294967294":{"success":true,"data":{"is_free":true}}}),
        );
        CACHE
            .lock()
            .unwrap()
            .insert((q.app_id.clone(), q.country.clone()), q);
        assert!(cached("4294967294", "CA").is_some());
        assert!(cached("4294967294", "US").is_none());
    }
    #[test]
    fn rejects_invalid_price_requests_before_network_access() {
        for (apps, country) in [
            (vec!["../42".into()], "US"),
            (vec!["42".into()], "USA"),
            (vec!["42".into(); 17], "CA"),
        ] {
            assert!(tauri::async_runtime::block_on(prices(apps, country.into(), false)).is_err());
        }
    }
}

use super::{remote, Bundle, CachedLookup, DataSource, ManifestBlob};
use reqwest::{header::HeaderMap, Client, Url};
use std::{
    path::Path,
    time::{Duration, Instant},
};

pub(super) fn pins(lua: &str) -> Vec<(String, String)> {
    lua.lines()
        .filter_map(|line| {
            let body = line.strip_prefix("setManifestid(")?.strip_suffix(')')?;
            let (depot, gid) = body.split_once(',')?;
            Some((depot.to_owned(), gid.trim_matches('"').to_owned()))
        })
        .collect()
}
/// ManifestHub supplies missing blobs for known pins; it does not supply game keys.
pub(super) async fn manifests(
    client: &Client,
    _source: &DataSource,
    directory: &Path,
    bundle: &Bundle,
    cached: &mut CachedLookup,
    deadline: Instant,
) {
    let missing: Vec<_> = pins(&bundle.generated.text)
        .into_iter()
        .filter(|(d, g)| {
            !bundle
                .manifests
                .iter()
                .any(|(name, _)| name == &format!("{d}_{g}.manifest"))
        })
        .collect();
    if missing.is_empty() {
        return;
    }
    let Ok(Some(key)) = super::credentials::load(directory, "manifesthub") else {
        return;
    };
    let deadline = deadline.min(Instant::now() + Duration::from_secs(20));
    let mut bytes = 0usize;
    for (depot, gid) in missing.iter().take(64) {
        if Instant::now() >= deadline {
            break;
        }
        let Ok(mut url) = Url::parse("https://api.manifesthub2.filegear-sg.me/manifest") else {
            return;
        };
        url.query_pairs_mut()
            .append_pair("apikey", &key)
            .append_pair("depotid", depot)
            .append_pair("manifestid", gid);
        match remote::get(
            client,
            url,
            HeaderMap::new(),
            (32 * 1024 * 1024usize).saturating_sub(bytes),
            deadline,
        )
        .await
        {
            Ok(body) if !body.is_empty() && !matches!(body.first(), Some(b'<' | b'{')) => {
                bytes += body.len();
                cached.extra_manifests.push(ManifestBlob {
                    name: format!("{depot}_{gid}.manifest"),
                    data: body,
                });
            }
            Err(e) => {
                cached.warnings.push(format!(
                    "ManifestHub: {}. Steam must fetch any missing manifests.",
                    e.message
                ));
                break;
            }
            _ => {
                cached
                    .warnings
                    .push("ManifestHub returned an invalid manifest; Steam must fetch it.".into());
                break;
            }
        }
    }
    if cached.extra_manifests.len() < missing.len() && cached.warnings.is_empty() {
        cached.warnings.push(
            "Some manifests were not supplied within the lookup limits; Steam must fetch them."
                .into(),
        );
    }
}

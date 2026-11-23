//! Read-only, bounded parsing of local binary KeyValues shortcut lists.
use crate::{contracts::AppError, storage::Database};
use serde::Serialize;
use std::{fs, io::Read, path::Path};
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Shortcut {
    pub name: String,
    pub executable: String,
    pub start_directory: String,
    pub user_id: String,
    pub source_file: String,
}
#[derive(Serialize)]
pub struct ShortcutSnapshot {
    pub shortcuts: Vec<Shortcut>,
    pub diagnostics: Vec<String>,
}
enum Value {
    Object(Vec<(String, Value)>),
    Text(String),
    Other,
}
struct Parser<'a> {
    bytes: &'a [u8],
    pos: usize,
    tokens: usize,
}
impl Parser<'_> {
    fn byte(&mut self) -> Result<u8, String> {
        let b = *self
            .bytes
            .get(self.pos)
            .ok_or("Truncated binary KeyValues")?;
        self.pos += 1;
        Ok(b)
    }
    fn text(&mut self) -> Result<String, String> {
        let start = self.pos;
        loop {
            if self.byte()? == 0 {
                break;
            }
            if self.pos - start > 32768 {
                return Err("Oversized shortcut field".into());
            }
        }
        String::from_utf8(self.bytes[start..self.pos - 1].to_vec())
            .map_err(|_| "Shortcut text is not UTF-8".into())
    }
    fn skip(&mut self, n: usize) -> Result<(), String> {
        self.pos = self.pos.checked_add(n).ok_or("Offset overflow")?;
        if self.pos > self.bytes.len() {
            return Err("Truncated binary KeyValues".into());
        }
        Ok(())
    }
    fn object(&mut self, depth: usize) -> Result<Vec<(String, Value)>, String> {
        if depth > 16 {
            return Err("Shortcut nesting exceeds limit".into());
        }
        let mut fields = Vec::new();
        loop {
            let tag = self.byte()?;
            if tag == 8 {
                return Ok(fields);
            }
            self.tokens += 1;
            if self.tokens > 50000 {
                return Err("Too many shortcut fields".into());
            }
            let key = self.text()?;
            let value = match tag {
                0 => Value::Object(self.object(depth + 1)?),
                1 => Value::Text(self.text()?),
                2 | 3 | 4 | 6 => {
                    self.skip(4)?;
                    Value::Other
                }
                7 => {
                    self.skip(8)?;
                    Value::Other
                }
                _ => return Err(format!("Unsupported shortcut type {tag}")),
            };
            fields.push((key, value));
        }
    }
}
fn text(fields: &[(String, Value)], name: &str) -> String {
    fields
        .iter()
        .find_map(|(k, v)| {
            if k.eq_ignore_ascii_case(name) {
                if let Value::Text(t) = v {
                    Some(t.clone())
                } else {
                    None
                }
            } else {
                None
            }
        })
        .unwrap_or_default()
}
fn parse(bytes: &[u8], user: &str, source: &str) -> Result<Vec<Shortcut>, String> {
    let mut p = Parser {
        bytes,
        pos: 0,
        tokens: 0,
    };
    let root = p.object(0)?;
    if p.pos != bytes.len() {
        return Err("Trailing bytes in shortcut file".into());
    }
    let list = root
        .into_iter()
        .find_map(|(k, v)| {
            if k.eq_ignore_ascii_case("shortcuts") {
                if let Value::Object(v) = v {
                    Some(v)
                } else {
                    None
                }
            } else {
                None
            }
        })
        .ok_or("Missing shortcuts object")?;
    let mut result = Vec::new();
    for (_, v) in list {
        if let Value::Object(fields) = v {
            let name = text(&fields, "appname");
            if !name.is_empty() {
                result.push(Shortcut {
                    name,
                    executable: text(&fields, "exe"),
                    start_directory: text(&fields, "StartDir"),
                    user_id: user.into(),
                    source_file: source.into(),
                });
            }
        }
    }
    Ok(result)
}
pub fn scan(db: &Database) -> Result<ShortcutSnapshot, AppError> {
    let mut result = ShortcutSnapshot {
        shortcuts: vec![],
        diagnostics: vec![],
    };
    let mut roots = super::library::detected_roots();
    roots.extend(db.library_snapshot()?.roots.into_iter().map(|r| r.path));
    roots.sort();
    roots.dedup();
    for root in roots.into_iter().take(64) {
        let userdata = Path::new(&root).join("userdata");
        let users = match fs::read_dir(&userdata) {
            Ok(d) => d,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => {
                result
                    .diagnostics
                    .push(format!("Cannot read {}", userdata.display()));
                continue;
            }
        };
        let base = match userdata.canonicalize() {
            Ok(p) => p,
            Err(_) => continue,
        };
        for user in users.take(100) {
            let Ok(user) = user else { continue };
            let name = user.file_name().to_string_lossy().to_string();
            if name.is_empty() || !name.bytes().all(|b| b.is_ascii_digit()) {
                continue;
            }
            let path = user.path().join("config/shortcuts.vdf");
            if !path.exists() {
                continue;
            }
            let source = path.display().to_string();
            let one = (|| {
                let canonical = path
                    .canonicalize()
                    .map_err(|_| "Cannot resolve shortcut path".to_string())?;
                if !canonical.starts_with(&base) {
                    return Err("Shortcut path escapes userdata".to_string());
                }
                let f = fs::File::open(&canonical)
                    .map_err(|_| "Cannot open shortcut file".to_string())?;
                if !f
                    .metadata()
                    .map_err(|_| "Cannot inspect shortcut file".to_string())?
                    .is_file()
                {
                    return Err("Shortcut input is not a regular file".to_string());
                }
                let mut bytes = Vec::new();
                f.take(16 * 1024 * 1024 + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|_| "Cannot read shortcut file".to_string())?;
                if bytes.len() > 16 * 1024 * 1024 {
                    return Err("Shortcut file exceeds 16 MiB".to_string());
                }
                parse(&bytes, &name, &source)
            })();
            match one {
                Ok(mut entries) => result.shortcuts.append(&mut entries),
                Err(e) => result.diagnostics.push(format!("{source}: {e}")),
            }
        }
    }
    Ok(result)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_shortcuts_and_rejects_truncated_data() {
        let bytes=b"\x00shortcuts\0\x000\0\x01appname\0My non-Steam game\0\x01exe\0game.exe\0\x02appid\0\x01\x00\x00\x80\x08\x08\x08";
        let rows = parse(bytes, "123", "test").unwrap();
        assert_eq!(rows[0].name, "My non-Steam game");
        assert_eq!(rows[0].user_id, "123");
        assert!(parse(&bytes[..bytes.len() - 1], "123", "test").is_err());
    }
}

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, path::Path};

pub fn hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Package {
    pub schema: u32,
    pub runtime_sha256: String,
    pub client_sha256: String,
    pub ui_sha256: String,
    pub client_pattern: String,
    pub ui_pattern: String,
    pub ipc: String,
}
struct Pe<'a> {
    bytes: &'a [u8],
    sections: Vec<(usize, usize, usize, u32)>,
    base: u64,
    functions: Vec<(usize, usize)>,
}
fn number(bytes: &[u8], offset: usize, size: usize) -> Result<u64, String> {
    let b = bytes
        .get(offset..offset.checked_add(size).ok_or("Invalid PE offset")?)
        .ok_or("Truncated PE")?;
    Ok(b.iter()
        .enumerate()
        .fold(0, |n, (i, b)| n | ((*b as u64) << (8 * i))))
}
impl<'a> Pe<'a> {
    fn new(bytes: &'a [u8]) -> Result<Self, String> {
        let p = number(bytes, 0x3c, 4)? as usize;
        if bytes.get(p..p + 4) != Some(b"PE\0\0") || number(bytes, p + 4, 2)? != 0x8664 {
            return Err("Expected Windows x64 PE".into());
        }
        let optional = p + 24;
        if number(bytes, optional, 2)? != 0x20b {
            return Err("Invalid PE optional header".into());
        }
        let mut sections = vec![];
        let count = number(bytes, p + 6, 2)? as usize;
        if count > 96 {
            return Err("Invalid PE sections".into());
        }
        for i in 0..count {
            let s = optional + number(bytes, p + 20, 2)? as usize + i * 40;
            sections.push((
                number(bytes, s + 12, 4)? as usize,
                number(bytes, s + 16, 4)? as usize,
                number(bytes, s + 20, 4)? as usize,
                number(bytes, s + 36, 4)? as u32,
            ));
        }
        let mut pe = Self {
            bytes,
            sections,
            base: number(bytes, optional + 24, 8)?,
            functions: vec![],
        };
        let r = number(bytes, optional + 136, 4)? as usize;
        let size = number(bytes, optional + 140, 4)? as usize;
        if size > 16 * 1024 * 1024 || !size.is_multiple_of(12) {
            return Err("Invalid exception table".into());
        }
        let at = pe.offset(r, size)?;
        for i in (0..size).step_by(12) {
            pe.functions.push((
                number(bytes, at + i, 4)? as usize,
                number(bytes, at + i + 4, 4)? as usize,
            ));
        }
        Ok(pe)
    }
    fn offset(&self, rva: usize, len: usize) -> Result<usize, String> {
        for &(va, size, raw, _) in &self.sections {
            if rva >= va && rva.checked_add(len).is_some_and(|end| end <= va + size) {
                let off = raw + rva - va;
                if self.bytes.get(off..off + len).is_some() {
                    return Ok(off);
                }
            }
        }
        Err("Compatibility address is outside the module".into())
    }
    fn executable(&self, rva: usize) -> bool {
        self.sections
            .iter()
            .any(|&(va, size, _, flags)| rva >= va && rva < va + size && flags & 0x20000000 != 0)
    }
}
fn hex(value: &toml::Value) -> Result<usize, String> {
    let s = value.as_str().ok_or("Expected hexadecimal address")?;
    usize::from_str_radix(s.trim_start_matches("0x"), 16)
        .map_err(|_| "Invalid hexadecimal address".into())
}
fn table(s: &str) -> Result<toml::Value, String> {
    toml::from_str(s).map_err(|_| "Invalid compatibility TOML".into())
}
fn validate_patterns(pe: &Pe<'_>, text: &str, reference: &str) -> Result<(), String> {
    let entries = table(text)?;
    let baseline = table(reference)?;
    let entries = entries.as_table().ok_or("Invalid patterns")?;
    let baseline = baseline.as_table().ok_or("Invalid reference")?;
    if entries.len() != baseline.len() {
        return Err("Incomplete compatibility hooks".into());
    }
    for (key, expected) in baseline {
        let e = entries.get(key).ok_or("Missing compatibility hook")?;
        if e["name"] != expected["name"] {
            return Err("Unexpected compatibility hook".into());
        }
        let rva = hex(&e["rva"])?;
        let tokens: Vec<Option<u8>> = e["sig"]
            .as_str()
            .ok_or("Missing signature")?
            .split_whitespace()
            .map(|s| {
                if s == "?" || s == "??" {
                    Ok(None)
                } else {
                    u8::from_str_radix(s, 16)
                        .map(Some)
                        .map_err(|_| "Invalid signature")
                }
            })
            .collect::<Result<_, _>>()?;
        if !(16..=512).contains(&tokens.len()) || !pe.executable(rva) {
            return Err("Invalid hook signature range".into());
        }
        let off = pe.offset(rva, tokens.len())?;
        if !tokens
            .iter()
            .enumerate()
            .all(|(i, b)| b.is_none_or(|b| pe.bytes[off + i] == b))
        {
            return Err("Hook signature does not match installed Steam".into());
        }
        let anchor = tokens
            .windows(4)
            .enumerate()
            .find(|(_, w)| w.iter().all(Option::is_some))
            .ok_or("Signature is too broad")?;
        let needle: Vec<u8> = anchor.1.iter().map(|b| b.unwrap()).collect();
        let mut count = 0;
        for &(va, size, raw, flags) in &pe.sections {
            if flags & 0x20000000 == 0 {
                continue;
            }
            let section = pe
                .bytes
                .get(raw..raw + size)
                .ok_or("Invalid code section")?;
            for pos in memchr::memmem::find_iter(section, &needle) {
                let Some(start) = pos.checked_sub(anchor.0) else {
                    continue;
                };
                if start + tokens.len() <= section.len()
                    && tokens
                        .iter()
                        .enumerate()
                        .all(|(i, b)| b.is_none_or(|b| section[start + i] == b))
                {
                    count += 1;
                    if va + start != rva || count > 1 {
                        return Err("Hook signature is ambiguous".into());
                    }
                }
            }
        }
        if count != 1 {
            return Err("Hook signature was not found".into());
        }
    }
    Ok(())
}
pub fn validate(root: &Path, p: &Package) -> Result<(), String> {
    if p.schema != 1 {
        return Err("Unsupported compatibility package".into());
    }
    let client = fs::read(root.join("steamclient64.dll")).map_err(|e| e.to_string())?;
    let ui = fs::read(root.join("steamui.dll")).map_err(|e| e.to_string())?;
    let runtime = fs::read(root.join("OpenSteamTool.dll")).map_err(|e| e.to_string())?;
    if hash(&client) != p.client_sha256
        || hash(&ui) != p.ui_sha256
        || hash(&runtime) != p.runtime_sha256
    {
        return Err("Compatibility package does not match installed Steam/runtime".into());
    }
    let client = Pe::new(&client)?;
    let ui = Pe::new(&ui)?;
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(include_bytes!(
        "../../runtime-bundle.zip"
    )))
    .map_err(|e| e.to_string())?;
    use std::io::Read;
    let mut reference = |path: &str| -> Result<String, String> {
        let mut s = String::new();
        zip.by_name(path)
            .map_err(|e| e.to_string())?
            .read_to_string(&mut s)
            .map_err(|e| e.to_string())?;
        Ok(s)
    };
    let client_ref=reference("opensteamtool/pattern/steamclient/669fa08e259277fbf5a1dfe15ce88afe734e89151194304b44d92f418dcc985b.toml")?;
    let ui_ref=reference("opensteamtool/pattern/steamui/2dfb0a5d50dd90667549cc7d413c7bfb0794c9af4ebaf08bf1cf7d938a11ea93.toml")?;
    validate_patterns(&client, &p.client_pattern, &client_ref)?;
    validate_patterns(&ui, &p.ui_pattern, &ui_ref)?;
    let ipc = table(&p.ipc)?;
    for (iface, iid, methods) in [
        (
            "IClientUser",
            1,
            vec![
                ("GetSteamID", 0),
                ("GetAppOwnershipTicketExtendedData", 2),
                ("RequestEncryptedAppTicket", 2),
                ("GetEncryptedAppTicket", 1),
            ],
        ),
        (
            "IClientUtils",
            4,
            vec![("GetAppID", 0), ("GetAPICallResult", 3)],
        ),
    ] {
        let i = &ipc[iface];
        if i["interface_id"].as_integer() != Some(iid) {
            return Err("Invalid IPC interface".into());
        }
        let vt = hex(&i["vtable_rva"])?;
        if !client.sections.iter().any(|&(va, size, _, flags)| {
            vt >= va && vt < va + size && flags & 0x40000000 != 0 && flags & 0xa0000000 == 0
        }) {
            return Err("IPC vtable is outside read-only data".into());
        }
        for (method, argc) in methods {
            let e = &i[method];
            let r = hex(&e["wrapper_rva"])?;
            let index = e["method_index"]
                .as_integer()
                .filter(|n| (0..4096).contains(n))
                .ok_or("Invalid IPC index")? as usize;
            let slot = vt
                .checked_add(index * 8)
                .ok_or("Invalid IPC vtable offset")?;
            let at = client.offset(slot, 8)?;
            if e["argc"].as_integer() != Some(argc)
                || !client.executable(r)
                || number(client.bytes, at, 8)? != client.base + r as u64
            {
                return Err("IPC method does not match Steam".into());
            }
            let end = client
                .functions
                .iter()
                .find(|(start, _)| *start == r)
                .map(|(_, end)| *end)
                .ok_or("IPC wrapper not found")?;
            let len = end
                .checked_sub(r)
                .filter(|n| *n <= 65536)
                .ok_or("Invalid wrapper range")?;
            let at = client.offset(r, len)?;
            let body = &client.bytes[at..at + len];
            for field in ["funcHash", "fencepost"] {
                let value = u32::try_from(hex(&e[field])?)
                    .map_err(|_| "Invalid IPC constant")?
                    .to_le_bytes();
                if !body.windows(4).any(|w| w == value) {
                    return Err("IPC constants do not match Steam".into());
                }
            }
        }
    }
    Ok(())
}

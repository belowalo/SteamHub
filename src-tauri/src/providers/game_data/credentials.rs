//! Provider keys live in Windows Credential Manager, scoped to this workspace profile.
use super::{error, sources::requires_key};
use crate::contracts::AppError;
use std::path::Path;

fn target(directory: &Path, kind: &str) -> Result<Vec<u16>, AppError> {
    if !requires_key(kind) {
        return Err(error("This source does not use an API key."));
    }
    let path = directory
        .canonicalize()
        .map_err(|_| error("Could not identify this workspace profile."))?;
    Ok(format!(
        "SteamHub:{}:{kind}",
        super::digest(path.to_string_lossy().as_bytes())
    )
    .encode_utf16()
    .chain(Some(0))
    .collect())
}
pub fn save(directory: &Path, kind: &str, key: Option<&str>) -> Result<(), AppError> {
    let key = key.map(str::trim).filter(|s| !s.is_empty());
    if key
        .is_some_and(|s| s.len() > 2048 || s.len() < 8 || !s.bytes().all(|b| b.is_ascii_graphic()))
    {
        return Err(error(
            "Enter a valid API key without spaces (8–2048 characters).",
        ));
    }
    let target = target(directory, kind)?;
    #[cfg(windows)]
    {
        use windows_sys::Win32::{
            Foundation::{GetLastError, ERROR_NOT_FOUND},
            Security::Credentials::*,
        };
        // All buffers outlive the synchronous Windows call; no pointer is retained.
        unsafe {
            if let Some(key) = key {
                let credential = CREDENTIALW {
                    Type: CRED_TYPE_GENERIC,
                    TargetName: target.as_ptr().cast_mut(),
                    CredentialBlobSize: key.len() as u32,
                    CredentialBlob: key.as_ptr().cast_mut(),
                    Persist: CRED_PERSIST_LOCAL_MACHINE,
                    ..std::mem::zeroed()
                };
                if CredWriteW(&credential, 0) == 0 {
                    return Err(error("Windows could not save this API key."));
                }
            } else if CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) == 0
                && GetLastError() != ERROR_NOT_FOUND
            {
                return Err(error("Windows could not remove this API key."));
            }
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (target, key);
        Err(error("Secure provider credentials require Windows."))
    }
}
pub fn load(directory: &Path, kind: &str) -> Result<Option<String>, AppError> {
    let target = target(directory, kind)?;
    #[cfg(windows)]
    {
        use windows_sys::Win32::{
            Foundation::{GetLastError, ERROR_NOT_FOUND},
            Security::Credentials::*,
        };
        let mut pointer = std::ptr::null_mut();
        // CredRead allocates its result; it is copied, then always released with CredFree.
        unsafe {
            if CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut pointer) == 0 {
                return if GetLastError() == ERROR_NOT_FOUND {
                    Ok(None)
                } else {
                    Err(error("Windows could not read this provider's API key."))
                };
            }
            let value = &*pointer;
            let result = if value.CredentialBlobSize > 2048
                || value.CredentialBlobSize == 0
                || value.CredentialBlob.is_null()
            {
                Err(error("Stored provider credential is invalid."))
            } else {
                String::from_utf8(
                    std::slice::from_raw_parts(
                        value.CredentialBlob,
                        value.CredentialBlobSize as usize,
                    )
                    .to_vec(),
                )
                .map(Some)
                .map_err(|_| error("Stored provider credential is invalid."))
            };
            CredFree(pointer.cast());
            result
        }
    }
    #[cfg(not(windows))]
    {
        let _ = target;
        Ok(None)
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn credential_manager_round_trip_is_profile_scoped_and_not_written_to_settings() {
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        struct Cleanup<'a>(&'a Path);
        impl Drop for Cleanup<'_> {
            fn drop(&mut self) {
                let _ = save(self.0, "ryuu", None);
            }
        }
        let _cleanup = Cleanup(first.path());
        save(first.path(), "ryuu", Some("qa-only-not-a-real-api-key")).unwrap();
        assert_eq!(
            load(first.path(), "ryuu").unwrap().as_deref(),
            Some("qa-only-not-a-real-api-key")
        );
        assert!(load(second.path(), "ryuu").unwrap().is_none());
        assert_eq!(std::fs::read_dir(first.path()).unwrap().count(), 0);
        save(first.path(), "ryuu", None).unwrap();
        assert!(load(first.path(), "ryuu").unwrap().is_none());
        assert!(save(first.path(), "openlua", Some("qa-only-not-a-real-api-key")).is_err());
    }
}

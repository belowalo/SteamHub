use serde::Serialize;
pub mod catalog;
pub mod library;

// Mirrors the implemented subset of contracts/steamHub.ts (DTO v1).
#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum ApiResult<T> {
    Success { ok: bool, data: T },
    Failure { ok: bool, error: AppError },
}

impl<T> ApiResult<T> {
    pub fn from_result(result: Result<T, AppError>) -> Self {
        match result {
            Ok(data) => Self::success(data),
            Err(error) => Self::Failure { ok: false, error },
        }
    }
    pub fn success(data: T) -> Self {
        Self::Success { ok: true, data }
    }

    pub fn internal(message: &str) -> Self {
        Self::Failure {
            ok: false,
            error: AppError {
                code: "INTERNAL",
                message: message.to_owned(),
                retryable: true,
            },
        }
    }
}

#[derive(Debug, Serialize)]
pub struct AppError {
    pub code: &'static str,
    pub message: String,
    pub retryable: bool,
}

impl AppError {
    pub fn new(code: &'static str, message: &str, retryable: bool) -> Self {
        Self {
            code,
            message: message.to_owned(),
            retryable,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResult {
    pub api_version: u8,
    pub database_ready: bool,
    pub app_version: &'static str,
}

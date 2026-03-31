use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
};
use axum::http::{
    HeaderMap,
    header::{AUTHORIZATION, FORWARDED, HOST},
};
use chrono::{Duration, Utc};
use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation, decode, encode};
use rand_core::OsRng;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    config::Config,
    error::{ApiError, AppResult},
    models::ConsoleUserRole,
};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TokenClaims {
    pub sub: String,
    pub address: String,
    pub iat: usize,
    pub exp: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ConsoleSessionClaims {
    pub sub: String,
    pub username: String,
    pub role: String,
    pub scope: String,
    pub iat: usize,
    pub exp: usize,
}

pub fn hash_password(password: &str) -> AppResult<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|error| ApiError::internal(format!("failed to hash password: {error}")))
}

pub fn verify_password(password: &str, password_hash: &str) -> AppResult<bool> {
    let parsed_hash = PasswordHash::new(password_hash)
        .map_err(|error| ApiError::internal(format!("invalid password hash: {error}")))?;

    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok())
}

pub fn issue_token(account_id: Uuid, address: &str, config: &Config) -> AppResult<String> {
    let now = Utc::now();
    let ttl_seconds = config.token_ttl_seconds.max(60);
    let claims = TokenClaims {
        sub: account_id.to_string(),
        address: address.to_owned(),
        iat: now.timestamp() as usize,
        exp: (now + Duration::seconds(ttl_seconds)).timestamp() as usize,
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(config.jwt_secret.as_bytes()),
    )
    .map_err(|error| ApiError::internal(format!("failed to encode token: {error}")))
}

pub fn issue_console_session_token(
    user_id: Uuid,
    username: &str,
    role: &ConsoleUserRole,
    config: &Config,
) -> AppResult<String> {
    let now = Utc::now();
    let ttl_seconds = config.admin_session_ttl_seconds.max(60);
    let claims = ConsoleSessionClaims {
        sub: user_id.to_string(),
        username: username.to_owned(),
        role: match role {
            ConsoleUserRole::Admin => "admin",
            ConsoleUserRole::User => "user",
        }
        .to_owned(),
        scope: "console-session".to_owned(),
        iat: now.timestamp() as usize,
        exp: (now + Duration::seconds(ttl_seconds)).timestamp() as usize,
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(config.jwt_secret.as_bytes()),
    )
    .map_err(|error| ApiError::internal(format!("failed to encode console session token: {error}")))
}

pub fn account_id_from_headers(headers: &HeaderMap, config: &Config) -> AppResult<Uuid> {
    let token = bearer_token(headers)?;
    let claims = decode::<TokenClaims>(
        &token,
        &DecodingKey::from_secret(config.jwt_secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|_| ApiError::unauthorized("invalid or expired token"))?
    .claims;

    Uuid::parse_str(&claims.sub).map_err(|_| ApiError::unauthorized("invalid token subject"))
}

pub fn decode_console_session_token(
    token: &str,
    config: &Config,
) -> AppResult<ConsoleSessionClaims> {
    let claims = decode::<ConsoleSessionClaims>(
        token,
        &DecodingKey::from_secret(config.jwt_secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|_| ApiError::unauthorized("invalid console session"))?
    .claims;

    if claims.scope != "console-session" {
        return Err(ApiError::unauthorized("invalid console session"));
    }

    Ok(claims)
}

pub fn require_console_session(
    headers: &HeaderMap,
    config: &Config,
) -> AppResult<ConsoleSessionClaims> {
    require_secure_admin_transport(headers, config)?;
    let token = bearer_token(headers)?;

    decode_console_session_token(&token, config)
}

pub fn optional_bearer_token(headers: &HeaderMap) -> Option<String> {
    let raw_header = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())?;

    let token = raw_header
        .strip_prefix("Bearer ")
        .or_else(|| raw_header.strip_prefix("bearer "))
        .unwrap_or(raw_header)
        .trim();

    if token.is_empty() {
        return None;
    }

    Some(token.to_owned())
}

pub fn bearer_token(headers: &HeaderMap) -> AppResult<String> {
    optional_bearer_token(headers)
        .ok_or_else(|| ApiError::unauthorized("missing Authorization header"))
}

pub fn require_secure_admin_transport(headers: &HeaderMap, config: &Config) -> AppResult<()> {
    if !config.admin_require_secure_transport {
        return Ok(());
    }

    if is_local_request(headers) || is_secure_forwarded_request(headers) {
        return Ok(());
    }

    Err(ApiError::forbidden(
        "admin credentials require HTTPS or a trusted local connection",
    ))
}

fn is_secure_forwarded_request(headers: &HeaderMap) -> bool {
    let forwarded_proto = headers
        .get("x-forwarded-proto")
        .and_then(|value| value.to_str().ok())
        .map(|value| {
            value
                .split(',')
                .next()
                .unwrap_or(value)
                .trim()
                .to_ascii_lowercase()
        });
    if forwarded_proto.as_deref() == Some("https") {
        return true;
    }

    headers
        .get(FORWARDED)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_ascii_lowercase().contains("proto=https"))
        .unwrap_or(false)
}

fn is_local_request(headers: &HeaderMap) -> bool {
    let host = headers
        .get("x-forwarded-host")
        .or_else(|| headers.get(HOST))
        .and_then(|value| value.to_str().ok())
        .map(normalize_host)
        .unwrap_or_default();

    matches!(host.as_str(), "localhost" | "127.0.0.1" | "::1") || host.ends_with(".localhost")
}

fn normalize_host(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    if let Some(stripped) = trimmed.strip_prefix('[') {
        return stripped
            .split(']')
            .next()
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase();
    }

    trimmed
        .split(':')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use axum::http::{HeaderMap, HeaderValue, header::HOST};

    use super::require_secure_admin_transport;
    use crate::config::Config;

    #[test]
    fn allows_insecure_admin_transport_when_config_disabled() {
        let config = Config {
            admin_require_secure_transport: false,
            ..Config::default()
        };
        let headers = HeaderMap::new();

        assert!(require_secure_admin_transport(&headers, &config).is_ok());
    }

    #[test]
    fn allows_local_admin_transport_when_enforced() {
        let config = Config::default();
        let mut headers = HeaderMap::new();
        headers.insert(HOST, HeaderValue::from_static("127.0.0.1:18081"));

        assert!(require_secure_admin_transport(&headers, &config).is_ok());
    }
}

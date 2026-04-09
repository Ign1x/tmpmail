use argon2::{
    Algorithm, Argon2, Params, Version,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
};
use std::time::Duration as StdDuration;

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
    rate_limit::RateLimitPolicy,
    state::AppState,
};

const AUTH_RATE_LIMIT_MESSAGE: &str = "too many authentication attempts; retry later";
const AUTH_RATE_LIMIT_WINDOW: StdDuration = StdDuration::from_secs(10 * 60);
const OTP_SEND_RATE_LIMIT_MESSAGE: &str = "too many verification codes requested; retry later";
const OTP_SEND_RATE_LIMIT_WINDOW: StdDuration = StdDuration::from_secs(10 * 60);

pub const ADMIN_LOGIN_NETWORK_LIMIT: usize = 20;
pub const ADMIN_LOGIN_IDENTITY_LIMIT: usize = 5;
pub const ADMIN_RECOVERY_NETWORK_LIMIT: usize = 10;
pub const ADMIN_RECOVERY_IDENTITY_LIMIT: usize = 5;
pub const MAILBOX_TOKEN_NETWORK_LIMIT: usize = 30;
pub const MAILBOX_TOKEN_IDENTITY_LIMIT: usize = 8;
pub const OTP_SEND_NETWORK_LIMIT: usize = 8;
pub const MIN_PASSWORD_LENGTH: usize = 10;

const ARGON2_MEMORY_KIB: u32 = 19_456;
const ARGON2_ITERATIONS: u32 = 2;
const ARGON2_PARALLELISM: u32 = 1;

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
    #[serde(default)]
    pub session_version: i64,
    pub iat: usize,
    pub exp: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LinuxDoPendingRegistrationClaims {
    pub sub: String,
    pub username: String,
    pub trust_level: u8,
    pub scope: String,
    pub iat: usize,
    pub exp: usize,
}

const LINUX_DO_PENDING_REGISTRATION_SCOPE: &str = "linux-do-pending-registration";
const LINUX_DO_PENDING_REGISTRATION_TTL_SECONDS: i64 = 10 * 60;

pub fn validate_password(password: &str, label: &str) -> AppResult<()> {
    if password.trim().is_empty() {
        return Err(ApiError::validation(format!("{label} must not be empty")));
    }

    if password.chars().count() < MIN_PASSWORD_LENGTH {
        return Err(ApiError::validation(format!(
            "{label} must be at least {MIN_PASSWORD_LENGTH} characters"
        )));
    }

    Ok(())
}

pub fn hash_password(password: &str) -> AppResult<String> {
    let salt = SaltString::generate(&mut OsRng);
    configured_argon2()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|error| ApiError::internal(format!("failed to hash password: {error}")))
}

pub fn verify_password(password: &str, password_hash: &str) -> AppResult<bool> {
    let parsed_hash = PasswordHash::new(password_hash)
        .map_err(|error| ApiError::internal(format!("invalid password hash: {error}")))?;

    Ok(configured_argon2()
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
    session_version: i64,
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
        session_version,
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

pub fn issue_linux_do_pending_registration_token(
    linux_do_user_id: &str,
    linux_do_username: &str,
    trust_level: u8,
    config: &Config,
) -> AppResult<String> {
    let now = Utc::now();
    let claims = LinuxDoPendingRegistrationClaims {
        sub: linux_do_user_id.to_owned(),
        username: linux_do_username.to_owned(),
        trust_level,
        scope: LINUX_DO_PENDING_REGISTRATION_SCOPE.to_owned(),
        iat: now.timestamp() as usize,
        exp: (now + Duration::seconds(LINUX_DO_PENDING_REGISTRATION_TTL_SECONDS)).timestamp()
            as usize,
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(config.jwt_secret.as_bytes()),
    )
    .map_err(|error| {
        ApiError::internal(format!(
            "failed to encode linux.do pending registration token: {error}"
        ))
    })
}

pub fn decode_linux_do_pending_registration_token(
    token: &str,
    config: &Config,
) -> AppResult<LinuxDoPendingRegistrationClaims> {
    let claims = decode::<LinuxDoPendingRegistrationClaims>(
        token,
        &DecodingKey::from_secret(config.jwt_secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|_| ApiError::unauthorized("invalid or expired linux.do pending registration"))?
    .claims;

    if claims.scope != LINUX_DO_PENDING_REGISTRATION_SCOPE {
        return Err(ApiError::unauthorized(
            "invalid or expired linux.do pending registration",
        ));
    }

    Ok(claims)
}

#[derive(Debug)]
pub struct AuthAttemptTicket {
    identity_key: String,
}

pub async fn enforce_auth_attempt_limit(
    state: &AppState,
    headers: &HeaderMap,
    scope: &str,
    identity: &str,
    network_limit: usize,
    identity_limit: usize,
) -> AppResult<AuthAttemptTicket> {
    let network_id = client_network_id(headers, state.config.trust_proxy_headers);
    let normalized_identity = normalize_rate_limit_identity(identity);
    let network_key = format!("{scope}:ip:{network_id}");
    let identity_key = format!("{scope}:identity:{network_id}:{normalized_identity}");
    let network_policy = RateLimitPolicy {
        limit: network_limit,
        window: AUTH_RATE_LIMIT_WINDOW,
    };
    let identity_policy = RateLimitPolicy {
        limit: identity_limit,
        window: AUTH_RATE_LIMIT_WINDOW,
    };

    let mut limiter = state.auth_attempt_limiter.lock().await;
    if !limiter.check_and_record(&network_key, network_policy)
        || !limiter.check_and_record(&identity_key, identity_policy)
    {
        return Err(ApiError::too_many_requests(AUTH_RATE_LIMIT_MESSAGE));
    }

    Ok(AuthAttemptTicket { identity_key })
}

pub async fn clear_auth_attempt_limit(state: &AppState, ticket: AuthAttemptTicket) {
    state
        .auth_attempt_limiter
        .lock()
        .await
        .clear(&ticket.identity_key);
}

pub async fn enforce_otp_send_limit(state: &AppState, headers: &HeaderMap) -> AppResult<()> {
    let network_id = client_network_id(headers, state.config.trust_proxy_headers);
    let network_key = format!("otp-send:ip:{network_id}");
    let policy = RateLimitPolicy {
        limit: OTP_SEND_NETWORK_LIMIT,
        window: OTP_SEND_RATE_LIMIT_WINDOW,
    };

    let mut limiter = state.otp_send_limiter.lock().await;
    if !limiter.check_and_record(&network_key, policy) {
        return Err(ApiError::too_many_requests(OTP_SEND_RATE_LIMIT_MESSAGE));
    }

    Ok(())
}

pub fn client_network_id(headers: &HeaderMap, trust_proxy_headers: bool) -> String {
    if !trust_proxy_headers {
        return "unknown".to_owned();
    }

    headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .and_then(normalize_forwarded_for_value)
        .or_else(|| {
            headers
                .get("x-real-ip")
                .and_then(|value| value.to_str().ok())
                .and_then(normalize_forwarded_for_value)
        })
        .or_else(|| {
            headers
                .get(FORWARDED)
                .and_then(|value| value.to_str().ok())
                .and_then(forwarded_for)
        })
        .unwrap_or_else(|| "unknown".to_owned())
}

pub fn optional_bearer_token(headers: &HeaderMap) -> Option<String> {
    let raw_header = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())?;

    let trimmed = raw_header.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("bearer") {
        return None;
    }

    let token = match trimmed.find(char::is_whitespace) {
        Some(separator) => {
            let (scheme, rest) = trimmed.split_at(separator);
            if scheme.eq_ignore_ascii_case("bearer") {
                rest.trim()
            } else {
                trimmed
            }
        }
        None => trimmed,
    };

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

    if is_local_request(headers)
        || (config.trust_proxy_headers && is_secure_forwarded_request(headers))
    {
        return Ok(());
    }

    Err(ApiError::forbidden(
        "admin credentials require HTTPS or a trusted local connection",
    ))
}

fn is_secure_forwarded_request(headers: &HeaderMap) -> bool {
    let x_forwarded_proto = headers
        .get("x-forwarded-proto")
        .and_then(|value| value.to_str().ok())
        .and_then(first_header_value)
        .map(str::to_ascii_lowercase);
    if x_forwarded_proto.as_deref() == Some("https") {
        return true;
    }

    headers
        .get(FORWARDED)
        .and_then(|value| value.to_str().ok())
        .and_then(forwarded_proto)
        .is_some_and(|value| value.eq_ignore_ascii_case("https"))
}

fn is_local_request(headers: &HeaderMap) -> bool {
    let host = headers
        .get(HOST)
        .and_then(|value| value.to_str().ok())
        .map(normalize_host)
        .unwrap_or_default();

    matches!(host.as_str(), "localhost" | "127.0.0.1" | "::1") || host.ends_with(".localhost")
}

fn normalize_host(value: &str) -> String {
    let trimmed = first_header_value(value).unwrap_or_default();
    if trimmed.is_empty() {
        return String::new();
    }

    if let Some(stripped) = trimmed.strip_prefix('[') {
        return stripped
            .split(']')
            .next()
            .unwrap_or_default()
            .trim()
            .trim_end_matches('.')
            .to_ascii_lowercase();
    }

    let normalized = if let Some((host, port)) = trimmed.rsplit_once(':') {
        if !host.contains(':') && !port.is_empty() && port.chars().all(|ch| ch.is_ascii_digit()) {
            host
        } else {
            trimmed
        }
    } else {
        trimmed
    };

    normalized.trim().trim_end_matches('.').to_ascii_lowercase()
}

fn first_header_value(value: &str) -> Option<&str> {
    let first = value
        .split(',')
        .next()
        .unwrap_or(value)
        .trim()
        .trim_matches('"');
    if first.is_empty() { None } else { Some(first) }
}

fn normalize_forwarded_for_value(value: &str) -> Option<String> {
    let trimmed = first_header_value(value)?;
    if trimmed.eq_ignore_ascii_case("unknown") {
        return None;
    }

    let normalized = if let Some(stripped) = trimmed.strip_prefix('[') {
        stripped
            .split(']')
            .next()
            .unwrap_or_default()
            .trim()
            .trim_end_matches('.')
            .to_ascii_lowercase()
    } else if let Some((host, port)) = trimmed.rsplit_once(':') {
        if !host.contains(':') && !port.is_empty() && port.chars().all(|ch| ch.is_ascii_digit()) {
            host.trim().trim_end_matches('.').to_ascii_lowercase()
        } else {
            trimmed.trim().trim_end_matches('.').to_ascii_lowercase()
        }
    } else {
        trimmed.trim().trim_end_matches('.').to_ascii_lowercase()
    };

    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn forwarded_proto(value: &str) -> Option<String> {
    let first = first_header_value(value)?;
    for parameter in first.split(';') {
        let Some((name, raw_value)) = parameter.split_once('=') else {
            continue;
        };
        if name.trim().eq_ignore_ascii_case("proto") {
            let proto = raw_value.trim().trim_matches('"');
            if !proto.is_empty() {
                return Some(proto.to_ascii_lowercase());
            }
        }
    }

    None
}

fn configured_argon2() -> Argon2<'static> {
    let params = Params::new(
        ARGON2_MEMORY_KIB,
        ARGON2_ITERATIONS,
        ARGON2_PARALLELISM,
        None,
    )
    .expect("argon2 params should stay valid");

    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
}

fn forwarded_for(value: &str) -> Option<String> {
    let first = first_header_value(value)?;
    for parameter in first.split(';') {
        let Some((name, raw_value)) = parameter.split_once('=') else {
            continue;
        };
        if name.trim().eq_ignore_ascii_case("for") {
            if let Some(normalized) = normalize_forwarded_for_value(raw_value.trim()) {
                return Some(normalized);
            }
        }
    }

    None
}

fn normalize_rate_limit_identity(value: &str) -> String {
    let normalized = value
        .trim()
        .to_ascii_lowercase()
        .chars()
        .take(128)
        .collect::<String>();
    if normalized.is_empty() {
        "anonymous".to_owned()
    } else {
        normalized
    }
}

#[cfg(test)]
mod tests {
    use axum::http::{
        HeaderMap, HeaderValue,
        header::{AUTHORIZATION, HOST},
    };

    use super::{
        LINUX_DO_PENDING_REGISTRATION_SCOPE, client_network_id,
        decode_linux_do_pending_registration_token, hash_password,
        issue_linux_do_pending_registration_token, optional_bearer_token,
        require_secure_admin_transport, validate_password,
    };
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

    #[test]
    fn allows_localhost_hostnames_with_trailing_dot() {
        let config = Config::default();
        let mut headers = HeaderMap::new();
        headers.insert(HOST, HeaderValue::from_static("app.localhost.:3000"));

        assert!(require_secure_admin_transport(&headers, &config).is_ok());
    }

    #[test]
    fn allows_secure_forwarded_proto_with_whitespace_and_case_variants() {
        let config = Config {
            trust_proxy_headers: true,
            ..Config::default()
        };
        let mut headers = HeaderMap::new();
        headers.insert(HOST, HeaderValue::from_static("admin.example.com"));
        headers.insert(
            "x-forwarded-proto",
            HeaderValue::from_static(" HTTPS , http "),
        );

        assert!(require_secure_admin_transport(&headers, &config).is_ok());
    }

    #[test]
    fn allows_secure_forwarded_header_proto() {
        let config = Config {
            trust_proxy_headers: true,
            ..Config::default()
        };
        let mut headers = HeaderMap::new();
        headers.insert(HOST, HeaderValue::from_static("admin.example.com"));
        headers.insert(
            "forwarded",
            HeaderValue::from_static("for=192.0.2.60; proto=\"https\";host=\"admin.example.com\""),
        );

        assert!(require_secure_admin_transport(&headers, &config).is_ok());
    }

    #[test]
    fn ignores_secure_forwarded_proto_when_proxy_trust_is_disabled() {
        let config = Config::default();
        let mut headers = HeaderMap::new();
        headers.insert(HOST, HeaderValue::from_static("admin.example.com"));
        headers.insert("x-forwarded-proto", HeaderValue::from_static("https"));

        let error = require_secure_admin_transport(&headers, &config)
            .expect_err("forwarded proto should be ignored by default");

        assert_eq!(
            error.to_string(),
            "admin credentials require HTTPS or a trusted local connection"
        );
    }

    #[test]
    fn rejects_spoofed_forwarded_host_without_https() {
        let config = Config {
            trust_proxy_headers: true,
            ..Config::default()
        };
        let mut headers = HeaderMap::new();
        headers.insert(HOST, HeaderValue::from_static("admin.example.com"));
        headers.insert("x-forwarded-host", HeaderValue::from_static("127.0.0.1"));

        let error = require_secure_admin_transport(&headers, &config)
            .expect_err("forwarded host alone should not bypass secure transport");

        assert_eq!(
            error.to_string(),
            "admin credentials require HTTPS or a trusted local connection"
        );
    }

    #[test]
    fn bearer_token_accepts_uppercase_scheme() {
        let mut headers = HeaderMap::new();
        headers.insert(AUTHORIZATION, HeaderValue::from_static("BEARER token-123"));

        assert_eq!(
            optional_bearer_token(&headers).as_deref(),
            Some("token-123")
        );
    }

    #[test]
    fn bearer_token_rejects_empty_bearer_value() {
        let mut headers = HeaderMap::new();
        headers.insert(AUTHORIZATION, HeaderValue::from_static("Bearer   "));

        assert!(optional_bearer_token(&headers).is_none());
    }

    #[test]
    fn client_network_id_prefers_x_forwarded_for() {
        let config = Config {
            trust_proxy_headers: true,
            ..Config::default()
        };
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-forwarded-for",
            HeaderValue::from_static("198.51.100.24, 10.0.0.3"),
        );

        assert_eq!(
            client_network_id(&headers, config.trust_proxy_headers),
            "198.51.100.24"
        );
    }

    #[test]
    fn client_network_id_reads_standard_forwarded_header() {
        let config = Config {
            trust_proxy_headers: true,
            ..Config::default()
        };
        let mut headers = HeaderMap::new();
        headers.insert(
            "forwarded",
            HeaderValue::from_static("for=\"[2001:db8::1]\"; proto=https"),
        );

        assert_eq!(
            client_network_id(&headers, config.trust_proxy_headers),
            "2001:db8::1"
        );
    }

    #[test]
    fn client_network_id_ignores_proxy_headers_by_default() {
        let config = Config::default();
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-forwarded-for",
            HeaderValue::from_static("198.51.100.24, 10.0.0.3"),
        );

        assert_eq!(
            client_network_id(&headers, config.trust_proxy_headers),
            "unknown"
        );
    }

    #[test]
    fn password_validation_enforces_new_minimum_length() {
        let error = validate_password("short123", "password")
            .expect_err("short password should be rejected");

        assert_eq!(error.to_string(), "password must be at least 10 characters");
    }

    #[test]
    fn password_hashes_use_pinned_argon2id_parameters() {
        let hash = hash_password("PinnedPassword123!")
            .expect("password should hash with configured argon2 params");

        assert!(hash.starts_with("$argon2id$"));
        assert!(hash.contains("m=19456,t=2,p=1"));
    }

    #[test]
    fn linux_do_pending_registration_tokens_round_trip() {
        let config = Config::default();
        let token =
            issue_linux_do_pending_registration_token("linuxdo-123", "test-user", 3, &config)
                .expect("issue pending registration token");

        let claims = decode_linux_do_pending_registration_token(&token, &config)
            .expect("decode pending registration token");

        assert_eq!(claims.sub, "linuxdo-123");
        assert_eq!(claims.username, "test-user");
        assert_eq!(claims.trust_level, 3);
        assert_eq!(claims.scope, LINUX_DO_PENDING_REGISTRATION_SCOPE);
    }
}

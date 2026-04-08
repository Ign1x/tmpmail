use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use rand_core::{OsRng, RngCore};
use uuid::Uuid;

use crate::{
    admin_state, auth,
    error::{ApiError, AppResult},
    models::{
        Account, CreateAccountRequest, HydraCollection, SendEmailOtpRequest, SendEmailOtpResponse,
        TokenRequest, TokenResponse,
    },
    otp::normalize_email_key,
    routes::admin::{send_email_otp, verify_email_otp},
    state::AppState,
};

pub async fn list_accounts(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<HydraCollection<Account>>> {
    let user = admin_state::require_console_access(&headers, &state).await?;
    let accounts = state.store.list_accounts_for_owner(user.id).await?;
    let total = accounts.len();

    Ok(Json(HydraCollection::new(accounts, total)))
}

pub async fn create_account(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateAccountRequest>,
) -> AppResult<(StatusCode, Json<Account>)> {
    if let Some(user) = admin_state::optional_console_user(&headers, &state).await {
        let (system_enabled, mailbox_limit) = {
            let admin_state = state.admin_state.read().await;
            (admin_state.is_system_enabled(), admin_state.mailbox_limit())
        };
        if !system_enabled && !user.is_admin() {
            return Err(ApiError::forbidden("system is disabled by administrator"));
        }

        let domain = payload
            .address
            .rsplit_once('@')
            .map(|(_, domain)| domain.trim().to_ascii_lowercase())
            .unwrap_or_default();
        let matching_domain = state
            .store
            .list_all_domains()
            .await?
            .into_iter()
            .find(|item| item.domain == domain);
        if let Some(domain_record) = matching_domain
            && domain_record.owner_user_id.as_deref() != Some(&user.id.to_string())
            && domain_record.owner_user_id.is_some()
            && !user.is_admin()
        {
            return Err(ApiError::forbidden(
                "you do not have access to this mailbox domain",
            ));
        }
        if !user.is_admin() {
            let owned_accounts = state.store.count_accounts_owned_by(user.id).await?;
            if owned_accounts >= mailbox_limit as usize {
                return Err(ApiError::validation(
                    "mailbox limit has been reached for this user",
                ));
            }
        }
        let mailbox_password = payload
            .password
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(generate_hidden_mailbox_password);

        let account = state
            .store
            .create_account_for_owner(
                &payload.address,
                &mailbox_password,
                payload.expires_in,
                Some(user.id),
            )
            .await?;
        return Ok((StatusCode::CREATED, Json(account)));
    }

    let normalized_address = normalize_email_key(&payload.address)?;
    let (system_enabled, registration_enabled, domain_allowed, email_otp_settings) = {
        let admin_state = state.admin_state.read().await;
        let domain = normalized_address
            .rsplit_once('@')
            .map(|(_, domain)| domain)
            .unwrap_or_default();
        (
            admin_state.is_system_enabled(),
            admin_state.is_public_registration_enabled(),
            admin_state.is_domain_allowed_for_public_registration(domain),
            admin_state.registration_settings().email_otp,
        )
    };
    if !system_enabled {
        return Err(ApiError::forbidden("system is disabled by administrator"));
    }
    if !registration_enabled {
        return Err(ApiError::forbidden(
            "public registration is disabled by administrator",
        ));
    }
    if !domain_allowed {
        return Err(ApiError::validation(
            "selected domain is not available for public registration",
        ));
    }
    if email_otp_settings.enabled {
        verify_email_otp(&state, &normalized_address, payload.otp_code.as_deref()).await?;
    }

    let password = payload
        .password
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::validation("password must not be empty"))?;
    let account = state
        .store
        .create_account(&normalized_address, password, payload.expires_in)
        .await?;

    Ok((StatusCode::CREATED, Json(account)))
}

pub async fn send_account_otp(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<SendEmailOtpRequest>,
) -> AppResult<(StatusCode, Json<SendEmailOtpResponse>)> {
    let normalized_address = normalize_email_key(&payload.email)?;
    let (system_enabled, registration_enabled, domain_allowed, email_otp_settings) = {
        let admin_state = state.admin_state.read().await;
        let domain = normalized_address
            .rsplit_once('@')
            .map(|(_, domain)| domain)
            .unwrap_or_default();
        (
            admin_state.is_system_enabled(),
            admin_state.is_public_registration_enabled(),
            admin_state.is_domain_allowed_for_public_registration(domain),
            admin_state.registration_settings().email_otp,
        )
    };

    if !system_enabled {
        return Err(ApiError::forbidden("system is disabled by administrator"));
    }
    if !registration_enabled {
        return Err(ApiError::forbidden(
            "public registration is disabled by administrator",
        ));
    }
    if !domain_allowed {
        return Err(ApiError::validation(
            "selected domain is not available for public registration",
        ));
    }
    if !email_otp_settings.enabled {
        return Err(ApiError::forbidden("email otp is disabled"));
    }

    send_email_otp(&state, &headers, &normalized_address, &email_otp_settings).await?;

    Ok((
        StatusCode::ACCEPTED,
        Json(SendEmailOtpResponse {
            expires_in_seconds: email_otp_settings.ttl_seconds,
            cooldown_seconds: email_otp_settings.cooldown_seconds,
        }),
    ))
}

fn generate_hidden_mailbox_password() -> String {
    const CHARSET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    let mut bytes = [0u8; 18];
    OsRng.fill_bytes(&mut bytes);

    bytes
        .iter()
        .map(|byte| CHARSET[usize::from(*byte) % CHARSET.len()] as char)
        .collect()
}

pub async fn issue_token(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<TokenRequest>,
) -> AppResult<Json<TokenResponse>> {
    let rate_limit_ticket = auth::enforce_auth_attempt_limit(
        &state,
        &headers,
        "mailbox-token",
        &payload.address,
        auth::MAILBOX_TOKEN_NETWORK_LIMIT,
        auth::MAILBOX_TOKEN_IDENTITY_LIMIT,
    )
    .await?;
    let (account_id, address) = state
        .store
        .authenticate(&payload.address, &payload.password)
        .await?;
    auth::clear_auth_attempt_limit(&state, rate_limit_ticket).await;
    let token = auth::issue_token(account_id, &address, &state.config)?;

    Ok(Json(TokenResponse {
        token,
        id: account_id.to_string(),
    }))
}

pub async fn me(State(state): State<AppState>, headers: HeaderMap) -> AppResult<Json<Account>> {
    let account_id = auth::account_id_from_headers(&headers, &state.config)?;
    let account = state.store.get_account(account_id).await?;

    Ok(Json(account))
}

pub async fn issue_owned_account_token(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> AppResult<Json<TokenResponse>> {
    let user = admin_state::require_console_access(&headers, &state).await?;
    let account_id =
        Uuid::parse_str(&id).map_err(|_| ApiError::validation("invalid account id"))?;
    let owner_user_id = state.store.account_owner_user_id(account_id).await?;
    if owner_user_id != Some(user.id) {
        return Err(ApiError::forbidden(
            "you do not have access to this mailbox account",
        ));
    }

    let account = state.store.get_account(account_id).await?;
    let token = auth::issue_token(account_id, &account.address, &state.config)?;

    Ok(Json(TokenResponse {
        token,
        id: account.id,
    }))
}

pub async fn delete_account(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> AppResult<StatusCode> {
    let target_account_id =
        Uuid::parse_str(&id).map_err(|_| ApiError::validation("invalid account id"))?;

    if let Some(user) = admin_state::optional_console_user(&headers, &state).await {
        let owner_user_id = state.store.account_owner_user_id(target_account_id).await?;
        if owner_user_id != Some(user.id) {
            return Err(ApiError::forbidden(
                "you do not have access to this mailbox account",
            ));
        }

        state.store.delete_account(target_account_id).await?;
        return Ok(StatusCode::NO_CONTENT);
    }

    let authenticated_account_id = auth::account_id_from_headers(&headers, &state.config)?;

    if authenticated_account_id != target_account_id {
        return Err(ApiError::forbidden(
            "token does not belong to the target account",
        ));
    }

    state.store.delete_account(target_account_id).await?;

    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use serde_json::json;
    use tower::ServiceExt;

    use super::*;
    use crate::{app::build_router, config::Config, rate_limit::RateLimitPolicy};

    const TEST_PUBLIC_DOMAIN: &str = "mailbox-rate-limit.example.com";

    #[tokio::test]
    async fn mailbox_token_rate_limit_returns_too_many_requests() {
        let state = test_state(Config {
            public_domains: vec![TEST_PUBLIC_DOMAIN.to_owned()],
            ..Config::default()
        })
        .await;
        create_account(
            &state,
            "alice@mailbox-rate-limit.example.com",
            "correct12345",
        )
        .await;
        let app = build_router(state);

        for _ in 0..auth::MAILBOX_TOKEN_IDENTITY_LIMIT {
            let response = app
                .clone()
                .oneshot(json_request(
                    "/token",
                    json!({
                        "address": "alice@mailbox-rate-limit.example.com",
                        "password": "wrong123"
                    }),
                    Some("198.51.100.42"),
                ))
                .await
                .expect("token response");
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        }

        let response = app
            .oneshot(json_request(
                "/token",
                json!({
                    "address": "alice@mailbox-rate-limit.example.com",
                    "password": "wrong123"
                }),
                Some("198.51.100.42"),
            ))
            .await
            .expect("rate limited token response");

        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    #[tokio::test]
    async fn send_account_otp_rate_limit_returns_too_many_requests() {
        let state = test_state(Config {
            public_domains: vec![TEST_PUBLIC_DOMAIN.to_owned()],
            ..Config::default()
        })
        .await;
        enable_email_otp(&state).await;
        saturate_otp_send_limit(&state, "198.51.100.52").await;

        let response = build_router(state)
            .oneshot(json_request(
                "/accounts/otp",
                json!({
                    "email": "alice@mailbox-rate-limit.example.com"
                }),
                Some("198.51.100.52"),
            ))
            .await
            .expect("otp response");

        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    async fn test_state(config: Config) -> AppState {
        let config = Config {
            cleanup_interval_seconds: 0,
            domain_verification_poll_interval_seconds: 0,
            ..config
        };

        crate::test_support::build_test_state(config, "routes-accounts").await
    }

    async fn create_account(state: &AppState, address: &str, password: &str) {
        state
            .store
            .create_account(address, password, None)
            .await
            .expect("create account");
    }

    async fn enable_email_otp(state: &AppState) {
        let mut admin_state = state.admin_state.write().await;
        let mut registration_settings = admin_state.registration_settings();
        registration_settings.email_otp.enabled = true;
        admin_state
            .update_system_settings(
                None,
                None,
                None,
                None,
                None,
                Some(registration_settings),
                None,
                None,
            )
            .expect("enable email otp");
    }

    async fn saturate_otp_send_limit(state: &AppState, network_id: &str) {
        let mut limiter = state.otp_send_limiter.lock().await;
        let policy = RateLimitPolicy {
            limit: auth::OTP_SEND_NETWORK_LIMIT,
            window: Duration::from_secs(10 * 60),
        };
        let key = format!("otp-send:ip:{network_id}");
        for _ in 0..auth::OTP_SEND_NETWORK_LIMIT {
            assert!(limiter.check_and_record(&key, policy));
        }
    }

    fn json_request(
        path: &str,
        payload: serde_json::Value,
        forwarded_for: Option<&str>,
    ) -> Request<Body> {
        let mut request = Request::builder()
            .method("POST")
            .uri(path)
            .header("content-type", "application/json");
        if let Some(forwarded_for) = forwarded_for {
            request = request.header("x-forwarded-for", forwarded_for);
        }

        request
            .body(Body::from(payload.to_string()))
            .expect("build json request")
    }
}

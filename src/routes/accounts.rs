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
    let mut store = state.store.lock().await;
    let accounts = store.list_accounts_for_owner(user.id).await?;
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
        let mut store = state.store.lock().await;
        let matching_domain = store
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
            let owned_accounts = store.count_accounts_owned_by(user.id).await?;
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

        let account = store
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

    let mut store = state.store.lock().await;
    let password = payload
        .password
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::validation("password must not be empty"))?;
    let account = store
        .create_account(&normalized_address, password, payload.expires_in)
        .await?;

    Ok((StatusCode::CREATED, Json(account)))
}

pub async fn send_account_otp(
    State(state): State<AppState>,
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

    send_email_otp(&state, &normalized_address, &email_otp_settings).await?;

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
    Json(payload): Json<TokenRequest>,
) -> AppResult<Json<TokenResponse>> {
    let mut store = state.store.lock().await;
    let (account_id, address) = store
        .authenticate(&payload.address, &payload.password)
        .await?;
    let token = auth::issue_token(account_id, &address, &state.config)?;

    Ok(Json(TokenResponse {
        token,
        id: account_id.to_string(),
    }))
}

pub async fn me(State(state): State<AppState>, headers: HeaderMap) -> AppResult<Json<Account>> {
    let account_id = auth::account_id_from_headers(&headers, &state.config)?;
    let mut store = state.store.lock().await;
    let account = store.get_account(account_id).await?;

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
    let mut store = state.store.lock().await;
    let owner_user_id = store.account_owner_user_id(account_id).await?;
    if owner_user_id != Some(user.id) {
        return Err(ApiError::forbidden(
            "you do not have access to this mailbox account",
        ));
    }

    let account = store.get_account(account_id).await?;
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
        let mut store = state.store.lock().await;
        let owner_user_id = store.account_owner_user_id(target_account_id).await?;
        if owner_user_id != Some(user.id) {
            return Err(ApiError::forbidden(
                "you do not have access to this mailbox account",
            ));
        }

        store.delete_account(target_account_id).await?;
        return Ok(StatusCode::NO_CONTENT);
    }

    let authenticated_account_id = auth::account_id_from_headers(&headers, &state.config)?;

    if authenticated_account_id != target_account_id {
        return Err(ApiError::forbidden(
            "token does not belong to the target account",
        ));
    }

    let mut store = state.store.lock().await;
    store.delete_account(target_account_id).await?;

    Ok(StatusCode::NO_CONTENT)
}

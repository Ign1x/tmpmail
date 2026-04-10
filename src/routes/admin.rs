use axum::{
    Json,
    extract::{Path, Query, State},
    http::{
        HeaderMap, HeaderName, HeaderValue, StatusCode,
        header::{CACHE_CONTROL, PRAGMA},
    },
    response::IntoResponse,
};
use reqwest::Url;
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use crate::{
    admin_state::{self, default_email_otp_body, default_email_otp_subject},
    auth, cloudflare,
    error::{ApiError, AppResult},
    mailer::MailSender,
    models::{
        AdminAccessKeyInfoResponse, AdminAccessKeyListResponse, AdminAccessKeyResponse,
        AdminBootstrapRequest, AdminCreateAccessKeyRequest, AdminCreateInviteCodeRequest,
        AdminCreateUserRequest, AdminInviteCodeListResponse, AdminInviteCodeResponse,
        AdminPasswordChangeRequest, AdminRecoveryRequest, AdminResetUserPasswordRequest,
        AdminSessionInfo, AdminSessionResponse, AdminSetupResponse, AdminStatusResponse,
        AdminSystemSettings, AdminUpdateInviteCodeRequest, AdminUpdateSystemSettingsRequest,
        AdminUpdateUserRequest, CloudflareTokenValidationResponse, ConsoleCloudflareSettings,
        ConsoleRegisterRequest, ConsoleUser, ConsoleUserRole, LinuxDoAuthorizeRequest,
        LinuxDoAuthorizeResponse, LinuxDoCompleteRequest, LinuxDoCompleteResponse,
        SendEmailOtpRequest, SendEmailOtpResponse, TestConsoleCloudflareTokenRequest,
        UpdateConsoleCloudflareSettingsRequest,
    },
    otp::normalize_email_key,
    state::AppState,
};

#[derive(Debug, Deserialize)]
struct LinuxDoTokenResponse {
    access_token: String,
}

#[derive(Debug, Deserialize)]
struct LinuxDoUserInfoResponse {
    id: Value,
    #[serde(default)]
    username: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    trust_level: Option<u8>,
}

impl LinuxDoUserInfoResponse {
    fn subject(&self) -> Option<String> {
        match &self.id {
            Value::String(value) => Some(value.trim().to_owned()).filter(|value| !value.is_empty()),
            Value::Number(value) => Some(value.to_string()),
            _ => None,
        }
    }

    fn preferred_username(&self) -> Option<String> {
        self.username
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .or_else(|| {
                self.name
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToOwned::to_owned)
            })
    }
}

struct LinuxDoResolvedIdentity {
    subject: String,
    preferred_username: String,
    trust_level: u8,
}

pub async fn status(State(state): State<AppState>) -> AppResult<Json<AdminStatusResponse>> {
    let admin_state = state.admin_state.read().await;
    let registration_settings = admin_state.registration_settings();
    let linux_do_enabled = registration_settings.linux_do.enabled
        && !registration_settings.email_otp.enabled
        && registration_settings
            .linux_do
            .client_id
            .as_deref()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false)
        && registration_settings.linux_do.client_secret_configured;
    let linux_do_callback_url = registration_settings
        .linux_do
        .callback_url
        .filter(|value| !value.trim().is_empty());

    Ok(Json(AdminStatusResponse {
        is_bootstrap_required: admin_state.is_bootstrap_required(),
        users_total: admin_state.users_total(),
        admin_users_total: admin_state.admin_users_total(),
        is_recovery_enabled: state
            .config
            .admin_recovery_token
            .as_deref()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false),
        system_enabled: admin_state.is_system_enabled(),
        open_registration_enabled: registration_settings.open_registration_enabled,
        console_invite_code_required: registration_settings.console_invite_code_required,
        linux_do_enabled,
        linux_do_callback_url,
        email_otp_enabled: registration_settings.email_otp.enabled,
    }))
}

pub async fn linux_do_authorize(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(payload): Query<LinuxDoAuthorizeRequest>,
) -> AppResult<Json<LinuxDoAuthorizeResponse>> {
    auth::require_secure_admin_transport(&headers, &state.config)?;
    let registration_settings = {
        let admin_state = state.admin_state.read().await;
        if admin_state.is_bootstrap_required() {
            return Err(ApiError::forbidden("console bootstrap required"));
        }
        admin_state.registration_settings()
    };

    if !registration_settings.open_registration_enabled {
        return Err(ApiError::forbidden(
            "public console registration is disabled",
        ));
    }
    if registration_settings.email_otp.enabled {
        return Err(ApiError::forbidden(
            "linux.do registration is unavailable while email otp is enabled",
        ));
    }
    let linux_do = registration_settings.linux_do;
    if !linux_do.enabled {
        return Err(ApiError::forbidden("linux.do registration is disabled"));
    }

    let client_id = linux_do
        .client_id
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::forbidden("linux.do auth is not configured"))?;
    let authorize_url = linux_do
        .authorize_url
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::forbidden("linux.do auth is not configured"))?;
    let redirect_uri = normalize_linux_do_redirect_uri(
        &payload.redirect_uri,
        &headers,
        linux_do.callback_url.as_deref(),
        state.config.trust_proxy_headers,
    )?;
    let state_value = normalize_linux_do_state(&payload.state)?;

    let mut authorization_url = Url::parse(&authorize_url)
        .map_err(|error| ApiError::internal(format!("invalid linux.do authorize url: {error}")))?;
    authorization_url
        .query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", &client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("state", &state_value);

    Ok(Json(LinuxDoAuthorizeResponse {
        authorization_url: authorization_url.to_string(),
    }))
}

pub async fn setup(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<AdminBootstrapRequest>,
) -> AppResult<impl IntoResponse> {
    auth::require_secure_admin_transport(&headers, &state.config)?;
    let (user, api_key) = {
        let mut admin_state = state.admin_state.write().await;
        admin_state.bootstrap_first_admin(&payload.username, &payload.password)?
    };
    let session = load_session_info(&state, &user.id).await?;
    let session_token = issue_session_token(&state, &session.user).await?;

    state
        .store
        .append_audit_log(
            "console.bootstrap",
            "console-user",
            user.id.clone(),
            Some(user.id.clone()),
            format!("username={} role=admin", user.username),
        )
        .await?;

    Ok((
        StatusCode::CREATED,
        sensitive_headers(),
        Json(AdminSetupResponse {
            session_token,
            api_key,
            session,
        }),
    ))
}

pub async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<crate::models::AdminLoginRequest>,
) -> AppResult<impl IntoResponse> {
    auth::require_secure_admin_transport(&headers, &state.config)?;
    let rate_limit_ticket = auth::enforce_auth_attempt_limit(
        &state,
        &headers,
        "admin-login",
        &payload.username,
        auth::ADMIN_LOGIN_NETWORK_LIMIT,
        auth::ADMIN_LOGIN_IDENTITY_LIMIT,
    )
    .await?;
    let authenticated = {
        let mut admin_state = state.admin_state.write().await;
        admin_state.authenticate(&payload.username, &payload.password)?
    };
    auth::clear_auth_attempt_limit(&state, rate_limit_ticket).await;
    let session = load_session_info(&state, &authenticated.id.to_string()).await?;
    let session_token = issue_session_token(&state, &session.user).await?;

    state
        .store
        .append_audit_log(
            "console.login",
            "console-user",
            authenticated.id.to_string(),
            Some(authenticated.id.to_string()),
            format!(
                "username={} role={}",
                authenticated.username,
                role_label(&authenticated.role)
            ),
        )
        .await?;

    Ok((
        sensitive_headers(),
        Json(AdminSessionResponse {
            session_token,
            session,
        }),
    ))
}

pub async fn register(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<ConsoleRegisterRequest>,
) -> AppResult<impl IntoResponse> {
    auth::require_secure_admin_transport(&headers, &state.config)?;
    let registration_identity = payload
        .email
        .as_deref()
        .or(payload.username.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::validation("registration email is required"))?;
    let registration_email = normalize_email_key(registration_identity)?;
    let (require_email_otp, invite_code_required) = {
        let admin_state = state.admin_state.read().await;
        let registration_settings = admin_state.registration_settings();
        (
            registration_settings.email_otp.enabled,
            registration_settings.console_invite_code_required,
        )
    };
    if invite_code_required {
        let invite_code = payload
            .invite_code
            .as_deref()
            .ok_or_else(|| ApiError::validation("invite code is required"))?;
        let admin_state = state.admin_state.read().await;
        admin_state.validate_invite_code(invite_code)?;
    }
    if require_email_otp {
        verify_email_otp(&state, &registration_email, payload.otp_code.as_deref()).await?;
    }
    let user = {
        let mut admin_state = state.admin_state.write().await;
        if admin_state.is_bootstrap_required() {
            return Err(ApiError::forbidden("console bootstrap required"));
        }
        if !admin_state.is_public_registration_enabled() {
            return Err(ApiError::forbidden(
                "public console registration is disabled",
            ));
        }

        let domain_limit = admin_state.default_public_domain_limit();
        admin_state.create_public_user(
            registration_identity,
            &payload.password,
            domain_limit,
            payload.invite_code.as_deref(),
        )?
    };
    let session = load_session_info(&state, &user.id).await?;
    let session_token = issue_session_token(&state, &session.user).await?;

    state
        .store
        .append_audit_log(
            "console.register",
            "console-user",
            user.id.clone(),
            None,
            format!("username={} role=user", user.username),
        )
        .await?;

    Ok((
        StatusCode::CREATED,
        sensitive_headers(),
        Json(AdminSessionResponse {
            session_token,
            session,
        }),
    ))
}

pub async fn send_register_otp(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<SendEmailOtpRequest>,
) -> AppResult<(StatusCode, Json<SendEmailOtpResponse>)> {
    auth::require_secure_admin_transport(&headers, &state.config)?;
    let (registration_enabled, otp_enabled, invite_code_required, settings) = {
        let admin_state = state.admin_state.read().await;
        if admin_state.is_bootstrap_required() {
            return Err(ApiError::forbidden("console bootstrap required"));
        }
        let registration_settings = admin_state.registration_settings();
        (
            registration_settings.open_registration_enabled,
            registration_settings.email_otp.enabled,
            registration_settings.console_invite_code_required,
            registration_settings.email_otp,
        )
    };

    if !registration_enabled {
        return Err(ApiError::forbidden(
            "public console registration is disabled",
        ));
    }
    if !otp_enabled {
        return Err(ApiError::forbidden("email otp is disabled"));
    }
    if invite_code_required {
        let invite_code = payload
            .invite_code
            .as_deref()
            .ok_or_else(|| ApiError::validation("invite code is required"))?;
        let admin_state = state.admin_state.read().await;
        admin_state.validate_invite_code(invite_code)?;
    }

    let email = normalize_email_key(&payload.email)?;
    send_email_otp(&state, &headers, &email, &settings).await?;

    Ok((
        StatusCode::ACCEPTED,
        Json(SendEmailOtpResponse {
            expires_in_seconds: settings.ttl_seconds,
            cooldown_seconds: settings.cooldown_seconds,
        }),
    ))
}

pub async fn linux_do_complete(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<LinuxDoCompleteRequest>,
) -> AppResult<impl IntoResponse> {
    auth::require_secure_admin_transport(&headers, &state.config)?;
    let registration_settings = {
        let admin_state = state.admin_state.read().await;
        if admin_state.is_bootstrap_required() {
            return Err(ApiError::forbidden("console bootstrap required"));
        }
        admin_state.registration_settings()
    };

    if !registration_settings.open_registration_enabled {
        return Err(ApiError::forbidden(
            "public console registration is disabled",
        ));
    }
    if registration_settings.email_otp.enabled {
        return Err(ApiError::forbidden(
            "linux.do registration is unavailable while email otp is enabled",
        ));
    }

    let linux_do = registration_settings.linux_do;
    if !linux_do.enabled {
        return Err(ApiError::forbidden("linux.do registration is disabled"));
    }

    let identity = if let Some(pending_token) = payload
        .pending_token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let claims =
            auth::decode_linux_do_pending_registration_token(pending_token, &state.config)?;
        LinuxDoResolvedIdentity {
            subject: claims.sub,
            preferred_username: claims.username,
            trust_level: claims.trust_level,
        }
    } else {
        complete_linux_do_identity_from_code(&state, &headers, &payload, &linux_do).await?
    };

    let authenticated = {
        let mut admin_state = state.admin_state.write().await;
        admin_state.authenticate_linux_do(
            &identity.subject,
            &identity.preferred_username,
            identity.trust_level,
            payload.invite_code.as_deref(),
        )
    };
    let authenticated = match authenticated {
        Ok(authenticated) => authenticated,
        Err(error) if is_linux_do_invite_code_error(&error) => {
            let pending_token = auth::issue_linux_do_pending_registration_token(
                &identity.subject,
                &identity.preferred_username,
                identity.trust_level,
                &state.config,
            )?;
            return Ok((
                sensitive_headers(),
                Json(LinuxDoCompleteResponse::InviteCodeRequired {
                    pending_token,
                    message: Some(error.to_string()),
                }),
            ));
        }
        Err(error) => return Err(error),
    };
    let session = load_session_info(&state, &authenticated.id.to_string()).await?;
    let session_token = issue_session_token(&state, &session.user).await?;

    state
        .store
        .append_audit_log(
            "console.login.linux_do",
            "console-user",
            authenticated.id.to_string(),
            None,
            format!(
                "linux_do_user_id={} linux_do_username={} trust_level={trust_level}",
                identity.subject,
                identity.preferred_username,
                trust_level = identity.trust_level
            ),
        )
        .await?;

    Ok((
        sensitive_headers(),
        Json(LinuxDoCompleteResponse::Authenticated {
            session_token,
            session,
        }),
    ))
}

async fn complete_linux_do_identity_from_code(
    state: &AppState,
    headers: &HeaderMap,
    payload: &LinuxDoCompleteRequest,
    linux_do: &crate::models::LinuxDoAuthSettings,
) -> AppResult<LinuxDoResolvedIdentity> {
    let client_id = linux_do
        .client_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::forbidden("linux.do auth is not configured"))?;
    let client_secret = linux_do
        .client_secret
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::forbidden("linux.do auth is not configured"))?;
    let token_url = linux_do
        .token_url
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::forbidden("linux.do auth is not configured"))?;
    let userinfo_url = linux_do
        .userinfo_url
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::forbidden("linux.do auth is not configured"))?;
    let redirect_uri = normalize_linux_do_redirect_uri(
        &payload.redirect_uri,
        headers,
        linux_do.callback_url.as_deref(),
        state.config.trust_proxy_headers,
    )?;
    let code = payload
        .code
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::validation("linux.do authorization code is required"))?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(
            state.config.http_request_timeout_seconds.max(5) as u64,
        ))
        .build()
        .map_err(|error| ApiError::internal(format!("failed to build linux.do client: {error}")))?;

    let token_response = client
        .post(token_url)
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("redirect_uri", redirect_uri.as_str()),
        ])
        .send()
        .await
        .map_err(|error| ApiError::internal(format!("linux.do token exchange failed: {error}")))?;

    if !token_response.status().is_success() {
        let status = token_response.status();
        let detail = truncate_upstream_error(token_response.text().await.unwrap_or_default());
        return Err(ApiError::forbidden(format!(
            "linux.do token exchange failed ({status}): {detail}"
        )));
    }

    let token_payload = token_response
        .json::<LinuxDoTokenResponse>()
        .await
        .map_err(|error| ApiError::internal(format!("invalid linux.do token response: {error}")))?;
    let access_token = token_payload.access_token.trim();
    if access_token.is_empty() {
        return Err(ApiError::forbidden(
            "linux.do returned an empty access token",
        ));
    }

    let userinfo_response = client
        .get(userinfo_url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|error| {
            ApiError::internal(format!("linux.do userinfo request failed: {error}"))
        })?;

    if !userinfo_response.status().is_success() {
        let status = userinfo_response.status();
        let detail = truncate_upstream_error(userinfo_response.text().await.unwrap_or_default());
        return Err(ApiError::forbidden(format!(
            "linux.do userinfo request failed ({status}): {detail}"
        )));
    }

    let userinfo = userinfo_response
        .json::<LinuxDoUserInfoResponse>()
        .await
        .map_err(|error| {
            ApiError::internal(format!("invalid linux.do userinfo response: {error}"))
        })?;
    let subject = userinfo
        .subject()
        .ok_or_else(|| ApiError::forbidden("linux.do user id is missing"))?;
    let preferred_username = userinfo
        .preferred_username()
        .ok_or_else(|| ApiError::forbidden("linux.do username is missing"))?;

    Ok(LinuxDoResolvedIdentity {
        subject,
        preferred_username,
        trust_level: userinfo.trust_level.unwrap_or(0),
    })
}

fn is_linux_do_invite_code_error(error: &ApiError) -> bool {
    matches!(
        error,
        ApiError::Validation(message)
            if matches!(
                message.as_str(),
                "invite code is required"
                    | "invite code is invalid"
                    | "invite code is disabled"
                    | "invite code has been exhausted"
            )
    )
}

pub async fn session(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<impl IntoResponse> {
    let user = admin_state::require_console_session_user(&headers, &state).await?;
    let session = load_session_info(&state, &user.id.to_string()).await?;

    Ok((sensitive_headers(), Json(session)))
}

pub async fn recover(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<AdminRecoveryRequest>,
) -> AppResult<impl IntoResponse> {
    auth::require_secure_admin_transport(&headers, &state.config)?;
    let configured_token = state
        .config
        .admin_recovery_token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::forbidden("admin recovery is not configured"))?;
    let username = payload.username.as_deref().unwrap_or("admin");
    let rate_limit_ticket = auth::enforce_auth_attempt_limit(
        &state,
        &headers,
        "admin-recover",
        username,
        auth::ADMIN_RECOVERY_NETWORK_LIMIT,
        auth::ADMIN_RECOVERY_IDENTITY_LIMIT,
    )
    .await?;
    if payload.recovery_token.trim() != configured_token {
        return Err(ApiError::unauthorized("invalid admin recovery token"));
    }

    let (user, api_key) = {
        let mut admin_state = state.admin_state.write().await;
        admin_state.reset_password_with_recovery(username, &payload.new_password)?
    };
    auth::clear_auth_attempt_limit(&state, rate_limit_ticket).await;
    let session = load_session_info(&state, &user.id).await?;
    let session_token = issue_session_token(&state, &session.user).await?;

    state
        .store
        .append_audit_log(
            "console.recover",
            "console-user",
            user.id.clone(),
            Some(user.id.clone()),
            format!("username={} password recovered", user.username),
        )
        .await?;

    Ok((
        sensitive_headers(),
        Json(AdminSetupResponse {
            session_token,
            api_key,
            session,
        }),
    ))
}

pub async fn access_key(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<impl IntoResponse> {
    let user = admin_state::require_console_session_user(&headers, &state).await?;
    let user_id = user.id;
    let key = {
        let admin_state = state.admin_state.read().await;
        admin_state
            .latest_api_key(user_id)?
            .ok_or_else(|| ApiError::not_found("access key not found"))?
    };

    Ok((
        sensitive_headers(),
        Json(AdminAccessKeyInfoResponse { key }),
    ))
}

pub async fn regenerate_access_key(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<impl IntoResponse> {
    let user = admin_state::require_console_session_user(&headers, &state).await?;
    let user_id = user.id;
    let (key, api_key) = {
        let mut admin_state = state.admin_state.write().await;
        admin_state.create_api_key(user_id, None)?
    };
    state
        .store
        .append_audit_log(
            "console.access_key.regenerate",
            "console-user",
            user_id.to_string(),
            Some(user_id.to_string()),
            "rotated console api key".to_owned(),
        )
        .await?;

    Ok((
        sensitive_headers(),
        Json(AdminAccessKeyResponse { key, api_key }),
    ))
}

pub async fn list_access_keys(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<AdminAccessKeyListResponse>> {
    let user = admin_state::require_console_session_user(&headers, &state).await?;
    let user_id = user.id;
    let admin_state = state.admin_state.read().await;

    Ok(Json(AdminAccessKeyListResponse {
        keys: admin_state.list_api_keys(user_id)?,
        limit: admin_state.api_key_limit(),
    }))
}

pub async fn create_access_key(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<AdminCreateAccessKeyRequest>,
) -> AppResult<impl IntoResponse> {
    let user = admin_state::require_console_session_user(&headers, &state).await?;
    let user_id = user.id;
    let (key, api_key) = {
        let mut admin_state = state.admin_state.write().await;
        admin_state.create_api_key(user_id, payload.name.as_deref())?
    };
    state
        .store
        .append_audit_log(
            "console.access_key.create",
            "console-user",
            user_id.to_string(),
            Some(user_id.to_string()),
            format!("created access key id={} name={}", key.id, key.name),
        )
        .await?;

    Ok((
        StatusCode::CREATED,
        sensitive_headers(),
        Json(AdminAccessKeyResponse { key, api_key }),
    ))
}

pub async fn delete_access_key(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> AppResult<StatusCode> {
    let user = admin_state::require_console_session_user(&headers, &state).await?;
    let user_id = user.id;
    let key_id = Uuid::parse_str(&id).map_err(|_| ApiError::validation("invalid access key id"))?;
    let deleted = {
        let mut admin_state = state.admin_state.write().await;
        admin_state.delete_api_key(user_id, key_id)?
    };
    state
        .store
        .append_audit_log(
            "console.access_key.delete",
            "console-user",
            user_id.to_string(),
            Some(user_id.to_string()),
            format!("deleted access key id={} name={}", deleted.id, deleted.name),
        )
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn list_invite_codes(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<AdminInviteCodeListResponse>> {
    admin_state::require_admin_access(&headers, &state).await?;
    let admin_state = state.admin_state.read().await;

    Ok(Json(AdminInviteCodeListResponse {
        codes: admin_state.list_invite_codes(),
    }))
}

pub async fn create_invite_code(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<AdminCreateInviteCodeRequest>,
) -> AppResult<impl IntoResponse> {
    let actor = admin_state::require_admin_access(&headers, &state).await?;
    let (code, invite_code) = {
        let mut admin_state = state.admin_state.write().await;
        admin_state.create_invite_code(payload.name.as_deref(), payload.max_uses)?
    };
    state
        .store
        .append_audit_log(
            "console.invite_code.create",
            "invite-code",
            code.id.clone(),
            Some(actor.id.to_string()),
            format!(
                "name={} masked_code={} max_uses={:?}",
                code.name, code.masked_code, code.max_uses
            ),
        )
        .await?;

    Ok((
        StatusCode::CREATED,
        sensitive_headers(),
        Json(AdminInviteCodeResponse { code, invite_code }),
    ))
}

pub async fn update_invite_code(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<AdminUpdateInviteCodeRequest>,
) -> AppResult<Json<crate::models::AdminInviteCode>> {
    let actor = admin_state::require_admin_access(&headers, &state).await?;
    let invite_code_id =
        Uuid::parse_str(&id).map_err(|_| ApiError::validation("invalid invite code id"))?;
    let updated = {
        let mut admin_state = state.admin_state.write().await;
        admin_state.update_invite_code(invite_code_id, payload.is_disabled)?
    };
    state
        .store
        .append_audit_log(
            "console.invite_code.update",
            "invite-code",
            updated.id.clone(),
            Some(actor.id.to_string()),
            format!(
                "name={} masked_code={} disabled={} uses={}",
                updated.name, updated.masked_code, updated.is_disabled, updated.uses_count
            ),
        )
        .await?;

    Ok(Json(updated))
}

pub async fn delete_invite_code(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> AppResult<StatusCode> {
    let actor = admin_state::require_admin_access(&headers, &state).await?;
    let invite_code_id =
        Uuid::parse_str(&id).map_err(|_| ApiError::validation("invalid invite code id"))?;
    let deleted = {
        let mut admin_state = state.admin_state.write().await;
        admin_state.delete_invite_code(invite_code_id)?
    };
    state
        .store
        .append_audit_log(
            "console.invite_code.delete",
            "invite-code",
            deleted.id.clone(),
            Some(actor.id.to_string()),
            format!("name={} masked_code={}", deleted.name, deleted.masked_code),
        )
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn change_password(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<AdminPasswordChangeRequest>,
) -> AppResult<impl IntoResponse> {
    let user = admin_state::require_console_session_user(&headers, &state).await?;
    let user_id = user.id;
    {
        let mut admin_state = state.admin_state.write().await;
        admin_state.change_password(user_id, &payload.current_password, &payload.new_password)?;
    }
    state
        .store
        .append_audit_log(
            "console.password.change",
            "console-user",
            user_id.to_string(),
            Some(user_id.to_string()),
            "console password updated".to_owned(),
        )
        .await?;

    Ok((StatusCode::NO_CONTENT, sensitive_headers()))
}

pub async fn list_users(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<Vec<ConsoleUser>>> {
    admin_state::require_admin_access(&headers, &state).await?;
    let admin_state = state.admin_state.read().await;
    Ok(Json(admin_state.list_users()))
}

pub async fn create_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<AdminCreateUserRequest>,
) -> AppResult<(StatusCode, Json<ConsoleUser>)> {
    let actor = admin_state::require_admin_access(&headers, &state).await?;
    let user = {
        let mut admin_state = state.admin_state.write().await;
        admin_state.create_user(
            &payload.username,
            &payload.password,
            payload.role,
            payload.domain_limit,
        )?
    };
    state
        .store
        .append_audit_log(
            "console.user.create",
            "console-user",
            user.id.clone(),
            Some(actor.id.to_string()),
            format!("username={} role={}", user.username, role_label(&user.role)),
        )
        .await?;

    Ok((StatusCode::CREATED, Json(user)))
}

pub async fn update_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<AdminUpdateUserRequest>,
) -> AppResult<Json<ConsoleUser>> {
    let actor = admin_state::require_admin_access(&headers, &state).await?;
    let user_id =
        Uuid::parse_str(&id).map_err(|_| ApiError::validation("invalid console user id"))?;
    let user = {
        let mut admin_state = state.admin_state.write().await;
        admin_state.update_user(
            user_id,
            payload.username.as_deref(),
            payload.role,
            payload.domain_limit,
            payload.is_disabled,
        )?
    };
    state
        .store
        .append_audit_log(
            "console.user.update",
            "console-user",
            user.id.clone(),
            Some(actor.id.to_string()),
            format!("username={} role={}", user.username, role_label(&user.role)),
        )
        .await?;

    Ok(Json(user))
}

pub async fn reset_user_password(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<AdminResetUserPasswordRequest>,
) -> AppResult<StatusCode> {
    let actor = admin_state::require_admin_access(&headers, &state).await?;
    let user_id =
        Uuid::parse_str(&id).map_err(|_| ApiError::validation("invalid console user id"))?;
    {
        let mut admin_state = state.admin_state.write().await;
        admin_state.reset_user_password(user_id, &payload.new_password)?;
    }
    state
        .store
        .append_audit_log(
            "console.user.password.reset",
            "console-user",
            user_id.to_string(),
            Some(actor.id.to_string()),
            "password reset by administrator".to_owned(),
        )
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn delete_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> AppResult<StatusCode> {
    let actor = admin_state::require_admin_access(&headers, &state).await?;
    let user_id =
        Uuid::parse_str(&id).map_err(|_| ApiError::validation("invalid console user id"))?;

    let owned_domains = state.store.count_domains_owned_by(user_id).await?;
    if owned_domains > 0 {
        return Err(ApiError::validation(
            "console user still owns managed domains",
        ));
    }
    let owned_accounts = state.store.count_accounts_owned_by(user_id).await?;
    if owned_accounts > 0 {
        return Err(ApiError::validation(
            "console user still owns mailbox accounts",
        ));
    }

    {
        let mut admin_state = state.admin_state.write().await;
        admin_state.delete_user(user_id)?;
    }
    state
        .store
        .append_audit_log(
            "console.user.delete",
            "console-user",
            user_id.to_string(),
            Some(actor.id.to_string()),
            "console user deleted".to_owned(),
        )
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn get_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<AdminSystemSettings>> {
    admin_state::require_admin_access(&headers, &state).await?;
    let config = state.effective_runtime_config().await;
    let admin_state = state.admin_state.read().await;
    Ok(Json(admin_state.effective_system_settings(&config)))
}

pub async fn update_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<AdminUpdateSystemSettingsRequest>,
) -> AppResult<Json<AdminSystemSettings>> {
    let actor = admin_state::require_admin_access(&headers, &state).await?;
    let settings = {
        let mut admin_state = state.admin_state.write().await;
        admin_state.update_system_settings(
            payload.system_enabled,
            payload.mail_exchange_host.as_deref(),
            payload.mail_route_target.as_deref(),
            payload.domain_txt_prefix.as_deref(),
            payload.branding,
            payload.smtp,
            payload.registration_settings,
            payload.user_limits,
            payload.update_notice,
        )?
    };
    state
        .store
        .append_audit_log(
            "console.settings.update",
            "system-settings",
            "default".to_owned(),
            Some(actor.id.to_string()),
            format!(
            "system_enabled={} mail_exchange_host={:?} mail_route_target={:?} domain_txt_prefix={:?} branding_name={:?} branding_logo_url={:?} smtp_host={:?} smtp_port={} smtp_security={:?} smtp_username={:?} smtp_from_address={:?} smtp_password_configured={} open_registration_enabled={} console_invite_code_required={} allowed_email_suffixes={:?} email_otp_enabled={} linux_do_enabled={} default_domain_limit={} mailbox_limit={} api_key_limit={} update_notice_version={:?}",
                settings.system_enabled,
                settings.mail_exchange_host,
                settings.mail_route_target,
                settings.domain_txt_prefix,
                settings.branding.name,
                settings.branding.logo_url,
                settings.smtp.host,
                settings.smtp.port,
                settings.smtp.security,
                settings.smtp.username,
                settings.smtp.from_address,
                settings.smtp.password_configured,
                settings
                    .registration_settings
                    .open_registration_enabled,
                settings
                    .registration_settings
                    .console_invite_code_required,
                settings.registration_settings.allowed_email_suffixes,
                settings.registration_settings.email_otp.enabled,
                settings.registration_settings.linux_do.enabled,
                settings.user_limits.default_domain_limit,
                settings.user_limits.mailbox_limit,
                settings.user_limits.api_key_limit,
                settings
                    .update_notice
                    .as_ref()
                    .map(|notice| notice.version.as_str()),
            ),
        )
        .await?;

    Ok(Json(effective_system_settings(&state).await))
}

pub async fn get_cloudflare_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<ConsoleCloudflareSettings>> {
    let actor = admin_state::require_console_access(&headers, &state).await?;
    let admin_state = state.admin_state.read().await;
    Ok(Json(admin_state.cloudflare_settings(actor.id)?))
}

pub async fn update_cloudflare_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<UpdateConsoleCloudflareSettingsRequest>,
) -> AppResult<Json<ConsoleCloudflareSettings>> {
    let actor = admin_state::require_console_access(&headers, &state).await?;
    let settings = {
        let mut admin_state = state.admin_state.write().await;
        admin_state.update_cloudflare_settings(
            actor.id,
            payload.enabled,
            payload.api_token,
            payload.auto_sync_enabled,
        )?
    };
    state
        .store
        .append_audit_log(
            "console.cloudflare.update",
            "console-user",
            actor.id.to_string(),
            Some(actor.id.to_string()),
            format!(
                "enabled={} api_token_configured={} auto_sync_enabled={}",
                settings.enabled, settings.api_token_configured, settings.auto_sync_enabled
            ),
        )
        .await?;

    Ok(Json(settings))
}

pub async fn test_cloudflare_token(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<TestConsoleCloudflareTokenRequest>,
) -> AppResult<Json<CloudflareTokenValidationResponse>> {
    let actor = admin_state::require_console_access(&headers, &state).await?;
    let api_token = if let Some(api_token) = payload
        .api_token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
    {
        api_token
    } else {
        let admin_state = state.admin_state.read().await;
        admin_state
            .cloudflare_api_token(actor.id)?
            .ok_or_else(|| ApiError::validation("cloudflare api token is not configured"))?
    };

    let response = cloudflare::validate_api_token(
        &api_token,
        std::time::Duration::from_secs(state.config.http_request_timeout_seconds.max(5) as u64),
    )
    .await?;

    Ok(Json(response))
}

async fn load_session_info(state: &AppState, user_id: &str) -> AppResult<AdminSessionInfo> {
    let user_id =
        Uuid::parse_str(user_id).map_err(|_| ApiError::unauthorized("invalid console session"))?;
    let config = state.effective_runtime_config().await;
    let admin_state = state.admin_state.read().await;
    Ok(AdminSessionInfo {
        user: admin_state.current_user(user_id)?,
        system_settings: admin_state.effective_system_settings(&config),
    })
}

async fn effective_system_settings(state: &AppState) -> AdminSystemSettings {
    let config = state.effective_runtime_config().await;
    let admin_state = state.admin_state.read().await;
    admin_state.effective_system_settings(&config)
}

async fn issue_session_token(state: &AppState, user: &ConsoleUser) -> AppResult<String> {
    let user_id =
        Uuid::parse_str(&user.id).map_err(|_| ApiError::unauthorized("invalid console user"))?;
    let admin_state = state.admin_state.read().await;
    let session_version = admin_state.current_session_version(user_id)?;
    auth::issue_console_session_token(
        user_id,
        &user.username,
        &user.role,
        session_version,
        &state.config,
    )
}

fn role_label(role: &ConsoleUserRole) -> &'static str {
    match role {
        ConsoleUserRole::Admin => "admin",
        ConsoleUserRole::User => "user",
    }
}

fn sensitive_headers() -> [(HeaderName, HeaderValue); 2] {
    [
        (CACHE_CONTROL, HeaderValue::from_static("no-store, private")),
        (PRAGMA, HeaderValue::from_static("no-cache")),
    ]
}

fn normalize_linux_do_redirect_uri(
    value: &str,
    headers: &HeaderMap,
    configured_callback_url: Option<&str>,
    trust_proxy_headers: bool,
) -> AppResult<String> {
    let normalized = normalize_linux_do_callback_url(value)?;
    let parsed = Url::parse(&normalized)
        .map_err(|_| ApiError::validation("linux.do redirect uri is invalid"))?;

    if let Some(allowed) = configured_callback_url {
        let allowed = normalize_linux_do_callback_url(allowed)?;
        if normalized != allowed {
            return Err(ApiError::validation(
                "linux.do redirect uri is not allowlisted",
            ));
        }
        return Ok(normalized);
    }

    let request_origin = request_origin_from_headers(headers, trust_proxy_headers)?;
    if parsed.origin().ascii_serialization() != request_origin {
        return Err(ApiError::validation(
            "linux.do redirect uri must match the current admin origin",
        ));
    }

    Ok(normalized)
}

fn normalize_linux_do_callback_url(value: &str) -> AppResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ApiError::validation("linux.do redirect uri is required"));
    }
    if trimmed.chars().any(char::is_whitespace) {
        return Err(ApiError::validation("linux.do redirect uri is invalid"));
    }

    let parsed = Url::parse(trimmed)
        .map_err(|_| ApiError::validation("linux.do redirect uri is invalid"))?;
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(ApiError::validation("linux.do redirect uri is invalid"));
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err(ApiError::validation("linux.do redirect uri is invalid"));
    }

    match parsed.scheme() {
        "https" => Ok(parsed.to_string()),
        "http" if is_local_linux_do_host(parsed.host_str()) => Ok(parsed.to_string()),
        _ => Err(ApiError::validation("linux.do redirect uri is invalid")),
    }
}

fn normalize_linux_do_state(value: &str) -> AppResult<String> {
    let trimmed = value.trim();
    if trimmed.len() < 32
        || trimmed.len() > 128
        || trimmed.chars().any(char::is_whitespace)
        || !trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err(ApiError::validation("linux.do state is invalid"));
    }

    Ok(trimmed.to_owned())
}

fn truncate_upstream_error(value: String) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return "upstream request failed".to_owned();
    }

    let shortened = trimmed.chars().take(180).collect::<String>();
    if shortened.len() < trimmed.len() {
        format!("{shortened}...")
    } else {
        shortened
    }
}

fn request_origin_from_headers(
    headers: &HeaderMap,
    trust_proxy_headers: bool,
) -> AppResult<String> {
    let authority = request_authority_from_headers(headers, trust_proxy_headers)
        .ok_or_else(|| ApiError::validation("linux.do redirect uri is invalid"))?;
    let scheme = forwarded_proto_from_headers(headers, trust_proxy_headers).unwrap_or_else(|| {
        if is_local_linux_do_host(Some(&authority)) {
            "http".to_owned()
        } else {
            "https".to_owned()
        }
    });

    let parsed = Url::parse(&format!("{scheme}://{authority}"))
        .map_err(|_| ApiError::validation("linux.do redirect uri is invalid"))?;

    Ok(parsed.origin().ascii_serialization())
}

fn request_authority_from_headers(
    headers: &HeaderMap,
    trust_proxy_headers: bool,
) -> Option<String> {
    if trust_proxy_headers {
        forwarded_host_from_headers(headers).or_else(|| host_from_headers(headers))
    } else {
        host_from_headers(headers)
    }
}

fn host_from_headers(headers: &HeaderMap) -> Option<String> {
    headers
        .get("host")
        .and_then(|value| value.to_str().ok())
        .and_then(parse_authority_header_value)
}

fn forwarded_host_from_headers(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-forwarded-host")
        .and_then(|value| value.to_str().ok())
        .and_then(parse_authority_header_value)
        .or_else(|| {
            headers
                .get("forwarded")
                .and_then(|value| value.to_str().ok())
                .and_then(forwarded_host)
        })
}

fn parse_authority_header_value(value: &str) -> Option<String> {
    first_header_value(value)
        .map(str::trim)
        .filter(|value| {
            !value.is_empty() && !value.chars().any(char::is_whitespace) && !value.contains('/')
        })
        .map(ToOwned::to_owned)
}

fn forwarded_proto_from_headers(headers: &HeaderMap, trust_proxy_headers: bool) -> Option<String> {
    if !trust_proxy_headers {
        return None;
    }

    headers
        .get("x-forwarded-proto")
        .and_then(|value| value.to_str().ok())
        .and_then(first_header_value)
        .map(str::to_ascii_lowercase)
        .or_else(|| {
            headers
                .get("forwarded")
                .and_then(|value| value.to_str().ok())
                .and_then(forwarded_proto)
        })
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

fn forwarded_host(value: &str) -> Option<String> {
    let first = first_header_value(value)?;
    for parameter in first.split(';') {
        let Some((name, raw_value)) = parameter.split_once('=') else {
            continue;
        };
        if name.trim().eq_ignore_ascii_case("host") {
            return parse_authority_header_value(raw_value.trim().trim_matches('"'));
        }
    }

    None
}

fn is_local_linux_do_host(host: Option<&str>) -> bool {
    let Some(host) = host else {
        return false;
    };
    let trimmed = host.trim();
    let without_port = if let Some(stripped) = trimmed.strip_prefix('[') {
        stripped.split(']').next().unwrap_or_default()
    } else if let Some((host_part, port)) = trimmed.rsplit_once(':') {
        if !host_part.contains(':')
            && !port.is_empty()
            && port.chars().all(|ch| ch.is_ascii_digit())
        {
            host_part
        } else {
            trimmed
        }
    } else {
        trimmed
    };
    let normalized = without_port
        .trim()
        .trim_end_matches('.')
        .to_ascii_lowercase();
    matches!(normalized.as_str(), "localhost" | "127.0.0.1" | "::1")
        || normalized.ends_with(".localhost")
}

pub(crate) async fn send_email_otp(
    state: &AppState,
    headers: &HeaderMap,
    email: &str,
    settings: &crate::models::AdminEmailOtpSettings,
) -> AppResult<()> {
    if !settings.enabled {
        return Err(ApiError::forbidden("email otp is disabled"));
    }
    auth::enforce_otp_send_limit(state, headers).await?;

    let effective_config = state.effective_runtime_config().await;
    let mail_sender = MailSender::from_config(&effective_config)
        .ok_or_else(|| ApiError::forbidden("email otp delivery is not configured"))?;
    let code = state
        .otp_store
        .issue_code(email, settings.ttl_seconds, settings.cooldown_seconds)
        .await?;
    let subject = settings
        .subject
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(default_email_otp_subject);
    let body_template = settings
        .body
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(default_email_otp_body);
    let body = render_otp_body(&body_template, &code, settings.ttl_seconds);

    if let Err(error) = mail_sender.send_text_email(email, &subject, &body).await {
        let _ = state.otp_store.verify_and_consume(email, &code).await;
        return Err(error);
    }

    Ok(())
}

pub(crate) async fn verify_email_otp(
    state: &AppState,
    email: &str,
    otp_code: Option<&str>,
) -> AppResult<()> {
    let otp_code = otp_code.ok_or_else(|| ApiError::validation("verification code is required"))?;
    state.otp_store.verify_and_consume(email, otp_code).await
}

fn render_otp_body(template: &str, code: &str, ttl_seconds: u32) -> String {
    template
        .replace("{{code}}", code)
        .replace("{{ttlSeconds}}", &ttl_seconds.to_string())
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use axum::{
        body::{Body, to_bytes},
        http::{HeaderMap, HeaderValue, Request, StatusCode},
    };
    use serde_json::{Value, json};
    use tower::ServiceExt;

    use super::*;
    use crate::{app::build_router, config::Config, rate_limit::RateLimitPolicy};

    #[tokio::test]
    async fn login_rate_limit_returns_too_many_requests() {
        let state = test_state(Config::default()).await;
        bootstrap_admin(&state, "correct12345").await;
        let app = build_router(state);

        for _ in 0..auth::ADMIN_LOGIN_IDENTITY_LIMIT {
            let response = app
                .clone()
                .oneshot(json_request(
                    "/admin/login",
                    json!({ "username": "admin", "password": "wrong123" }),
                ))
                .await
                .expect("login response");
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        }

        let response = app
            .oneshot(json_request(
                "/admin/login",
                json!({ "username": "admin", "password": "wrong123" }),
            ))
            .await
            .expect("rate limited login response");

        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    #[tokio::test]
    async fn recover_rate_limit_returns_too_many_requests() {
        let state = test_state(Config {
            admin_recovery_token: Some("recover-secret".to_owned()),
            ..Config::default()
        })
        .await;
        bootstrap_admin(&state, "correct12345").await;
        let app = build_router(state);

        for _ in 0..auth::ADMIN_RECOVERY_IDENTITY_LIMIT {
            let response = app
                .clone()
                .oneshot(json_request(
                    "/admin/recover",
                    json!({
                        "username": "admin",
                        "recoveryToken": "wrong-secret",
                        "newPassword": "fresh12345"
                    }),
                ))
                .await
                .expect("recovery response");
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        }

        let response = app
            .oneshot(json_request(
                "/admin/recover",
                json!({
                    "username": "admin",
                    "recoveryToken": "wrong-secret",
                    "newPassword": "fresh12345"
                }),
            ))
            .await
            .expect("rate limited recovery response");

        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    #[tokio::test]
    async fn send_register_otp_rate_limit_returns_too_many_requests() {
        let state = test_state(Config {
            trust_proxy_headers: true,
            ..Config::default()
        })
        .await;
        bootstrap_admin(&state, "correct12345").await;
        enable_email_otp(&state).await;
        saturate_otp_send_limit(&state, "198.51.100.90").await;

        let response = build_router(state)
            .oneshot(json_request_with_forwarded_for(
                "/admin/register/otp",
                json!({ "email": "user@example.com" }),
                "198.51.100.90",
            ))
            .await
            .expect("otp response");

        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    #[tokio::test]
    async fn password_change_revokes_existing_session() {
        let state = test_state(Config::default()).await;
        let user = bootstrap_admin(&state, "correct12345").await;
        let session_token = issue_session_token(&state, &user)
            .await
            .expect("issue initial session token");
        let app = build_router(state.clone());

        let response = app
            .clone()
            .oneshot(json_request_with_bearer(
                "/admin/password",
                json!({
                    "currentPassword": "correct12345",
                    "newPassword": "fresh12345"
                }),
                &session_token,
            ))
            .await
            .expect("password change response");
        assert_eq!(response.status(), StatusCode::NO_CONTENT);

        let response = app
            .oneshot(session_request(&session_token))
            .await
            .expect("session response");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn recovery_revokes_old_session_and_returns_fresh_session() {
        let state = test_state(Config {
            admin_recovery_token: Some("recover-secret".to_owned()),
            ..Config::default()
        })
        .await;
        let user = bootstrap_admin(&state, "correct12345").await;
        let old_session_token = issue_session_token(&state, &user)
            .await
            .expect("issue initial session token");
        let app = build_router(state.clone());

        let response = app
            .clone()
            .oneshot(json_request(
                "/admin/recover",
                json!({
                    "username": "admin",
                    "recoveryToken": "recover-secret",
                    "newPassword": "renewed12345"
                }),
            ))
            .await
            .expect("recovery response");
        assert_eq!(response.status(), StatusCode::OK);
        let body = read_json_body(response).await;
        let new_session_token = body
            .get("sessionToken")
            .and_then(Value::as_str)
            .expect("session token in recovery response")
            .to_owned();

        let old_response = app
            .clone()
            .oneshot(session_request(&old_session_token))
            .await
            .expect("old session response");
        assert_eq!(old_response.status(), StatusCode::UNAUTHORIZED);

        let new_response = app
            .oneshot(session_request(&new_session_token))
            .await
            .expect("new session response");
        assert_eq!(new_response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn get_access_key_returns_existing_key_without_creating_new_one() {
        let state = test_state(Config::default()).await;
        let user = bootstrap_admin(&state, "correct12345").await;
        let session_token = issue_session_token(&state, &user)
            .await
            .expect("issue session token");
        let user_id = Uuid::parse_str(&user.id).expect("user uuid");
        let before_count = {
            let admin_state = state.admin_state.read().await;
            admin_state
                .list_api_keys(user_id)
                .expect("list existing access keys")
                .len()
        };

        let response = build_router(state.clone())
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/admin/access-key")
                    .header("host", "localhost")
                    .header("authorization", format!("Bearer {session_token}"))
                    .body(Body::empty())
                    .expect("build access-key request"),
            )
            .await
            .expect("access-key response");
        assert_eq!(response.status(), StatusCode::OK);
        let body = read_json_body(response).await;
        assert!(body.get("key").is_some());
        assert!(body.get("apiKey").is_none());

        let after_count = {
            let admin_state = state.admin_state.read().await;
            admin_state
                .list_api_keys(user_id)
                .expect("list access keys after get")
                .len()
        };
        assert_eq!(before_count, after_count);
    }

    #[tokio::test]
    async fn linux_do_authorize_does_not_require_invite_code_upfront() {
        let state = test_state(Config::default()).await;
        bootstrap_admin(&state, "correct12345").await;
        configure_linux_do_registration(&state, true).await;

        let response = build_router(state)
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/admin/linux-do/authorize?redirectUri=http%3A%2F%2Flocalhost%2Fzh%2Fauth%2Flinux-do&state=0123456789abcdef0123456789abcdef")
                    .header("host", "localhost")
                    .body(Body::empty())
                    .expect("build linux.do authorize request"),
            )
            .await
            .expect("linux.do authorize response");

        assert_eq!(response.status(), StatusCode::OK);
        let body = read_json_body(response).await;
        assert!(body.get("authorizationUrl").is_some());
    }

    #[tokio::test]
    async fn linux_do_complete_returns_pending_token_until_new_user_supplies_invite_code() {
        let state = test_state(Config::default()).await;
        bootstrap_admin(&state, "correct12345").await;
        configure_linux_do_registration(&state, true).await;
        let pending_token = auth::issue_linux_do_pending_registration_token(
            "linuxdo-1001",
            "fresh-user",
            1,
            &state.config,
        )
        .expect("issue pending token");

        let initial_response = build_router(state.clone())
            .oneshot(json_request(
                "/admin/linux-do/complete",
                json!({
                    "redirectUri": "http://localhost/zh/auth/linux-do",
                    "pendingToken": pending_token,
                }),
            ))
            .await
            .expect("initial linux.do complete response");

        assert_eq!(initial_response.status(), StatusCode::OK);
        let initial_body = read_json_body(initial_response).await;
        assert_eq!(
            initial_body.get("status").and_then(Value::as_str),
            Some("inviteCodeRequired")
        );
        let followup_token = initial_body
            .get("pendingToken")
            .and_then(Value::as_str)
            .expect("followup pending token")
            .to_owned();

        let invite_code = create_test_invite_code(&state).await;
        let completed_response = build_router(state.clone())
            .oneshot(json_request(
                "/admin/linux-do/complete",
                json!({
                    "redirectUri": "http://localhost/zh/auth/linux-do",
                    "pendingToken": followup_token,
                    "inviteCode": invite_code,
                }),
            ))
            .await
            .expect("completed linux.do response");

        assert_eq!(completed_response.status(), StatusCode::OK);
        let completed_body = read_json_body(completed_response).await;
        assert_eq!(
            completed_body.get("status").and_then(Value::as_str),
            Some("authenticated")
        );
        assert!(completed_body.get("sessionToken").is_some());

        let admin_state = state.admin_state.read().await;
        assert_eq!(admin_state.users_total(), 2);
    }

    #[tokio::test]
    async fn linux_do_complete_allows_existing_user_without_invite_code() {
        let state = test_state(Config::default()).await;
        bootstrap_admin(&state, "correct12345").await;
        configure_linux_do_registration(&state, false).await;
        {
            let mut admin_state = state.admin_state.write().await;
            admin_state
                .authenticate_linux_do("linuxdo-2002", "existing-user", 2, None)
                .expect("seed linux.do user");
        }
        configure_linux_do_registration(&state, true).await;
        let pending_token = auth::issue_linux_do_pending_registration_token(
            "linuxdo-2002",
            "existing-user",
            2,
            &state.config,
        )
        .expect("issue existing-user pending token");

        let response = build_router(state)
            .oneshot(json_request(
                "/admin/linux-do/complete",
                json!({
                    "redirectUri": "http://localhost/zh/auth/linux-do",
                    "pendingToken": pending_token,
                }),
            ))
            .await
            .expect("existing-user linux.do complete response");

        assert_eq!(response.status(), StatusCode::OK);
        let body = read_json_body(response).await;
        assert_eq!(
            body.get("status").and_then(Value::as_str),
            Some("authenticated")
        );
        assert!(body.get("sessionToken").is_some());
    }

    #[tokio::test]
    async fn linux_do_complete_rejects_trust_level_below_minimum() {
        let state = test_state(Config::default()).await;
        bootstrap_admin(&state, "correct12345").await;
        configure_linux_do_registration(&state, false).await;
        {
            let mut admin_state = state.admin_state.write().await;
            let mut registration_settings = admin_state.registration_settings();
            registration_settings.linux_do.minimum_trust_level = 2;
            admin_state
                .update_system_settings(
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    Some(registration_settings),
                    None,
                    None,
                )
                .expect("raise linux.do minimum trust level");
        }
        let pending_token = auth::issue_linux_do_pending_registration_token(
            "linuxdo-3003",
            "low-trust-user",
            1,
            &state.config,
        )
        .expect("issue low-trust pending token");

        let response = build_router(state.clone())
            .oneshot(json_request(
                "/admin/linux-do/complete",
                json!({
                    "redirectUri": "http://localhost/zh/auth/linux-do",
                    "pendingToken": pending_token,
                }),
            ))
            .await
            .expect("low-trust linux.do response");

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let admin_state = state.admin_state.read().await;
        assert_eq!(admin_state.users_total(), 1);
    }

    #[test]
    fn linux_do_redirect_uri_requires_allowlisted_callback_match() {
        let mut headers = HeaderMap::new();
        headers.insert("host", HeaderValue::from_static("localhost"));

        let error = normalize_linux_do_redirect_uri(
            "http://localhost/auth/linux-do",
            &headers,
            Some("http://localhost/console/auth/linux-do"),
            false,
        )
        .expect_err("mismatched callback should fail");

        assert_eq!(
            error.to_string(),
            "linux.do redirect uri is not allowlisted"
        );
    }

    #[test]
    fn linux_do_redirect_uri_requires_same_origin_without_allowlist() {
        let mut headers = HeaderMap::new();
        headers.insert("host", HeaderValue::from_static("console.example.com"));
        headers.insert("x-forwarded-proto", HeaderValue::from_static("https"));

        normalize_linux_do_redirect_uri(
            "https://console.example.com/zh/auth/linux-do",
            &headers,
            None,
            true,
        )
        .expect("same-origin callback should pass");

        let error = normalize_linux_do_redirect_uri(
            "https://evil.example.com/zh/auth/linux-do",
            &headers,
            None,
            true,
        )
        .expect_err("foreign callback should fail");

        assert_eq!(
            error.to_string(),
            "linux.do redirect uri must match the current admin origin"
        );
    }

    #[test]
    fn linux_do_redirect_uri_accepts_trusted_forwarded_host() {
        let mut headers = HeaderMap::new();
        headers.insert("host", HeaderValue::from_static("api:8080"));
        headers.insert(
            "x-forwarded-host",
            HeaderValue::from_static("console.example.com"),
        );
        headers.insert("x-forwarded-proto", HeaderValue::from_static("https"));

        normalize_linux_do_redirect_uri(
            "https://console.example.com/zh/auth/linux-do",
            &headers,
            None,
            true,
        )
        .expect("trusted forwarded host should pass");
    }

    #[test]
    fn linux_do_state_requires_high_entropy_token_shape() {
        assert!(normalize_linux_do_state("0123456789abcdef0123456789abcdef").is_ok());
        assert!(normalize_linux_do_state("too-short").is_err());
        assert!(normalize_linux_do_state("contains space 0123456789abcdef").is_err());
    }

    async fn test_state(config: Config) -> AppState {
        let config = Config {
            cleanup_interval_seconds: 0,
            domain_verification_poll_interval_seconds: 0,
            ..config
        };

        crate::test_support::build_test_state(config, "routes-admin").await
    }

    async fn bootstrap_admin(state: &AppState, password: &str) -> ConsoleUser {
        let mut admin_state = state.admin_state.write().await;
        admin_state
            .bootstrap_first_admin("admin", password)
            .expect("bootstrap admin")
            .0
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
                None,
                Some(registration_settings),
                None,
                None,
            )
            .expect("enable email otp");
    }

    async fn configure_linux_do_registration(state: &AppState, invite_required: bool) {
        let mut admin_state = state.admin_state.write().await;
        let mut registration_settings = admin_state.registration_settings();
        registration_settings.console_invite_code_required = invite_required;
        registration_settings.linux_do.enabled = true;
        registration_settings.linux_do.client_id = Some("linuxdo-client".to_owned());
        registration_settings.linux_do.client_secret = Some("linuxdo-secret".to_owned());
        registration_settings.linux_do.callback_url =
            Some("http://localhost/zh/auth/linux-do".to_owned());
        admin_state
            .update_system_settings(
                None,
                None,
                None,
                None,
                None,
                None,
                Some(registration_settings),
                None,
                None,
            )
            .expect("configure linux.do registration");
    }

    async fn create_test_invite_code(state: &AppState) -> String {
        let mut admin_state = state.admin_state.write().await;
        admin_state
            .create_invite_code(Some("linux.do test"), Some(1))
            .expect("create invite code")
            .1
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

    fn json_request(path: &str, payload: serde_json::Value) -> Request<Body> {
        Request::builder()
            .method("POST")
            .uri(path)
            .header("host", "localhost")
            .header("content-type", "application/json")
            .body(Body::from(payload.to_string()))
            .expect("build json request")
    }

    fn json_request_with_bearer(
        path: &str,
        payload: serde_json::Value,
        token: &str,
    ) -> Request<Body> {
        Request::builder()
            .method("POST")
            .uri(path)
            .header("host", "localhost")
            .header("authorization", format!("Bearer {token}"))
            .header("content-type", "application/json")
            .body(Body::from(payload.to_string()))
            .expect("build json request")
    }

    fn session_request(token: &str) -> Request<Body> {
        Request::builder()
            .method("GET")
            .uri("/admin/session")
            .header("host", "localhost")
            .header("authorization", format!("Bearer {token}"))
            .body(Body::empty())
            .expect("build session request")
    }

    fn json_request_with_forwarded_for(
        path: &str,
        payload: serde_json::Value,
        forwarded_for: &str,
    ) -> Request<Body> {
        Request::builder()
            .method("POST")
            .uri(path)
            .header("host", "localhost")
            .header("x-forwarded-for", forwarded_for)
            .header("content-type", "application/json")
            .body(Body::from(payload.to_string()))
            .expect("build json request")
    }
    async fn read_json_body(response: axum::response::Response) -> Value {
        serde_json::from_slice(
            &to_bytes(response.into_body(), usize::MAX)
                .await
                .expect("read response body"),
        )
        .expect("decode json body")
    }
}

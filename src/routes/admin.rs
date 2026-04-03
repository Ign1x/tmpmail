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
    admin_state, auth, cloudflare,
    error::{ApiError, AppResult},
    models::{
        AdminAccessKeyListResponse, AdminAccessKeyResponse, AdminBootstrapRequest,
        AdminCreateAccessKeyRequest, AdminCreateUserRequest, AdminPasswordChangeRequest,
        AdminRecoveryRequest, AdminResetUserPasswordRequest, AdminSessionInfo,
        AdminSessionResponse, AdminSetupResponse, AdminStatusResponse, AdminSystemSettings,
        AdminUpdateSystemSettingsRequest, AdminUpdateUserRequest, ConsoleCloudflareSettings,
        CloudflareTokenValidationResponse,
        ConsoleRegisterRequest, ConsoleUser, ConsoleUserRole, LinuxDoAuthorizeRequest,
        LinuxDoAuthorizeResponse, LinuxDoCompleteRequest, SendEmailOtpRequest,
        SendEmailOtpResponse,
        TestConsoleCloudflareTokenRequest,
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

pub async fn status(State(state): State<AppState>) -> AppResult<Json<AdminStatusResponse>> {
    let admin_state = state.admin_state.read().await;
    let registration_settings = admin_state.registration_settings();
    let linux_do_enabled = registration_settings.linux_do.enabled
        && registration_settings
            .linux_do
            .client_id
            .as_deref()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false)
        && registration_settings.linux_do.client_secret_configured;

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
        linux_do_enabled,
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
    let redirect_uri = normalize_linux_do_redirect_uri(&payload.redirect_uri)?;
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
    let session_token = issue_session_token(&state, &session.user)?;

    {
        let mut store = state.store.lock().await;
        store
            .append_audit_log(
                "console.bootstrap",
                "console-user",
                user.id.clone(),
                Some(user.id.clone()),
                format!("username={} role=admin", user.username),
            )
            .await?;
    }

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
    let authenticated = {
        let mut admin_state = state.admin_state.write().await;
        admin_state.authenticate(&payload.username, &payload.password)?
    };
    let session = load_session_info(&state, &authenticated.id.to_string()).await?;
    let session_token = issue_session_token(&state, &session.user)?;

    {
        let mut store = state.store.lock().await;
        store
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
    }

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
    let require_email_otp = {
        let admin_state = state.admin_state.read().await;
        let registration_settings = admin_state.registration_settings();
        registration_settings.email_otp.enabled
    };
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
        admin_state.create_public_user(registration_identity, &payload.password, domain_limit)?
    };
    let session = load_session_info(&state, &user.id).await?;
    let session_token = issue_session_token(&state, &session.user)?;

    {
        let mut store = state.store.lock().await;
        store
            .append_audit_log(
                "console.register",
                "console-user",
                user.id.clone(),
                None,
                format!("username={} role=user", user.username),
            )
            .await?;
    }

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
    let (registration_enabled, otp_enabled, settings) = {
        let admin_state = state.admin_state.read().await;
        if admin_state.is_bootstrap_required() {
            return Err(ApiError::forbidden("console bootstrap required"));
        }
        let registration_settings = admin_state.registration_settings();
        (
            registration_settings.open_registration_enabled,
            registration_settings.email_otp.enabled,
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

    let email = normalize_email_key(&payload.email)?;
    send_email_otp(&state, &email, &settings).await?;

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

    let linux_do = registration_settings.linux_do;
    if !linux_do.enabled {
        return Err(ApiError::forbidden("linux.do registration is disabled"));
    }

    let client_id = linux_do
        .client_id
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::forbidden("linux.do auth is not configured"))?;
    let client_secret = linux_do
        .client_secret
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::forbidden("linux.do auth is not configured"))?;
    let token_url = linux_do
        .token_url
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::forbidden("linux.do auth is not configured"))?;
    let userinfo_url = linux_do
        .userinfo_url
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::forbidden("linux.do auth is not configured"))?;
    let redirect_uri = normalize_linux_do_redirect_uri(&payload.redirect_uri)?;
    let code = payload.code.trim();
    if code.is_empty() {
        return Err(ApiError::validation(
            "linux.do authorization code is required",
        ));
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(
            state.config.http_request_timeout_seconds.max(5) as u64,
        ))
        .build()
        .map_err(|error| ApiError::internal(format!("failed to build linux.do client: {error}")))?;

    let token_response = client
        .post(&token_url)
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
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
        .get(&userinfo_url)
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
    let trust_level = userinfo.trust_level.unwrap_or(0);

    if trust_level < linux_do.minimum_trust_level {
        return Err(ApiError::forbidden(format!(
            "linux.do trust level {trust_level} is lower than required {}",
            linux_do.minimum_trust_level
        )));
    }

    let authenticated = {
        let mut admin_state = state.admin_state.write().await;
        admin_state.authenticate_linux_do(&subject, &preferred_username, trust_level)?
    };
    let session = load_session_info(&state, &authenticated.id.to_string()).await?;
    let session_token = issue_session_token(&state, &session.user)?;

    {
        let mut store = state.store.lock().await;
        store
            .append_audit_log(
                "console.login.linux_do",
                "console-user",
                authenticated.id.to_string(),
                None,
                format!(
                    "linux_do_user_id={} linux_do_username={} trust_level={trust_level}",
                    subject, preferred_username
                ),
            )
            .await?;
    }

    Ok((
        sensitive_headers(),
        Json(AdminSessionResponse {
            session_token,
            session,
        }),
    ))
}

pub async fn session(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<impl IntoResponse> {
    let claims = auth::require_console_session(&headers, &state.config)?;
    let session = load_session_info(&state, &claims.sub).await?;

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
    if payload.recovery_token.trim() != configured_token {
        return Err(ApiError::unauthorized("invalid admin recovery token"));
    }

    let username = payload.username.as_deref().unwrap_or("admin");
    let (user, api_key) = {
        let mut admin_state = state.admin_state.write().await;
        admin_state.reset_password_with_recovery(username, &payload.new_password)?
    };
    let session = load_session_info(&state, &user.id).await?;
    let session_token = issue_session_token(&state, &session.user)?;

    {
        let mut store = state.store.lock().await;
        store
            .append_audit_log(
                "console.recover",
                "console-user",
                user.id.clone(),
                Some(user.id.clone()),
                format!("username={} password recovered", user.username),
            )
            .await?;
    }

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
    let claims = auth::require_console_session(&headers, &state.config)?;
    let user_id = Uuid::parse_str(&claims.sub)
        .map_err(|_| ApiError::unauthorized("invalid console session"))?;
    let (key, api_key) = {
        let mut admin_state = state.admin_state.write().await;
        admin_state.create_api_key(user_id, Some("Default Key"))?
    };

    Ok((
        sensitive_headers(),
        Json(AdminAccessKeyResponse { key, api_key }),
    ))
}

pub async fn regenerate_access_key(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<impl IntoResponse> {
    let claims = auth::require_console_session(&headers, &state.config)?;
    let user_id = Uuid::parse_str(&claims.sub)
        .map_err(|_| ApiError::unauthorized("invalid console session"))?;
    let (key, api_key) = {
        let mut admin_state = state.admin_state.write().await;
        admin_state.create_api_key(user_id, None)?
    };
    {
        let mut store = state.store.lock().await;
        store
            .append_audit_log(
                "console.access_key.regenerate",
                "console-user",
                user_id.to_string(),
                Some(user_id.to_string()),
                "rotated console api key".to_owned(),
            )
            .await?;
    }

    Ok((
        sensitive_headers(),
        Json(AdminAccessKeyResponse { key, api_key }),
    ))
}

pub async fn list_access_keys(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<AdminAccessKeyListResponse>> {
    let claims = auth::require_console_session(&headers, &state.config)?;
    let user_id = Uuid::parse_str(&claims.sub)
        .map_err(|_| ApiError::unauthorized("invalid console session"))?;
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
    let claims = auth::require_console_session(&headers, &state.config)?;
    let user_id = Uuid::parse_str(&claims.sub)
        .map_err(|_| ApiError::unauthorized("invalid console session"))?;
    let (key, api_key) = {
        let mut admin_state = state.admin_state.write().await;
        admin_state.create_api_key(user_id, payload.name.as_deref())?
    };
    {
        let mut store = state.store.lock().await;
        store
            .append_audit_log(
                "console.access_key.create",
                "console-user",
                user_id.to_string(),
                Some(user_id.to_string()),
                format!("created access key id={} name={}", key.id, key.name),
            )
            .await?;
    }

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
    let claims = auth::require_console_session(&headers, &state.config)?;
    let user_id = Uuid::parse_str(&claims.sub)
        .map_err(|_| ApiError::unauthorized("invalid console session"))?;
    let key_id = Uuid::parse_str(&id).map_err(|_| ApiError::validation("invalid access key id"))?;
    let deleted = {
        let mut admin_state = state.admin_state.write().await;
        admin_state.delete_api_key(user_id, key_id)?
    };
    {
        let mut store = state.store.lock().await;
        store
            .append_audit_log(
                "console.access_key.delete",
                "console-user",
                user_id.to_string(),
                Some(user_id.to_string()),
                format!("deleted access key id={} name={}", deleted.id, deleted.name),
            )
            .await?;
    }

    Ok(StatusCode::NO_CONTENT)
}

pub async fn change_password(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<AdminPasswordChangeRequest>,
) -> AppResult<impl IntoResponse> {
    let claims = auth::require_console_session(&headers, &state.config)?;
    let user_id = Uuid::parse_str(&claims.sub)
        .map_err(|_| ApiError::unauthorized("invalid console session"))?;
    {
        let mut admin_state = state.admin_state.write().await;
        admin_state.change_password(user_id, &payload.current_password, &payload.new_password)?;
    }
    {
        let mut store = state.store.lock().await;
        store
            .append_audit_log(
                "console.password.change",
                "console-user",
                user_id.to_string(),
                Some(user_id.to_string()),
                "console password updated".to_owned(),
            )
            .await?;
    }

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
    {
        let mut store = state.store.lock().await;
        store
            .append_audit_log(
                "console.user.create",
                "console-user",
                user.id.clone(),
                Some(actor.id.to_string()),
                format!("username={} role={}", user.username, role_label(&user.role)),
            )
            .await?;
    }

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
    {
        let mut store = state.store.lock().await;
        store
            .append_audit_log(
                "console.user.update",
                "console-user",
                user.id.clone(),
                Some(actor.id.to_string()),
                format!("username={} role={}", user.username, role_label(&user.role)),
            )
            .await?;
    }

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
    {
        let mut store = state.store.lock().await;
        store
            .append_audit_log(
                "console.user.password.reset",
                "console-user",
                user_id.to_string(),
                Some(actor.id.to_string()),
                "password reset by administrator".to_owned(),
            )
            .await?;
    }

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

    {
        let mut store = state.store.lock().await;
        let owned_domains = store.count_domains_owned_by(user_id).await?;
        if owned_domains > 0 {
            return Err(ApiError::validation(
                "console user still owns managed domains",
            ));
        }
        let owned_accounts = store.count_accounts_owned_by(user_id).await?;
        if owned_accounts > 0 {
            return Err(ApiError::validation(
                "console user still owns mailbox accounts",
            ));
        }
    }

    {
        let mut admin_state = state.admin_state.write().await;
        admin_state.delete_user(user_id)?;
    }
    {
        let mut store = state.store.lock().await;
        store
            .append_audit_log(
                "console.user.delete",
                "console-user",
                user_id.to_string(),
                Some(actor.id.to_string()),
                "console user deleted".to_owned(),
            )
            .await?;
    }

    Ok(StatusCode::NO_CONTENT)
}

pub async fn get_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<AdminSystemSettings>> {
    admin_state::require_admin_access(&headers, &state).await?;
    let admin_state = state.admin_state.read().await;
    Ok(Json(admin_state.effective_system_settings(state.config.as_ref())))
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
            payload.registration_settings,
            payload.user_limits,
            payload.update_notice,
        )?
    };
    {
        let mut store = state.store.lock().await;
        store
            .append_audit_log(
                "console.settings.update",
                "system-settings",
                "default".to_owned(),
                Some(actor.id.to_string()),
                format!(
                    "system_enabled={} mail_exchange_host={:?} mail_route_target={:?} domain_txt_prefix={:?} open_registration_enabled={} allowed_email_suffixes={:?} email_otp_enabled={} linux_do_enabled={} default_domain_limit={} mailbox_limit={} api_key_limit={} update_notice_version={:?}",
                    settings.system_enabled,
                    settings.mail_exchange_host,
                    settings.mail_route_target,
                    settings.domain_txt_prefix,
                    settings
                        .registration_settings
                        .open_registration_enabled,
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
    }

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
    {
        let mut store = state.store.lock().await;
        store
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
    }

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
    let admin_state = state.admin_state.read().await;
    Ok(AdminSessionInfo {
        user: admin_state.current_user(user_id)?,
        system_settings: admin_state.effective_system_settings(state.config.as_ref()),
    })
}

async fn effective_system_settings(state: &AppState) -> AdminSystemSettings {
    let admin_state = state.admin_state.read().await;
    admin_state.effective_system_settings(state.config.as_ref())
}

fn issue_session_token(state: &AppState, user: &ConsoleUser) -> AppResult<String> {
    let user_id =
        Uuid::parse_str(&user.id).map_err(|_| ApiError::unauthorized("invalid console user"))?;
    auth::issue_console_session_token(user_id, &user.username, &user.role, &state.config)
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

fn normalize_linux_do_redirect_uri(value: &str) -> AppResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ApiError::validation("linux.do redirect uri is required"));
    }
    if trimmed.chars().any(char::is_whitespace) {
        return Err(ApiError::validation("linux.do redirect uri is invalid"));
    }

    let parsed = Url::parse(trimmed)
        .map_err(|_| ApiError::validation("linux.do redirect uri is invalid"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed.to_string()),
        _ => Err(ApiError::validation("linux.do redirect uri is invalid")),
    }
}

fn normalize_linux_do_state(value: &str) -> AppResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.len() > 512 || trimmed.chars().any(char::is_whitespace) {
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

pub(crate) async fn send_email_otp(
    state: &AppState,
    email: &str,
    settings: &crate::models::AdminEmailOtpSettings,
) -> AppResult<()> {
    if !settings.enabled {
        return Err(ApiError::forbidden("email otp is disabled"));
    }

    let mail_sender = state
        .mail_sender
        .as_ref()
        .ok_or_else(|| ApiError::forbidden("email otp delivery is not configured"))?;
    let code = {
        let mut otp_store = state.otp_store.lock().await;
        otp_store.issue_code(email, settings.ttl_seconds, settings.cooldown_seconds)?
    };
    let subject = settings
        .subject
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::forbidden("email otp subject is not configured"))?;
    let body_template = settings
        .body
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::forbidden("email otp body is not configured"))?;
    let body = render_otp_body(body_template, &code, settings.ttl_seconds);

    if let Err(error) = mail_sender.send_text_email(email, subject, &body).await {
        let mut otp_store = state.otp_store.lock().await;
        let _ = otp_store.verify_and_consume(email, &code);
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
    let mut otp_store = state.otp_store.lock().await;
    otp_store.verify_and_consume(email, otp_code)
}

fn render_otp_body(template: &str, code: &str, ttl_seconds: u32) -> String {
    template
        .replace("{{code}}", code)
        .replace("{{ttlSeconds}}", &ttl_seconds.to_string())
}

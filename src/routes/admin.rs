use axum::{
    Json,
    extract::{Path, State},
    http::{
        HeaderMap, HeaderName, HeaderValue, StatusCode,
        header::{CACHE_CONTROL, PRAGMA},
    },
    response::IntoResponse,
};
use uuid::Uuid;

use crate::{
    admin_state, auth,
    error::{ApiError, AppResult},
    models::{
        AdminAccessKeyResponse, AdminBootstrapRequest, AdminCreateUserRequest,
        AdminPasswordChangeRequest, AdminRecoveryRequest, AdminResetUserPasswordRequest,
        AdminSessionInfo, AdminSessionResponse, AdminSetupResponse, AdminStatusResponse,
        AdminSystemSettings, AdminUpdateSystemSettingsRequest, AdminUpdateUserRequest, ConsoleUser,
        ConsoleUserRole,
    },
    state::AppState,
};

pub async fn status(State(state): State<AppState>) -> AppResult<Json<AdminStatusResponse>> {
    let admin_state = state.admin_state.read().await;

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
    let mut admin_state = state.admin_state.write().await;
    let api_key = admin_state.get_or_create_api_key(user_id)?;

    Ok((
        sensitive_headers(),
        Json(AdminAccessKeyResponse { api_key }),
    ))
}

pub async fn regenerate_access_key(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<impl IntoResponse> {
    let claims = auth::require_console_session(&headers, &state.config)?;
    let user_id = Uuid::parse_str(&claims.sub)
        .map_err(|_| ApiError::unauthorized("invalid console session"))?;
    let api_key = {
        let mut admin_state = state.admin_state.write().await;
        admin_state.regenerate_api_key(user_id)?
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
        Json(AdminAccessKeyResponse { api_key }),
    ))
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
    Ok(Json(admin_state.system_settings()))
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
                    "system_enabled={} mail_exchange_host={:?} mail_route_target={:?} update_notice_version={:?}",
                    settings.system_enabled,
                    settings.mail_exchange_host,
                    settings.mail_route_target,
                    settings
                        .update_notice
                        .as_ref()
                        .map(|notice| notice.version.as_str()),
                ),
            )
            .await?;
    }

    Ok(Json(settings))
}

async fn load_session_info(state: &AppState, user_id: &str) -> AppResult<AdminSessionInfo> {
    let user_id =
        Uuid::parse_str(user_id).map_err(|_| ApiError::unauthorized("invalid console session"))?;
    let admin_state = state.admin_state.read().await;
    Ok(AdminSessionInfo {
        user: admin_state.current_user(user_id)?,
        system_settings: admin_state.system_settings(),
    })
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

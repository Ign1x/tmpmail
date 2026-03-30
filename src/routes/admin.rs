use axum::{
    Json,
    extract::State,
    http::{
        HeaderMap, HeaderName, HeaderValue, StatusCode,
        header::{CACHE_CONTROL, PRAGMA},
    },
    response::IntoResponse,
};

use crate::{
    auth,
    error::{ApiError, AppResult},
    models::{
        AdminAccessKeyResponse, AdminPasswordChangeRequest, AdminPasswordRequest,
        AdminSessionResponse, AdminSetupResponse, AdminStatusResponse,
    },
    state::AppState,
};

pub async fn status(State(state): State<AppState>) -> AppResult<Json<AdminStatusResponse>> {
    let admin_state = state.admin_state.read().await;

    Ok(Json(AdminStatusResponse {
        is_password_configured: admin_state.is_password_configured(),
        has_generated_api_key: admin_state.has_generated_api_key(),
    }))
}

pub async fn setup(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<AdminPasswordRequest>,
) -> AppResult<impl IntoResponse> {
    auth::require_secure_admin_transport(&headers, &state.config)?;
    let mut admin_state = state.admin_state.write().await;
    let api_key = admin_state.setup_password(&payload.password)?;
    let session_token = auth::issue_admin_session_token(&state.config)?;
    {
        let mut store = state.store.lock().await;
        store.append_audit_log(
            "admin.setup",
            "admin",
            "system".to_owned(),
            Some("admin".to_owned()),
            "initialized administrator password and generated key".to_owned(),
        )
        .await?;
    }

    Ok((
        StatusCode::CREATED,
        sensitive_headers(),
        Json(AdminSetupResponse {
            session_token,
            api_key,
        }),
    ))
}

pub async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<AdminPasswordRequest>,
) -> AppResult<impl IntoResponse> {
    auth::require_secure_admin_transport(&headers, &state.config)?;
    let admin_state = state.admin_state.read().await;
    if !admin_state.is_password_configured() {
        return Err(ApiError::forbidden("admin password is not configured"));
    }

    if !admin_state.verify_password(&payload.password)? {
        return Err(ApiError::unauthorized("invalid admin password"));
    }

    {
        let mut store = state.store.lock().await;
        store.append_audit_log(
            "admin.login",
            "admin",
            "system".to_owned(),
            Some("admin".to_owned()),
            "admin session issued".to_owned(),
        )
        .await?;
    }

    Ok((
        sensitive_headers(),
        Json(AdminSessionResponse {
            session_token: auth::issue_admin_session_token(&state.config)?,
        }),
    ))
}

pub async fn access_key(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<impl IntoResponse> {
    auth::require_admin_session(&headers, &state.config)?;
    let mut admin_state = state.admin_state.write().await;
    let api_key = admin_state.get_or_create_api_key()?;

    Ok((
        sensitive_headers(),
        Json(AdminAccessKeyResponse { api_key }),
    ))
}

pub async fn regenerate_access_key(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<impl IntoResponse> {
    auth::require_admin_session(&headers, &state.config)?;
    let mut admin_state = state.admin_state.write().await;
    let api_key = admin_state.regenerate_api_key()?;
    {
        let mut store = state.store.lock().await;
        store.append_audit_log(
            "admin.access_key.regenerate",
            "admin",
            "system".to_owned(),
            Some("admin".to_owned()),
            "administrator API key rotated".to_owned(),
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
    auth::require_admin_session(&headers, &state.config)?;
    let mut admin_state = state.admin_state.write().await;
    admin_state.change_password(&payload.current_password, &payload.new_password)?;
    {
        let mut store = state.store.lock().await;
        store.append_audit_log(
            "admin.password.change",
            "admin",
            "system".to_owned(),
            Some("admin".to_owned()),
            "administrator password updated".to_owned(),
        )
        .await?;
    }

    Ok((StatusCode::NO_CONTENT, sensitive_headers()))
}

fn sensitive_headers() -> [(HeaderName, HeaderValue); 2] {
    [
        (CACHE_CONTROL, HeaderValue::from_static("no-store, private")),
        (PRAGMA, HeaderValue::from_static("no-cache")),
    ]
}

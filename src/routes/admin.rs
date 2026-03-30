use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode},
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
    Json(payload): Json<AdminPasswordRequest>,
) -> AppResult<(StatusCode, Json<AdminSetupResponse>)> {
    let mut admin_state = state.admin_state.write().await;
    let api_key = admin_state.setup_password(&payload.password)?;
    let session_token = auth::issue_admin_session_token(&state.config)?;

    Ok((
        StatusCode::CREATED,
        Json(AdminSetupResponse {
            session_token,
            api_key,
        }),
    ))
}

pub async fn login(
    State(state): State<AppState>,
    Json(payload): Json<AdminPasswordRequest>,
) -> AppResult<Json<AdminSessionResponse>> {
    let admin_state = state.admin_state.read().await;
    if !admin_state.is_password_configured() {
        return Err(ApiError::forbidden("admin password is not configured"));
    }

    if !admin_state.verify_password(&payload.password)? {
        return Err(ApiError::unauthorized("invalid admin password"));
    }

    Ok(Json(AdminSessionResponse {
        session_token: auth::issue_admin_session_token(&state.config)?,
    }))
}

pub async fn access_key(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<AdminAccessKeyResponse>> {
    auth::require_admin_session(&headers, &state.config)?;
    let mut admin_state = state.admin_state.write().await;
    let api_key = admin_state.get_or_create_api_key()?;

    Ok(Json(AdminAccessKeyResponse { api_key }))
}

pub async fn regenerate_access_key(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<AdminAccessKeyResponse>> {
    auth::require_admin_session(&headers, &state.config)?;
    let mut admin_state = state.admin_state.write().await;
    let api_key = admin_state.regenerate_api_key()?;

    Ok(Json(AdminAccessKeyResponse { api_key }))
}

pub async fn change_password(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<AdminPasswordChangeRequest>,
) -> AppResult<StatusCode> {
    auth::require_admin_session(&headers, &state.config)?;
    let mut admin_state = state.admin_state.write().await;
    admin_state.change_password(&payload.current_password, &payload.new_password)?;

    Ok(StatusCode::NO_CONTENT)
}

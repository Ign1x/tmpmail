use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use uuid::Uuid;

use crate::{
    auth,
    error::{ApiError, AppResult},
    models::{Account, CreateAccountRequest, TokenRequest, TokenResponse},
    state::AppState,
};

pub async fn create_account(
    State(state): State<AppState>,
    Json(payload): Json<CreateAccountRequest>,
) -> AppResult<(StatusCode, Json<Account>)> {
    let mut store = state.store.write().await;
    let account = store.create_account(&payload.address, &payload.password, payload.expires_in)?;

    Ok((StatusCode::CREATED, Json(account)))
}

pub async fn issue_token(
    State(state): State<AppState>,
    Json(payload): Json<TokenRequest>,
) -> AppResult<Json<TokenResponse>> {
    let store = state.store.read().await;
    let (account_id, address) = store.authenticate(&payload.address, &payload.password)?;
    let token = auth::issue_token(account_id, &address, &state.config)?;

    Ok(Json(TokenResponse {
        token,
        id: account_id.to_string(),
    }))
}

pub async fn me(State(state): State<AppState>, headers: HeaderMap) -> AppResult<Json<Account>> {
    let account_id = auth::account_id_from_headers(&headers, &state.config)?;
    let store = state.store.read().await;
    let account = store.get_account(account_id)?;

    Ok(Json(account))
}

pub async fn delete_account(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> AppResult<StatusCode> {
    let authenticated_account_id = auth::account_id_from_headers(&headers, &state.config)?;
    let target_account_id =
        Uuid::parse_str(&id).map_err(|_| ApiError::validation("invalid account id"))?;

    if authenticated_account_id != target_account_id {
        return Err(ApiError::forbidden(
            "token does not belong to the target account",
        ));
    }

    let mut store = state.store.write().await;
    store.delete_account(target_account_id)?;

    Ok(StatusCode::NO_CONTENT)
}

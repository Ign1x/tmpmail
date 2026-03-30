use axum::{
    Json,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
};
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    auth,
    error::{ApiError, AppResult},
    models::{
        HydraCollection, MessageDetail, MessageSeenResponse, MessageSummary, UpdateMessageRequest,
    },
    state::AppState,
};

#[derive(Debug, Deserialize)]
pub struct MessageListQuery {
    pub page: Option<usize>,
}

pub async fn list_messages(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<MessageListQuery>,
) -> AppResult<Json<HydraCollection<MessageSummary>>> {
    let account_id = auth::account_id_from_headers(&headers, &state.config)?;
    let page = query.page.unwrap_or(1);
    let mut store = state.store.lock().await;
    let (messages, total) = store.list_messages(account_id, page).await?;

    Ok(Json(HydraCollection::new(messages, total)))
}

pub async fn get_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> AppResult<Json<MessageDetail>> {
    let account_id = auth::account_id_from_headers(&headers, &state.config)?;
    let message_id =
        Uuid::parse_str(&id).map_err(|_| ApiError::validation("invalid message id"))?;
    let mut store = state.store.lock().await;
    let message = store.get_message(account_id, message_id).await?;

    Ok(Json(message))
}

pub async fn patch_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<UpdateMessageRequest>,
) -> AppResult<Json<MessageSeenResponse>> {
    let account_id = auth::account_id_from_headers(&headers, &state.config)?;
    let message_id =
        Uuid::parse_str(&id).map_err(|_| ApiError::validation("invalid message id"))?;
    let seen = payload.seen.unwrap_or(true);
    let mut store = state.store.lock().await;
    let response = store.mark_message_seen(account_id, message_id, seen).await?;
    state.realtime.publish(
        &state.metrics,
        "message.updated",
        account_id,
        Some(message_id),
    );

    Ok(Json(response))
}

pub async fn delete_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> AppResult<StatusCode> {
    let account_id = auth::account_id_from_headers(&headers, &state.config)?;
    let message_id =
        Uuid::parse_str(&id).map_err(|_| ApiError::validation("invalid message id"))?;
    let mut store = state.store.lock().await;
    store.delete_message(account_id, message_id).await?;
    state.realtime.publish(
        &state.metrics,
        "message.deleted",
        account_id,
        Some(message_id),
    );

    Ok(StatusCode::NO_CONTENT)
}

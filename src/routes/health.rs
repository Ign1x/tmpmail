use axum::{Json, extract::State};
use serde_json::json;

use crate::{error::AppResult, state::AppState};

pub async fn health(State(state): State<AppState>) -> Json<serde_json::Value> {
    let backend = {
        let store = state.store.lock().await;
        store.backend_name()
    };

    Json(json!({ "status": "ok", "storeBackend": backend }))
}

pub async fn ready(State(state): State<AppState>) -> AppResult<Json<serde_json::Value>> {
    let backend = {
        let mut store = state.store.lock().await;
        let backend = store.backend_name();
        store.ready().await?;
        backend
    };

    Ok(Json(json!({ "status": "ready", "storeBackend": backend })))
}

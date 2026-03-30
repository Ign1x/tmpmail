use std::{convert::Infallible, sync::Arc, time::Duration};

use async_stream::stream;
use axum::{
    extract::{Query, State},
    response::sse::{Event, KeepAlive, Sse},
};
use serde::Deserialize;
use uuid::Uuid;

use crate::{auth, error::AppResult, metrics::AppMetrics, state::AppState};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventsQuery {
    #[serde(alias = "account_id")]
    pub account_id: Option<String>,
}

pub async fn stream_events(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Query(query): Query<EventsQuery>,
) -> AppResult<Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>>> {
    let account_id = auth::account_id_from_headers(&headers, &state.config)?;

    if let Some(requested_account_id) = query.account_id.as_deref() {
        let requested =
            Uuid::parse_str(requested_account_id).map_err(|_| crate::error::ApiError::validation("invalid account id"))?;
        if requested != account_id {
            return Err(crate::error::ApiError::forbidden(
                "token does not belong to the target account",
            ));
        }
    }

    let mut receiver = state.realtime.subscribe();
    let metrics = state.metrics.clone();
    let account_id_string = account_id.to_string();

    metrics.open_sse_connection();

    let stream = stream! {
        let _guard = SseConnectionGuard::new(metrics.clone());
        let connected = serde_json::json!({
            "event": "connected",
            "accountId": account_id_string,
            "timestamp": chrono::Utc::now(),
        });
        yield Ok(Event::default().event("connected").data(connected.to_string()));

        loop {
            match receiver.recv().await {
                Ok(event) => {
                    if event.account_id != account_id_string {
                        continue;
                    }

                    if let Ok(payload) = serde_json::to_string(&event) {
                        yield Ok(Event::default().event(&event.event).data(payload));
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                    let payload = serde_json::json!({
                        "event": "lagged",
                        "skipped": skipped,
                        "accountId": account_id_string,
                        "timestamp": chrono::Utc::now(),
                    });
                    yield Ok(Event::default().event("lagged").data(payload.to_string()));
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    break;
                }
            }
        }
    };

    Ok(Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(20))
            .text("heartbeat"),
    ))
}

struct SseConnectionGuard {
    metrics: Arc<AppMetrics>,
}

impl SseConnectionGuard {
    fn new(metrics: Arc<AppMetrics>) -> Self {
        Self { metrics }
    }
}

impl Drop for SseConnectionGuard {
    fn drop(&mut self) {
        self.metrics.close_sse_connection();
    }
}

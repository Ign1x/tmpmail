use std::{convert::Infallible, sync::Arc, time::Duration};

use async_stream::stream;
use axum::{
    extract::{Query, State},
    http::HeaderMap,
    response::sse::{Event, KeepAlive, Sse},
};
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    auth,
    error::{ApiError, AppResult},
    metrics::AppMetrics,
    state::AppState,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventsQuery {
    #[serde(alias = "account_id")]
    pub account_id: Option<String>,
}

pub async fn stream_events(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<EventsQuery>,
) -> AppResult<Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>>> {
    let account_id = auth::account_id_from_headers(&headers, &state.config)?;

    if let Some(requested_account_id) = query.account_id.as_deref() {
        let requested = Uuid::parse_str(requested_account_id)
            .map_err(|_| crate::error::ApiError::validation("invalid account id"))?;
        if requested != account_id {
            return Err(crate::error::ApiError::forbidden(
                "token does not belong to the target account",
            ));
        }
    }

    let mut receiver = state.realtime.subscribe();
    let metrics = state.metrics.clone();
    let account_id_string = account_id.to_string();
    let connection_limit = state.config.sse_connection_limit.max(1);
    if !metrics.try_open_sse_connection(connection_limit) {
        return Err(ApiError::service_unavailable(
            "realtime connection limit reached; retry later",
        ));
    }
    let connection_guard = SseConnectionGuard::new(metrics.clone());

    let stream = stream! {
        let _connection_guard = connection_guard;
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

#[cfg(test)]
mod tests {
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use tower::ServiceExt;

    use super::*;
    use crate::{app::build_router, config::Config};

    #[tokio::test]
    async fn rejects_connections_when_sse_limit_is_reached() {
        let state = test_state(Config {
            sse_connection_limit: 1,
            ..Config::default()
        })
        .await;
        let (account_id, token) =
            create_account_and_token(&state, "alice@events.example.com").await;
        assert!(state.metrics.try_open_sse_connection(1));

        let response = build_router(state.clone())
            .oneshot(
                Request::builder()
                    .uri(format!("/events?accountId={account_id}"))
                    .header("authorization", format!("Bearer {token}"))
                    .header("host", "localhost")
                    .body(Body::empty())
                    .expect("build sse request"),
            )
            .await
            .expect("sse response");

        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        state.metrics.close_sse_connection();
    }

    #[tokio::test]
    async fn dropping_unpolled_sse_response_releases_connection_slot() {
        let state = test_state(Config {
            sse_connection_limit: 1,
            ..Config::default()
        })
        .await;
        let (account_id, token) = create_account_and_token(&state, "bob@events.example.com").await;

        let response = build_router(state.clone())
            .oneshot(
                Request::builder()
                    .uri(format!("/events?accountId={account_id}"))
                    .header("authorization", format!("Bearer {token}"))
                    .header("host", "localhost")
                    .body(Body::empty())
                    .expect("build sse request"),
            )
            .await
            .expect("sse response");

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(state.metrics.snapshot().sse_connections_active, 1);

        drop(response);

        assert_eq!(state.metrics.snapshot().sse_connections_active, 0);
    }

    async fn test_state(config: Config) -> AppState {
        let config = Config {
            cleanup_interval_seconds: 0,
            domain_verification_poll_interval_seconds: 0,
            ..config
        };

        crate::test_support::build_test_state(config, "routes-events").await
    }

    async fn create_account_and_token(state: &AppState, address: &str) -> (Uuid, String) {
        let domain = address
            .rsplit_once('@')
            .map(|(_, domain)| domain)
            .expect("account address domain");
        crate::test_support::create_active_test_domain(state, domain).await;
        let account = state
            .store
            .create_account(address, "secret1234", None)
            .await
            .expect("create account");
        let account_id = Uuid::parse_str(&account.id).expect("account uuid");
        let token = auth::issue_token(account_id, &account.address, state.config.as_ref())
            .expect("issue token");

        (account_id, token)
    }
}

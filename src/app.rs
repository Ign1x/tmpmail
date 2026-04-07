use std::time::Duration;

use axum::{
    Router, error_handling::HandleErrorLayer, extract::DefaultBodyLimit, http::StatusCode,
    response::IntoResponse,
};
use serde_json::json;
use tower::{BoxError, ServiceBuilder, load_shed::error::Overloaded};
use tower_http::{limit::RequestBodyLimitLayer, trace::TraceLayer};

use crate::{routes, state::AppState};

const DEFAULT_API_BODY_LIMIT_BYTES: usize = 1024 * 1024;

pub fn build_router(state: AppState) -> Router {
    let request_timeout = Duration::from_secs(
        state
            .config
            .http_request_timeout_seconds
            .max(1)
            .try_into()
            .unwrap_or(15),
    );
    let concurrency_limit = state.config.http_concurrency_limit.max(16);
    let protected_api = apply_api_protection(
        routes::api_router(),
        request_timeout,
        concurrency_limit,
        DEFAULT_API_BODY_LIMIT_BYTES,
    );

    routes::stream_router()
        .merge(protected_api)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

fn apply_api_protection<S>(
    router: Router<S>,
    request_timeout: Duration,
    concurrency_limit: usize,
    body_limit_bytes: usize,
) -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    let body_limit = body_limit_bytes.max(1);

    router.layer(DefaultBodyLimit::max(body_limit)).layer(
        ServiceBuilder::new()
            .layer(HandleErrorLayer::new(handle_api_layer_error))
            .layer(RequestBodyLimitLayer::new(body_limit))
            .load_shed()
            .concurrency_limit(concurrency_limit)
            .timeout(request_timeout),
    )
}

async fn handle_api_layer_error(error: BoxError) -> impl IntoResponse {
    if error.is::<tower::timeout::error::Elapsed>() {
        return (
            StatusCode::GATEWAY_TIMEOUT,
            axum::Json(json!({
                "message": "request timed out before the server could respond",
                "detail": "request timed out before the server could respond",
            })),
        )
            .into_response();
    }

    if error.is::<Overloaded>() {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            axum::Json(json!({
                "message": "server is temporarily overloaded",
                "detail": "server is temporarily overloaded",
            })),
        )
            .into_response();
    }

    tracing::error!(error = %error, "unexpected API middleware failure");

    (
        StatusCode::INTERNAL_SERVER_ERROR,
        axum::Json(json!({
            "message": "unexpected server middleware failure",
            "detail": "unexpected server middleware failure",
        })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use std::{sync::Arc, time::Duration};

    use axum::{
        Router,
        body::{Body, to_bytes},
        error_handling::HandleErrorLayer,
        extract::Json,
        http::{Request, StatusCode},
        response::IntoResponse,
        routing::{get, post},
    };
    use serde_json::{Value, json};
    use tokio::{sync::Notify, time::sleep};
    use tower::{BoxError, ServiceBuilder, ServiceExt, service_fn};

    use super::{DEFAULT_API_BODY_LIMIT_BYTES, apply_api_protection};

    #[tokio::test]
    async fn timeout_middleware_returns_gateway_timeout_json() {
        let app = apply_api_protection(
            Router::new().route(
                "/slow",
                get(|| async {
                    sleep(Duration::from_millis(50)).await;
                    StatusCode::OK
                }),
            ),
            Duration::from_millis(10),
            16,
            DEFAULT_API_BODY_LIMIT_BYTES,
        );

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/slow")
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("timeout response");

        assert_eq!(response.status(), StatusCode::GATEWAY_TIMEOUT);
        assert_eq!(
            read_json_body(response).await,
            json!({
                "message": "request timed out before the server could respond",
                "detail": "request timed out before the server could respond",
            })
        );
    }

    #[tokio::test]
    async fn overload_middleware_returns_service_unavailable_json() {
        let entered = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        let service = ServiceBuilder::new()
            .layer(HandleErrorLayer::new(super::handle_api_layer_error))
            .load_shed()
            .concurrency_limit(1)
            .timeout(Duration::from_secs(1))
            .service(service_fn({
                let entered = entered.clone();
                let release = release.clone();
                move |_request: Request<Body>| {
                    let entered = entered.clone();
                    let release = release.clone();
                    async move {
                        entered.notify_one();
                        release.notified().await;
                        Ok::<_, BoxError>(StatusCode::OK.into_response())
                    }
                }
            }));

        let held_request = {
            let service = service.clone();
            async move {
                service
                    .oneshot(
                        Request::builder()
                            .uri("/hold")
                            .body(Body::empty())
                            .expect("build held request"),
                    )
                    .await
                    .expect("held response")
            }
        };
        let competing_request = async move {
            entered.notified().await;
            let response = service
                .oneshot(
                    Request::builder()
                        .uri("/hold")
                        .body(Body::empty())
                        .expect("build competing request"),
                )
                .await
                .expect("overload response");
            release.notify_waiters();
            response
        };

        let (held_response, response) = tokio::join!(held_request, competing_request);

        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            read_json_body(response).await,
            json!({
                "message": "server is temporarily overloaded",
                "detail": "server is temporarily overloaded",
            })
        );
        assert_eq!(held_response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn body_limit_returns_payload_too_large() {
        let app = apply_api_protection(
            Router::new().route(
                "/upload",
                post(|_body: Json<serde_json::Value>| async { StatusCode::OK }),
            ),
            Duration::from_secs(1),
            16,
            8,
        );

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/upload")
                    .header("content-type", "application/json")
                    .body(Body::from(r#""0123456789""#))
                    .expect("build large request"),
            )
            .await
            .expect("body limit response");

        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
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

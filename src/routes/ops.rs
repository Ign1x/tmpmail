use axum::{
    Json,
    extract::{Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header::CONTENT_TYPE},
    response::{IntoResponse, Response},
};
use serde::Deserialize;

use crate::{
    admin_state,
    app_store::StoreStats,
    cleanup_worker,
    error::AppResult,
    metrics::MetricsSnapshot,
    models::{AdminAuditLogsResponse, AdminMetricsResponse, PublicUpdateNotice},
    state::AppState,
};

#[derive(Debug, Deserialize)]
pub struct AuditLogsQuery {
    pub limit: Option<usize>,
}

pub async fn admin_metrics(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<AdminMetricsResponse>> {
    let _ = admin_state::require_admin_access(&headers, &state).await?;
    let console_users_total = {
        let admin_state = state.admin_state.read().await;
        admin_state.users_total()
    };

    let stats = state.store.stats().await?;
    let metrics = state.metrics.snapshot();
    let runtime = state.metrics.runtime_snapshot();

    Ok(Json(AdminMetricsResponse::from_parts(
        console_users_total,
        stats,
        metrics,
        runtime,
    )))
}

pub async fn admin_audit_logs(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<AuditLogsQuery>,
) -> AppResult<Json<AdminAuditLogsResponse>> {
    let _ = admin_state::require_admin_access(&headers, &state).await?;
    let limit = query.limit.unwrap_or(50).clamp(1, 500);
    let entries = state.store.audit_logs(limit).await?;

    Ok(Json(AdminAuditLogsResponse { entries }))
}

pub async fn clear_admin_audit_logs(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<StatusCode> {
    let _ = admin_state::require_admin_access(&headers, &state).await?;
    state.store.clear_audit_logs().await?;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn public_update_notice(
    State(state): State<AppState>,
) -> AppResult<Json<Option<PublicUpdateNotice>>> {
    let admin_state = state.admin_state.read().await;
    Ok(Json(admin_state.system_settings().update_notice))
}

pub async fn trigger_cleanup(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<(StatusCode, Json<crate::models::CleanupRunResponse>)> {
    let _ = admin_state::require_admin_access(&headers, &state).await?;
    let report = cleanup_worker::run_cleanup_once(&state).await?;

    Ok((
        StatusCode::ACCEPTED,
        Json(crate::models::CleanupRunResponse::from(report)),
    ))
}

pub async fn metrics(State(state): State<AppState>) -> AppResult<Response> {
    if !state.config.public_metrics_enabled {
        return Ok((
            StatusCode::NOT_FOUND,
            [(
                CONTENT_TYPE,
                HeaderValue::from_static("text/plain; charset=utf-8"),
            )],
            "metrics endpoint is disabled\n".to_owned(),
        )
            .into_response());
    }

    let stats = state.store.stats().await?;
    let metrics = state.metrics.snapshot();
    let payload = render_metrics(&stats, &metrics);

    Ok((
        [(
            CONTENT_TYPE,
            HeaderValue::from_static("text/plain; version=0.0.4; charset=utf-8"),
        )],
        payload,
    )
        .into_response())
}

fn render_metrics(stats: &StoreStats, metrics: &MetricsSnapshot) -> String {
    let mut lines = Vec::new();
    lines.push(format!("tmpmail_domains_total {}", stats.total_domains));
    lines.push(format!("tmpmail_domains_active {}", stats.active_domains));
    lines.push(format!("tmpmail_domains_pending {}", stats.pending_domains));
    lines.push(format!("tmpmail_accounts_total {}", stats.total_accounts));
    lines.push(format!("tmpmail_accounts_active {}", stats.active_accounts));
    lines.push(format!("tmpmail_messages_total {}", stats.total_messages));
    lines.push(format!("tmpmail_messages_active {}", stats.active_messages));
    lines.push(format!(
        "tmpmail_messages_deleted {}",
        stats.deleted_messages
    ));
    lines.push(format!(
        "tmpmail_audit_logs_total {}",
        stats.audit_logs_total
    ));
    lines.push(format!(
        "tmpmail_inbucket_sync_runs_total {}",
        metrics.inbucket_sync_runs_total
    ));
    lines.push(format!(
        "tmpmail_inbucket_sync_failures_total {}",
        metrics.inbucket_sync_failures_total
    ));
    lines.push(format!(
        "tmpmail_imported_messages_total {}",
        metrics.imported_messages_total
    ));
    lines.push(format!(
        "tmpmail_deleted_upstream_messages_total {}",
        metrics.deleted_upstream_messages_total
    ));
    lines.push(format!(
        "tmpmail_domain_verification_runs_total {}",
        metrics.domain_verification_runs_total
    ));
    lines.push(format!(
        "tmpmail_domain_verification_failures_total {}",
        metrics.domain_verification_failures_total
    ));
    lines.push(format!(
        "tmpmail_cleanup_runs_total {}",
        metrics.cleanup_runs_total
    ));
    lines.push(format!(
        "tmpmail_cleanup_deleted_accounts_total {}",
        metrics.cleanup_deleted_accounts_total
    ));
    lines.push(format!(
        "tmpmail_cleanup_deleted_messages_total {}",
        metrics.cleanup_deleted_messages_total
    ));
    lines.push(format!(
        "tmpmail_cleanup_deleted_domains_total {}",
        metrics.cleanup_deleted_domains_total
    ));
    lines.push(format!(
        "tmpmail_realtime_events_total {}",
        metrics.realtime_events_total
    ));
    lines.push(format!(
        "tmpmail_sse_connections_active {}",
        metrics.sse_connections_active
    ));

    if let Some(timestamp) = metrics.last_inbucket_sync_at {
        lines.push(format!(
            "tmpmail_last_inbucket_sync_timestamp {}",
            timestamp.timestamp()
        ));
    }
    if let Some(timestamp) = metrics.last_domain_verification_at {
        lines.push(format!(
            "tmpmail_last_domain_verification_timestamp {}",
            timestamp.timestamp()
        ));
    }
    if let Some(timestamp) = metrics.last_cleanup_at {
        lines.push(format!(
            "tmpmail_last_cleanup_timestamp {}",
            timestamp.timestamp()
        ));
    }

    lines.join("\n") + "\n"
}

#[cfg(test)]
mod tests {
    use axum::{
        body::Body,
        http::{Request, StatusCode, header::CONTENT_TYPE},
    };
    use tower::ServiceExt;

    use crate::{app::build_router, config::Config, state::AppState};

    #[tokio::test]
    async fn public_metrics_are_disabled_by_default() {
        let app = build_router(test_state(Config::default()).await);
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/metrics")
                    .body(Body::empty())
                    .expect("build metrics request"),
            )
            .await
            .expect("metrics response");

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn public_metrics_can_be_enabled_explicitly() {
        let app = build_router(
            test_state(Config {
                public_metrics_enabled: true,
                ..Config::default()
            })
            .await,
        );
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/metrics")
                    .body(Body::empty())
                    .expect("build metrics request"),
            )
            .await
            .expect("metrics response");

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(CONTENT_TYPE)
                .and_then(|value| value.to_str().ok()),
            Some("text/plain; version=0.0.4; charset=utf-8")
        );
    }

    async fn test_state(config: Config) -> AppState {
        let config = Config {
            cleanup_interval_seconds: 0,
            domain_verification_poll_interval_seconds: 0,
            ..config
        };

        crate::test_support::build_test_state(config, "routes-ops").await
    }
}

use axum::{
    Json,
    extract::{Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header::CONTENT_TYPE},
    response::IntoResponse,
};
use serde::Deserialize;

use crate::{
    admin_state, cleanup_worker,
    error::AppResult,
    metrics::MetricsSnapshot,
    models::{AdminAuditLogsResponse, AdminMetricsResponse},
    state::AppState,
    store::StoreStats,
};

#[derive(Debug, Deserialize)]
pub struct AuditLogsQuery {
    pub limit: Option<usize>,
}

pub async fn admin_metrics(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<AdminMetricsResponse>> {
    admin_state::require_admin_access(&headers, &state).await?;

    let stats = {
        let mut store = state.store.lock().await;
        store.stats().await?
    };
    let metrics = state.metrics.snapshot();

    Ok(Json(AdminMetricsResponse::from_parts(stats, metrics)))
}

pub async fn admin_audit_logs(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<AuditLogsQuery>,
) -> AppResult<Json<AdminAuditLogsResponse>> {
    admin_state::require_admin_access(&headers, &state).await?;
    let limit = query.limit.unwrap_or(50).clamp(1, 500);
    let entries = {
        let mut store = state.store.lock().await;
        store.audit_logs(limit).await?
    };

    Ok(Json(AdminAuditLogsResponse { entries }))
}

pub async fn trigger_cleanup(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<(StatusCode, Json<crate::models::CleanupRunResponse>)> {
    admin_state::require_admin_access(&headers, &state).await?;
    let report = cleanup_worker::run_cleanup_once(&state).await?;

    Ok((
        StatusCode::ACCEPTED,
        Json(crate::models::CleanupRunResponse::from(report)),
    ))
}

pub async fn metrics(State(state): State<AppState>) -> AppResult<impl IntoResponse> {
    let stats = {
        let mut store = state.store.lock().await;
        store.stats().await?
    };
    let metrics = state.metrics.snapshot();
    let payload = render_metrics(&stats, &metrics);

    Ok((
        [(
            CONTENT_TYPE,
            HeaderValue::from_static("text/plain; version=0.0.4; charset=utf-8"),
        )],
        payload,
    ))
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

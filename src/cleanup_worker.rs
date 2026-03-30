use std::time::Duration;

use chrono::Duration as ChronoDuration;
use tokio::time::sleep;

use crate::{error::AppResult, state::AppState};

pub fn spawn_cleanup_worker(state: AppState) {
    tokio::spawn(async move {
        let interval = Duration::from_secs(
            state
                .config
                .cleanup_interval_seconds
                .max(30)
                .try_into()
                .unwrap_or(300),
        );

        loop {
            if let Err(error) = run_cleanup_once(&state).await {
                tracing::warn!(error = ?error, "cleanup worker failed");
            }

            sleep(interval).await;
        }
    });
}

pub async fn run_cleanup_once(state: &AppState) -> AppResult<crate::store::CleanupReport> {
    let stale_domain_retention = ChronoDuration::seconds(
        state
            .config
            .pending_domain_retention_seconds
            .max(60),
    );

    let report = {
        let mut store = state.store.write().await;
        let mut report = store.cleanup_expired_accounts();
        report.deleted_domains = store.cleanup_stale_pending_domains(stale_domain_retention);
        report
    };

    state.metrics.record_cleanup_run(
        report.deleted_accounts,
        report.deleted_messages,
        report.deleted_domains,
    );

    if report.deleted_accounts > 0 || report.deleted_messages > 0 || report.deleted_domains > 0 {
        tracing::info!(
            deleted_accounts = report.deleted_accounts,
            deleted_messages = report.deleted_messages,
            deleted_domains = report.deleted_domains,
            "cleanup worker pruned expired state"
        );
    }

    Ok(report)
}

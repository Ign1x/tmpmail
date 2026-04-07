use std::{
    sync::{
        Arc, RwLock,
        atomic::{AtomicI64, AtomicU64, Ordering},
    },
    time::Duration,
};

use chrono::{DateTime, Utc};
use serde::Serialize;
use sysinfo::{CpuRefreshKind, MemoryRefreshKind, RefreshKind, System};
use tokio::time::sleep;

use crate::models::RuntimeStatusSnapshot;

#[derive(Default)]
pub struct AppMetrics {
    inbucket_sync_runs_total: AtomicU64,
    inbucket_sync_failures_total: AtomicU64,
    imported_messages_total: AtomicU64,
    deleted_upstream_messages_total: AtomicU64,
    domain_verification_runs_total: AtomicU64,
    domain_verification_failures_total: AtomicU64,
    cleanup_runs_total: AtomicU64,
    cleanup_deleted_accounts_total: AtomicU64,
    cleanup_deleted_messages_total: AtomicU64,
    cleanup_deleted_domains_total: AtomicU64,
    realtime_events_total: AtomicU64,
    sse_connections_active: AtomicU64,
    last_inbucket_sync_at_unix: AtomicI64,
    last_domain_verification_at_unix: AtomicI64,
    last_cleanup_at_unix: AtomicI64,
    runtime: RwLock<RuntimeStatusSnapshot>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsSnapshot {
    pub inbucket_sync_runs_total: u64,
    pub inbucket_sync_failures_total: u64,
    pub imported_messages_total: u64,
    pub deleted_upstream_messages_total: u64,
    pub domain_verification_runs_total: u64,
    pub domain_verification_failures_total: u64,
    pub cleanup_runs_total: u64,
    pub cleanup_deleted_accounts_total: u64,
    pub cleanup_deleted_messages_total: u64,
    pub cleanup_deleted_domains_total: u64,
    pub realtime_events_total: u64,
    pub sse_connections_active: u64,
    pub last_inbucket_sync_at: Option<DateTime<Utc>>,
    pub last_domain_verification_at: Option<DateTime<Utc>>,
    pub last_cleanup_at: Option<DateTime<Utc>>,
}

impl AppMetrics {
    pub fn record_inbucket_sync_success(&self, imported_messages: usize, deleted_messages: usize) {
        self.inbucket_sync_runs_total
            .fetch_add(1, Ordering::Relaxed);
        self.imported_messages_total
            .fetch_add(imported_messages as u64, Ordering::Relaxed);
        self.deleted_upstream_messages_total
            .fetch_add(deleted_messages as u64, Ordering::Relaxed);
        self.set_timestamp(&self.last_inbucket_sync_at_unix);
    }

    pub fn record_inbucket_sync_failure(&self) {
        self.inbucket_sync_failures_total
            .fetch_add(1, Ordering::Relaxed);
        self.set_timestamp(&self.last_inbucket_sync_at_unix);
    }

    pub fn record_domain_verification_run(&self, failures: usize) {
        self.domain_verification_runs_total
            .fetch_add(1, Ordering::Relaxed);
        if failures > 0 {
            self.domain_verification_failures_total
                .fetch_add(failures as u64, Ordering::Relaxed);
        }
        self.set_timestamp(&self.last_domain_verification_at_unix);
    }

    pub fn record_cleanup_run(
        &self,
        deleted_accounts: usize,
        deleted_messages: usize,
        deleted_domains: usize,
    ) {
        self.cleanup_runs_total.fetch_add(1, Ordering::Relaxed);
        self.cleanup_deleted_accounts_total
            .fetch_add(deleted_accounts as u64, Ordering::Relaxed);
        self.cleanup_deleted_messages_total
            .fetch_add(deleted_messages as u64, Ordering::Relaxed);
        self.cleanup_deleted_domains_total
            .fetch_add(deleted_domains as u64, Ordering::Relaxed);
        self.set_timestamp(&self.last_cleanup_at_unix);
    }

    pub fn record_realtime_event(&self) {
        self.realtime_events_total.fetch_add(1, Ordering::Relaxed);
    }

    pub fn try_open_sse_connection(&self, limit: usize) -> bool {
        self.sse_connections_active
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |current| {
                (current < limit as u64).then_some(current + 1)
            })
            .is_ok()
    }

    pub fn close_sse_connection(&self) {
        let _ = self.sse_connections_active.fetch_update(
            Ordering::Relaxed,
            Ordering::Relaxed,
            |current| Some(current.saturating_sub(1)),
        );
    }

    pub fn snapshot(&self) -> MetricsSnapshot {
        MetricsSnapshot {
            inbucket_sync_runs_total: self.inbucket_sync_runs_total.load(Ordering::Relaxed),
            inbucket_sync_failures_total: self.inbucket_sync_failures_total.load(Ordering::Relaxed),
            imported_messages_total: self.imported_messages_total.load(Ordering::Relaxed),
            deleted_upstream_messages_total: self
                .deleted_upstream_messages_total
                .load(Ordering::Relaxed),
            domain_verification_runs_total: self
                .domain_verification_runs_total
                .load(Ordering::Relaxed),
            domain_verification_failures_total: self
                .domain_verification_failures_total
                .load(Ordering::Relaxed),
            cleanup_runs_total: self.cleanup_runs_total.load(Ordering::Relaxed),
            cleanup_deleted_accounts_total: self
                .cleanup_deleted_accounts_total
                .load(Ordering::Relaxed),
            cleanup_deleted_messages_total: self
                .cleanup_deleted_messages_total
                .load(Ordering::Relaxed),
            cleanup_deleted_domains_total: self
                .cleanup_deleted_domains_total
                .load(Ordering::Relaxed),
            realtime_events_total: self.realtime_events_total.load(Ordering::Relaxed),
            sse_connections_active: self.sse_connections_active.load(Ordering::Relaxed),
            last_inbucket_sync_at: unix_to_datetime(
                self.last_inbucket_sync_at_unix.load(Ordering::Relaxed),
            ),
            last_domain_verification_at: unix_to_datetime(
                self.last_domain_verification_at_unix
                    .load(Ordering::Relaxed),
            ),
            last_cleanup_at: unix_to_datetime(self.last_cleanup_at_unix.load(Ordering::Relaxed)),
        }
    }

    pub fn record_runtime_snapshot(&self, snapshot: RuntimeStatusSnapshot) {
        if let Ok(mut current) = self.runtime.write() {
            *current = snapshot;
        }
    }

    pub fn runtime_snapshot(&self) -> RuntimeStatusSnapshot {
        self.runtime
            .read()
            .map(|snapshot| snapshot.clone())
            .unwrap_or_default()
    }

    fn set_timestamp(&self, cell: &AtomicI64) {
        cell.store(Utc::now().timestamp(), Ordering::Relaxed);
    }
}

pub fn spawn_runtime_sampler(metrics: Arc<AppMetrics>) {
    tokio::spawn(async move {
        let mut system = System::new_with_specifics(
            RefreshKind::nothing()
                .with_cpu(CpuRefreshKind::everything())
                .with_memory(MemoryRefreshKind::everything()),
        );

        system.refresh_memory();
        system.refresh_cpu_usage();

        loop {
            sleep(Duration::from_secs(2)).await;
            system.refresh_memory();
            system.refresh_cpu_usage();

            let memory_total = system.total_memory();
            let memory_used = system.used_memory();
            let memory_usage_percent = if memory_total == 0 {
                0.0
            } else {
                ((memory_used as f64 / memory_total as f64) * 100.0) as f32
            };

            metrics.record_runtime_snapshot(RuntimeStatusSnapshot {
                cpu_usage_percent: round_one_decimal(system.global_cpu_usage()),
                memory_used_bytes: memory_used,
                memory_total_bytes: memory_total,
                memory_usage_percent: round_one_decimal(memory_usage_percent),
                uptime_seconds: System::uptime(),
            });
        }
    });
}

fn unix_to_datetime(timestamp: i64) -> Option<DateTime<Utc>> {
    if timestamp <= 0 {
        return None;
    }

    DateTime::from_timestamp(timestamp, 0)
}

fn round_one_decimal(value: f32) -> f32 {
    (value * 10.0).round() / 10.0
}

#[cfg(test)]
mod tests {
    use super::AppMetrics;

    #[test]
    fn close_sse_connection_saturates_at_zero() {
        let metrics = AppMetrics::default();

        metrics.close_sse_connection();
        metrics.close_sse_connection();

        assert_eq!(metrics.snapshot().sse_connections_active, 0);
    }

    #[test]
    fn close_sse_connection_balances_open_count_without_underflow() {
        let metrics = AppMetrics::default();

        assert!(metrics.try_open_sse_connection(2));
        assert!(metrics.try_open_sse_connection(2));
        metrics.close_sse_connection();
        metrics.close_sse_connection();
        metrics.close_sse_connection();

        assert_eq!(metrics.snapshot().sse_connections_active, 0);
    }

    #[test]
    fn try_open_sse_connection_enforces_limit() {
        let metrics = AppMetrics::default();

        assert!(metrics.try_open_sse_connection(1));
        assert!(!metrics.try_open_sse_connection(1));
        assert_eq!(metrics.snapshot().sse_connections_active, 1);
    }
}

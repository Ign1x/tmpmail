use std::{sync::Arc, time::Duration};

use anyhow::Context;
use tokio::{
    sync::{Mutex, MutexGuard, RwLock},
    time::timeout,
};

use crate::{
    admin_state::AdminStateStore, app_store::AppStore, config::Config, inbucket::InbucketClient,
    metrics::AppMetrics, realtime::RealtimeBroker,
};

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub inbucket_client: Option<Arc<InbucketClient>>,
    pub admin_state: Arc<RwLock<AdminStateStore>>,
    pub metrics: Arc<AppMetrics>,
    pub realtime: Arc<RealtimeBroker>,
    pub store: Arc<Mutex<AppStore>>,
}

impl AppState {
    pub async fn new(config: Config) -> anyhow::Result<Self> {
        let store = AppStore::new(&config).await.with_context(|| {
            format!(
                "failed to initialize store from {}",
                config
                    .database_url
                    .clone()
                    .unwrap_or_else(|| config.store_state_path.clone())
            )
        })?;
        let mut admin_state =
            AdminStateStore::load(&config.admin_state_path).with_context(|| {
                format!(
                    "failed to initialize admin state from {}",
                    config.admin_state_path
                )
            })?;
        if let Some(password) = config.admin_password.as_deref() {
            admin_state
                .sync_default_admin_from_env(password)
                .with_context(|| "failed to sync admin password from TMPMAIL_ADMIN_PASSWORD")?;
        }
        let inbucket_client = if config.ingest_mode == "remote-inbucket" {
            config
                .inbucket_base_url
                .clone()
                .and_then(|base_url| {
                    match InbucketClient::new(
                        base_url,
                        config.inbucket_username.clone(),
                        config.inbucket_password.clone(),
                        Duration::from_secs(
                            config
                                .inbucket_request_timeout_seconds
                                .max(5)
                                .try_into()
                                .unwrap_or(15),
                        ),
                        config.inbucket_request_retries,
                        Duration::from_millis(
                            config.inbucket_retry_backoff_milliseconds.clamp(50, 10_000),
                        ),
                    ) {
                        Ok(client) => Some(client),
                        Err(error) => {
                            tracing::warn!(error = ?error, "failed to initialize inbucket client");
                            None
                        }
                    }
                })
                .map(Arc::new)
        } else {
            None
        };
        let metrics = Arc::new(AppMetrics::default());
        let realtime = Arc::new(RealtimeBroker::new(256));

        Ok(Self {
            config: Arc::new(config),
            inbucket_client,
            admin_state: Arc::new(RwLock::new(admin_state)),
            metrics,
            realtime,
            store: Arc::new(Mutex::new(store)),
        })
    }

    pub async fn try_lock_store_for_background(
        &self,
        task_name: &'static str,
    ) -> Option<MutexGuard<'_, AppStore>> {
        let timeout_ms = self
            .config
            .background_store_lock_timeout_milliseconds
            .clamp(25, 5_000);

        match timeout(Duration::from_millis(timeout_ms), self.store.lock()).await {
            Ok(guard) => Some(guard),
            Err(_) => {
                tracing::debug!(
                    task = task_name,
                    timeout_ms,
                    "skipping background store work because the store lock is busy"
                );
                None
            }
        }
    }

    pub async fn effective_runtime_config(&self) -> Config {
        let mut config = self.config.as_ref().clone();
        let admin_state = self.admin_state.read().await;
        admin_state.apply_runtime_overrides(&mut config);
        config
    }
}

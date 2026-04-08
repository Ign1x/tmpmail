use std::{sync::Arc, time::Duration};

use anyhow::Context;
use tokio::{
    sync::{Mutex, OwnedSemaphorePermit, RwLock, Semaphore},
    time::timeout,
};

#[cfg(test)]
use crate::test_support::TestDatabase;
use crate::{
    admin_state::AdminStateStore,
    app_store::AppStore,
    config::{AdminPasswordMode, Config},
    inbucket::InbucketClient,
    metrics::AppMetrics,
    otp::OtpStore,
    rate_limit::FixedWindowRateLimiter,
    realtime::RealtimeBroker,
};

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub inbucket_client: Option<Arc<InbucketClient>>,
    pub admin_state: Arc<RwLock<AdminStateStore>>,
    pub metrics: Arc<AppMetrics>,
    pub auth_attempt_limiter: Arc<Mutex<FixedWindowRateLimiter>>,
    pub otp_send_limiter: Arc<Mutex<FixedWindowRateLimiter>>,
    pub otp_store: Arc<OtpStore>,
    pub realtime: Arc<RealtimeBroker>,
    pub store: Arc<AppStore>,
    background_store_gate: Arc<Semaphore>,
    #[cfg(test)]
    test_database: Option<TestDatabase>,
}

impl AppState {
    pub async fn new(config: Config) -> anyhow::Result<Self> {
        let store = AppStore::new(&config)
            .await
            .with_context(|| format!("failed to initialize store from {}", config.database_url))?;
        let mut admin_state = AdminStateStore::load(&config).await.with_context(|| {
            format!(
                "failed to initialize admin state from {}",
                config.database_url
            )
        })?;
        if let Some(password) = config.admin_password.as_deref() {
            match config.admin_password_mode {
                AdminPasswordMode::Disabled => {
                    tracing::warn!(
                        "ignoring TMPMAIL_ADMIN_PASSWORD because TMPMAIL_ADMIN_PASSWORD_MODE=disabled"
                    );
                }
                AdminPasswordMode::Bootstrap => {
                    admin_state
                        .bootstrap_default_admin_from_env(password)
                        .with_context(|| "failed to bootstrap admin from TMPMAIL_ADMIN_PASSWORD")?;
                }
                AdminPasswordMode::Force => {
                    admin_state
                        .force_sync_default_admin_from_env(password)
                        .with_context(
                            || "failed to force-sync admin password from TMPMAIL_ADMIN_PASSWORD",
                        )?;
                }
            }
        }
        admin_state
            .sync_linux_do_client_secret_from_env(config.linux_do_client_secret.as_deref())
            .with_context(
                || "failed to sync linux.do client secret from TMPMAIL_LINUX_DO_CLIENT_SECRET",
            )?;
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
        let auth_attempt_limiter = Arc::new(Mutex::new(FixedWindowRateLimiter::default()));
        let otp_send_limiter = Arc::new(Mutex::new(FixedWindowRateLimiter::default()));
        let otp_store = Arc::new(OtpStore::new(&config).await.with_context(|| {
            format!(
                "failed to initialize otp state from {}",
                config.database_url
            )
        })?);
        let realtime = Arc::new(RealtimeBroker::new(256));

        Ok(Self {
            config: Arc::new(config),
            inbucket_client,
            admin_state: Arc::new(RwLock::new(admin_state)),
            metrics,
            auth_attempt_limiter,
            otp_send_limiter,
            otp_store,
            realtime,
            store: Arc::new(store),
            background_store_gate: Arc::new(Semaphore::new(1)),
            #[cfg(test)]
            test_database: None,
        })
    }

    #[cfg(test)]
    pub(crate) fn with_test_database(mut self, database: TestDatabase) -> Self {
        self.test_database = Some(database);
        self
    }

    pub async fn try_lock_store_for_background(
        &self,
        task_name: &'static str,
    ) -> Option<OwnedSemaphorePermit> {
        let timeout_ms = self
            .config
            .background_store_lock_timeout_milliseconds
            .clamp(25, 5_000);

        match timeout(
            Duration::from_millis(timeout_ms),
            self.background_store_gate.clone().acquire_owned(),
        )
        .await
        {
            Ok(Ok(permit)) => Some(permit),
            Ok(Err(_)) | Err(_) => {
                tracing::debug!(
                    task = task_name,
                    timeout_ms,
                    "skipping background store work because the background store gate is busy"
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

#[cfg(test)]
mod tests {
    use super::AppState;
    use crate::config::{AdminPasswordMode, Config};
    use crate::test_support::build_test_state;

    #[tokio::test]
    async fn bootstrap_mode_only_applies_to_first_start() {
        let first = test_config(Some("Bootstrap12345!"), AdminPasswordMode::Bootstrap);
        let state = build_test_state(first.clone(), "state-bootstrap-first").await;
        {
            let mut admin_state = state.admin_state.write().await;
            admin_state
                .authenticate("admin", "Bootstrap12345!")
                .expect("initial bootstrap password");
        }

        let second = Config {
            database_url: state.config.database_url.clone(),
            ..test_config(Some("ChangedAdmin123!"), AdminPasswordMode::Bootstrap)
        };
        let state = AppState::new(second)
            .await
            .expect("build second state")
            .with_test_database(
                state
                    .test_database
                    .clone()
                    .expect("preserve isolated test database"),
            );
        let mut admin_state = state.admin_state.write().await;
        assert!(
            admin_state
                .authenticate("admin", "ChangedAdmin123!")
                .is_err()
        );
        admin_state
            .authenticate("admin", "Bootstrap12345!")
            .expect("bootstrap mode should preserve existing password");
    }

    #[tokio::test]
    async fn force_mode_resets_existing_admin_password() {
        let first = test_config(Some("Bootstrap12345!"), AdminPasswordMode::Bootstrap);
        let first_state = build_test_state(first, "state-force-first").await;

        let second = Config {
            database_url: first_state.config.database_url.clone(),
            ..test_config(Some("ForcedAdmin123!"), AdminPasswordMode::Force)
        };
        let state = AppState::new(second)
            .await
            .expect("build forced state")
            .with_test_database(
                first_state
                    .test_database
                    .clone()
                    .expect("preserve isolated test database"),
            );
        let mut admin_state = state.admin_state.write().await;
        assert!(
            admin_state
                .authenticate("admin", "Bootstrap12345!")
                .is_err()
        );
        admin_state
            .authenticate("admin", "ForcedAdmin123!")
            .expect("force mode should rotate existing password");
    }

    #[tokio::test]
    async fn disabled_mode_ignores_bootstrap_password() {
        let config = test_config(Some("IgnoredAdmin123!"), AdminPasswordMode::Disabled);
        let state = build_test_state(config, "state-disabled").await;
        let admin_state = state.admin_state.read().await;

        assert!(admin_state.is_bootstrap_required());
    }

    fn test_config(admin_password: Option<&str>, admin_password_mode: AdminPasswordMode) -> Config {
        Config {
            admin_password: admin_password.map(ToOwned::to_owned),
            admin_password_mode,
            cleanup_interval_seconds: 0,
            domain_verification_poll_interval_seconds: 0,
            ..Config::default()
        }
    }
}

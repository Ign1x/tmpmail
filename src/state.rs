use std::sync::Arc;

use anyhow::Context;
use tokio::sync::{Mutex, RwLock};

use crate::{
    admin_state::AdminStateStore, app_store::AppStore, config::Config,
    inbucket::InbucketClient, metrics::AppMetrics, realtime::RealtimeBroker,
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
        let admin_state = AdminStateStore::load(&config.admin_state_path).with_context(|| {
            format!(
                "failed to initialize admin state from {}",
                config.admin_state_path
            )
        })?;
        let inbucket_client = if config.ingest_mode == "remote-inbucket" {
            config
                .inbucket_base_url
                .clone()
                .and_then(|base_url| {
                    match InbucketClient::new(
                        base_url,
                        config.inbucket_username.clone(),
                        config.inbucket_password.clone(),
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
}

use std::sync::Arc;

use anyhow::Context;
use tokio::sync::RwLock;

use crate::{admin_state::AdminStateStore, config::Config, inbucket::InbucketClient, store::MemoryStore};

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub inbucket_client: Option<Arc<InbucketClient>>,
    pub admin_state: Arc<RwLock<AdminStateStore>>,
    pub store: Arc<RwLock<MemoryStore>>,
}

impl AppState {
    pub fn new(config: Config) -> anyhow::Result<Self> {
        let store = MemoryStore::new(&config);
        let admin_state = AdminStateStore::load(&config.admin_state_path)
            .with_context(|| format!("failed to initialize admin state from {}", config.admin_state_path))?;
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

        Ok(Self {
            config: Arc::new(config),
            inbucket_client,
            admin_state: Arc::new(RwLock::new(admin_state)),
            store: Arc::new(RwLock::new(store)),
        })
    }
}

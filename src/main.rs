mod admin_state;
mod app;
mod app_store;
mod auth;
mod cleanup_worker;
mod config;
mod domain_management;
mod domain_worker;
mod error;
mod inbucket;
mod ingest;
mod metrics;
mod models;
mod pg_store;
mod realtime;
mod routes;
mod state;
mod store;

use anyhow::Context;
use tokio::net::TcpListener;
use tracing_subscriber::{EnvFilter, fmt};

use crate::{
    app::build_router, cleanup_worker::spawn_cleanup_worker, config::Config,
    domain_worker::spawn_domain_verifier, ingest::spawn_inbucket_poller, state::AppState,
};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing();

    let config = Config::from_env();
    let bind_address = config.bind_address();
    let ingest_mode = config.ingest_mode.clone();
    let inbucket_base_url = config.inbucket_base_url.clone();
    let inbucket_auth_configured =
        config.inbucket_username.is_some() && config.inbucket_password.is_some();
    let inbucket_poll_interval_seconds = config.inbucket_poll_interval_seconds;
    let app_state = AppState::new(config).await?;

    let listener = TcpListener::bind(&bind_address)
        .await
        .with_context(|| format!("failed to bind {bind_address}"))?;

    tracing::info!(
        address = %bind_address,
        ingest_mode = %ingest_mode,
        inbucket_base_url = ?inbucket_base_url,
        inbucket_auth_configured,
        inbucket_poll_interval_seconds,
        "tmpmail api listening"
    );

    if let Some(client) = app_state.inbucket_client.clone() {
        spawn_inbucket_poller(app_state.clone(), client);
        tracing::info!("spawned inbucket background poller");
    }

    if app_state.config.domain_verification_poll_interval_seconds > 0 {
        spawn_domain_verifier(app_state.clone());
        tracing::info!("spawned domain verification worker");
    }

    if app_state.config.cleanup_interval_seconds > 0 {
        spawn_cleanup_worker(app_state.clone());
        tracing::info!("spawned cleanup worker");
    }

    axum::serve(listener, build_router(app_state))
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("server terminated unexpectedly")?;

    Ok(())
}

fn init_tracing() {
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("tmpmail_api=debug,tower_http=info"));

    fmt().with_env_filter(env_filter).compact().init();
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        let mut signal = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler");
        signal.recv().await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    tracing::info!("shutdown signal received");
}

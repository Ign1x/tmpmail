use std::time::Duration;

use tokio::time::sleep;

use crate::{domain_management::verify_domain_dns, state::AppState};

pub fn spawn_domain_verifier(state: AppState) {
    tokio::spawn(async move {
        let poll_interval = Duration::from_secs(
            state
                .config
                .domain_verification_poll_interval_seconds
                .max(5)
                .try_into()
                .unwrap_or(60),
        );

        loop {
            if let Err(error) = verify_pending_domains(&state).await {
                tracing::warn!(error = ?error, "domain verification sync failed");
            }

            sleep(poll_interval).await;
        }
    });
}

async fn verify_pending_domains(state: &AppState) -> crate::error::AppResult<()> {
    let pending = {
        let store = state.store.read().await;
        store.pending_domain_checks()
    };

    for domain in pending {
        let result =
            verify_domain_dns(&domain.domain, &domain.verification_token, &state.config).await;
        let mut store = state.store.write().await;
        let _ = store.update_domain_verification_status(domain.id, result.is_ok(), result.err())?;
    }

    Ok(())
}

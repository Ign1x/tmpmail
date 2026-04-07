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
    let Some(_permit) = state
        .try_lock_store_for_background("domain-verification")
        .await
    else {
        return Ok(());
    };
    let pending = state.store.pending_domain_checks().await?;
    drop(_permit);

    let mut failures = 0_usize;
    for domain in pending {
        let config = state.effective_runtime_config().await;
        let result = verify_domain_dns(&domain.domain, &domain.verification_token, &config).await;
        if result.is_err() {
            failures += 1;
        }
        let Some(_permit) = state
            .try_lock_store_for_background("domain-verification")
            .await
        else {
            continue;
        };
        let _ = state
            .store
            .update_domain_verification_status(domain.id, result.is_ok(), result.err())
            .await?;
    }

    state.metrics.record_domain_verification_run(failures);

    Ok(())
}

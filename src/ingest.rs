use std::{collections::HashSet, sync::Arc, time::Duration};

use tokio::time::sleep;

use crate::{
    error::AppResult,
    inbucket::{InbucketClient, mailbox_name_from_address, normalized_recipient_addresses},
    state::AppState,
};

pub fn spawn_inbucket_poller(state: AppState, client: Arc<InbucketClient>) {
    tokio::spawn(async move {
        let poll_interval = Duration::from_secs(
            state
                .config
                .inbucket_poll_interval_seconds
                .max(1)
                .try_into()
                .unwrap_or(15),
        );

        loop {
            if let Err(error) = sync_once(&state, &client).await {
                state.metrics.record_inbucket_sync_failure();
                tracing::warn!(error = ?error, "inbucket sync failed");
            }

            sleep(poll_interval).await;
        }
    });
}

pub async fn sync_once(state: &AppState, client: &InbucketClient) -> AppResult<()> {
    let Some(_permit) = state.try_lock_store_for_background("inbucket-sync").await else {
        return Ok(());
    };
    let mailboxes = active_mailboxes(&state.store.active_account_addresses().await?);
    drop(_permit);

    let mut imported_total = 0_usize;
    let mut deleted_total = 0_usize;

    for mailbox in mailboxes {
        let messages = client
            .list_mailbox(&mailbox)
            .await
            .map_err(|error| crate::error::ApiError::internal(error.to_string()))?;
        let active_source_keys = messages
            .iter()
            .map(|summary| format!("{mailbox}:{}", summary.id))
            .collect::<HashSet<_>>();

        let deleted_count = {
            let Some(_permit) = state.try_lock_store_for_background("inbucket-sync").await else {
                continue;
            };
            state
                .store
                .reconcile_mailbox_sources(&mailbox, &active_source_keys)
                .await?
        };
        deleted_total += deleted_count;

        for summary in messages {
            let source_key = format!("{mailbox}:{}", summary.id);
            let already_imported = {
                let Some(_permit) = state.try_lock_store_for_background("inbucket-sync").await
                else {
                    continue;
                };
                state.store.has_imported_source(&source_key).await?
            };

            if already_imported {
                continue;
            }

            let imported = client
                .get_message(&mailbox, &summary.id)
                .await
                .map_err(|error| crate::error::ApiError::internal(error.to_string()))?;
            let recipients = normalized_recipient_addresses(&imported);

            if recipients.is_empty() {
                continue;
            }

            let imported_receipts = {
                let Some(_permit) = state.try_lock_store_for_background("inbucket-sync").await
                else {
                    continue;
                };
                state
                    .store
                    .import_message_for_recipients(&recipients, imported.clone())
                    .await?
            };

            if !imported_receipts.is_empty() {
                imported_total += imported_receipts.len();
                for receipt in imported_receipts {
                    state.realtime.publish(
                        &state.metrics,
                        "message.created",
                        receipt.account_id,
                        Some(receipt.message_id),
                    );
                }
                tracing::info!(
                    mailbox = %mailbox,
                    source_key = %source_key,
                    imported_count = imported_total,
                    "imported message from inbucket"
                );
            }
        }
    }

    state
        .metrics
        .record_inbucket_sync_success(imported_total, deleted_total);

    Ok(())
}

fn active_mailboxes(addresses: &[String]) -> Vec<String> {
    let mut mailboxes = HashSet::new();

    for address in addresses {
        if let Some(mailbox) = mailbox_name_from_address(address) {
            mailboxes.insert(mailbox);
        }
    }

    let mut values = mailboxes.into_iter().collect::<Vec<_>>();
    values.sort();
    values
}

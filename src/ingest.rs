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
                tracing::warn!(error = ?error, "inbucket sync failed");
            }

            sleep(poll_interval).await;
        }
    });
}

pub async fn sync_once(state: &AppState, client: &InbucketClient) -> AppResult<()> {
    let mailboxes = {
        let store = state.store.read().await;
        active_mailboxes(&store.active_account_addresses())
    };

    for mailbox in mailboxes {
        let messages = client
            .list_mailbox(&mailbox)
            .await
            .map_err(|error| crate::error::ApiError::internal(error.to_string()))?;

        for summary in messages {
            let source_key = format!("{mailbox}:{}", summary.id);
            let already_imported = {
                let store = state.store.read().await;
                store.has_imported_source(&source_key)
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

            let imported_count = {
                let mut store = state.store.write().await;
                store.import_message_for_recipients(&recipients, imported.clone())?
            };

            if imported_count > 0 {
                tracing::info!(
                    mailbox = %mailbox,
                    source_key = %source_key,
                    imported_count,
                    "imported message from inbucket"
                );
            }
        }
    }

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

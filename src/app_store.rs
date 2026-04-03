use std::collections::HashSet;

use chrono::Duration;
use uuid::Uuid;

use crate::{
    config::Config,
    error::AppResult,
    models::{
        Account, Domain, DomainDnsRecord, ImportedMessage, MessageDetail, MessageSeenResponse,
        MessageSummary,
    },
    pg_store::PgStore,
    store::{CleanupReport, ImportedMessageReceipt, MemoryStore, PendingDomainCheck, StoreStats},
};

#[derive(Debug)]
pub enum AppStore {
    Memory(MemoryStore),
    Postgres(PgStore),
}

impl AppStore {
    pub async fn new(config: &Config) -> AppResult<Self> {
        if let Some(database_url) = config
            .database_url
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return Ok(Self::Postgres(PgStore::new(config, database_url).await?));
        }

        Ok(Self::Memory(MemoryStore::new(config)?))
    }

    pub async fn list_domains(&mut self) -> AppResult<Vec<Domain>> {
        match self {
            Self::Memory(store) => Ok(store.list_domains()),
            Self::Postgres(store) => store.list_domains().await,
        }
    }

    pub async fn list_all_domains(&mut self) -> AppResult<Vec<Domain>> {
        match self {
            Self::Memory(store) => Ok(store.list_all_domains()),
            Self::Postgres(store) => store.list_all_domains().await,
        }
    }

    pub async fn list_domains_for_owner(&mut self, owner_user_id: Uuid) -> AppResult<Vec<Domain>> {
        match self {
            Self::Memory(store) => Ok(store.list_domains_for_owner(owner_user_id)),
            Self::Postgres(store) => store.list_domains_for_owner(owner_user_id).await,
        }
    }

    pub async fn count_domains_owned_by(&mut self, owner_user_id: Uuid) -> AppResult<usize> {
        match self {
            Self::Memory(store) => Ok(store.count_domains_owned_by(owner_user_id)),
            Self::Postgres(store) => store.count_domains_owned_by(owner_user_id).await,
        }
    }

    pub async fn domain_owner_user_id(&mut self, domain_id: Uuid) -> AppResult<Option<Uuid>> {
        match self {
            Self::Memory(store) => store.domain_owner_user_id(domain_id),
            Self::Postgres(store) => store.domain_owner_user_id(domain_id).await,
        }
    }

    pub async fn create_domain(
        &mut self,
        domain: &str,
        owner_user_id: Option<Uuid>,
    ) -> AppResult<Domain> {
        match self {
            Self::Memory(store) => store.create_domain(domain, owner_user_id),
            Self::Postgres(store) => store.create_domain(domain, owner_user_id).await,
        }
    }

    pub async fn domain_dns_records(
        &mut self,
        domain_id: Uuid,
        config: &Config,
    ) -> AppResult<Vec<DomainDnsRecord>> {
        match self {
            Self::Memory(store) => store.domain_dns_records(domain_id, config),
            Self::Postgres(store) => store.domain_dns_records(domain_id, config).await,
        }
    }

    pub async fn domain_verification_context(
        &mut self,
        domain_id: Uuid,
    ) -> AppResult<(String, String)> {
        match self {
            Self::Memory(store) => store.domain_verification_context(domain_id),
            Self::Postgres(store) => store.domain_verification_context(domain_id).await,
        }
    }

    pub async fn delete_domain(&mut self, domain_id: Uuid) -> AppResult<()> {
        match self {
            Self::Memory(store) => store.delete_domain(domain_id),
            Self::Postgres(store) => store.delete_domain(domain_id).await,
        }
    }

    pub async fn update_domain_verification_status(
        &mut self,
        domain_id: Uuid,
        is_verified: bool,
        verification_error: Option<String>,
    ) -> AppResult<Domain> {
        match self {
            Self::Memory(store) => {
                store.update_domain_verification_status(domain_id, is_verified, verification_error)
            }
            Self::Postgres(store) => {
                store
                    .update_domain_verification_status(domain_id, is_verified, verification_error)
                    .await
            }
        }
    }

    pub async fn pending_domain_checks(&mut self) -> AppResult<Vec<PendingDomainCheck>> {
        match self {
            Self::Memory(store) => Ok(store.pending_domain_checks()),
            Self::Postgres(store) => store.pending_domain_checks().await,
        }
    }

    pub async fn create_account(
        &mut self,
        address: &str,
        password: &str,
        expires_in: Option<i64>,
    ) -> AppResult<Account> {
        match self {
            Self::Memory(store) => store.create_account(address, password, expires_in),
            Self::Postgres(store) => store.create_account(address, password, expires_in).await,
        }
    }

    pub async fn create_account_for_owner(
        &mut self,
        address: &str,
        password: &str,
        expires_in: Option<i64>,
        owner_user_id: Option<Uuid>,
    ) -> AppResult<Account> {
        match self {
            Self::Memory(store) => {
                store.create_account_for_owner(address, password, expires_in, owner_user_id)
            }
            Self::Postgres(store) => {
                store
                    .create_account_for_owner(address, password, expires_in, owner_user_id)
                    .await
            }
        }
    }

    pub async fn authenticate(
        &mut self,
        address: &str,
        password: &str,
    ) -> AppResult<(Uuid, String)> {
        match self {
            Self::Memory(store) => store.authenticate(address, password),
            Self::Postgres(store) => store.authenticate(address, password).await,
        }
    }

    pub async fn get_account(&mut self, account_id: Uuid) -> AppResult<Account> {
        match self {
            Self::Memory(store) => store.get_account(account_id),
            Self::Postgres(store) => store.get_account(account_id).await,
        }
    }

    pub async fn list_accounts_for_owner(
        &mut self,
        owner_user_id: Uuid,
    ) -> AppResult<Vec<Account>> {
        match self {
            Self::Memory(store) => Ok(store.list_accounts_for_owner(owner_user_id)),
            Self::Postgres(store) => store.list_accounts_for_owner(owner_user_id).await,
        }
    }

    pub async fn count_accounts_owned_by(&mut self, owner_user_id: Uuid) -> AppResult<usize> {
        match self {
            Self::Memory(store) => Ok(store.count_accounts_owned_by(owner_user_id)),
            Self::Postgres(store) => store.count_accounts_owned_by(owner_user_id).await,
        }
    }

    pub async fn account_owner_user_id(&mut self, account_id: Uuid) -> AppResult<Option<Uuid>> {
        match self {
            Self::Memory(store) => store.account_owner_user_id(account_id),
            Self::Postgres(store) => store.account_owner_user_id(account_id).await,
        }
    }

    pub async fn delete_account(&mut self, account_id: Uuid) -> AppResult<()> {
        match self {
            Self::Memory(store) => store.delete_account(account_id),
            Self::Postgres(store) => store.delete_account(account_id).await,
        }
    }

    pub async fn active_account_addresses(&mut self) -> AppResult<Vec<String>> {
        match self {
            Self::Memory(store) => Ok(store.active_account_addresses()),
            Self::Postgres(store) => store.active_account_addresses().await,
        }
    }

    pub async fn has_imported_source(&mut self, source_key: &str) -> AppResult<bool> {
        match self {
            Self::Memory(store) => Ok(store.has_imported_source(source_key)),
            Self::Postgres(store) => store.has_imported_source(source_key).await,
        }
    }

    pub async fn import_message_for_recipients(
        &mut self,
        recipients: &[String],
        imported: ImportedMessage,
    ) -> AppResult<Vec<ImportedMessageReceipt>> {
        match self {
            Self::Memory(store) => store.import_message_for_recipients(recipients, imported),
            Self::Postgres(store) => {
                store
                    .import_message_for_recipients(recipients, imported)
                    .await
            }
        }
    }

    pub async fn list_messages(
        &mut self,
        account_id: Uuid,
        page: usize,
    ) -> AppResult<(Vec<MessageSummary>, usize)> {
        match self {
            Self::Memory(store) => store.list_messages(account_id, page),
            Self::Postgres(store) => store.list_messages(account_id, page).await,
        }
    }

    pub async fn get_message(
        &mut self,
        account_id: Uuid,
        message_id: Uuid,
    ) -> AppResult<MessageDetail> {
        match self {
            Self::Memory(store) => store.get_message(account_id, message_id),
            Self::Postgres(store) => store.get_message(account_id, message_id).await,
        }
    }

    pub async fn mark_message_seen(
        &mut self,
        account_id: Uuid,
        message_id: Uuid,
        seen: bool,
    ) -> AppResult<MessageSeenResponse> {
        match self {
            Self::Memory(store) => store.mark_message_seen(account_id, message_id, seen),
            Self::Postgres(store) => store.mark_message_seen(account_id, message_id, seen).await,
        }
    }

    pub async fn delete_message(&mut self, account_id: Uuid, message_id: Uuid) -> AppResult<()> {
        match self {
            Self::Memory(store) => store.delete_message(account_id, message_id),
            Self::Postgres(store) => store.delete_message(account_id, message_id).await,
        }
    }

    pub async fn reconcile_mailbox_sources(
        &mut self,
        mailbox: &str,
        active_source_keys: &HashSet<String>,
    ) -> AppResult<usize> {
        match self {
            Self::Memory(store) => store.reconcile_mailbox_sources(mailbox, active_source_keys),
            Self::Postgres(store) => {
                store
                    .reconcile_mailbox_sources(mailbox, active_source_keys)
                    .await
            }
        }
    }

    pub async fn cleanup_expired_accounts(&mut self) -> AppResult<CleanupReport> {
        match self {
            Self::Memory(store) => store.cleanup_expired_accounts(),
            Self::Postgres(store) => store.cleanup_expired_accounts().await,
        }
    }

    pub async fn cleanup_stale_pending_domains(&mut self, max_age: Duration) -> AppResult<usize> {
        match self {
            Self::Memory(store) => store.cleanup_stale_pending_domains(max_age),
            Self::Postgres(store) => store.cleanup_stale_pending_domains(max_age).await,
        }
    }

    pub async fn stats(&mut self) -> AppResult<StoreStats> {
        match self {
            Self::Memory(store) => Ok(store.stats()),
            Self::Postgres(store) => store.stats().await,
        }
    }

    pub async fn audit_logs(&mut self, limit: usize) -> AppResult<Vec<String>> {
        match self {
            Self::Memory(store) => Ok(store.audit_logs(limit)),
            Self::Postgres(store) => store.audit_logs(limit).await,
        }
    }

    pub async fn clear_audit_logs(&mut self) -> AppResult<()> {
        match self {
            Self::Memory(store) => store.clear_audit_logs(),
            Self::Postgres(store) => store.clear_audit_logs().await,
        }
    }

    pub async fn append_audit_log(
        &mut self,
        action: &str,
        entity_type: &str,
        entity_id: String,
        actor_id: Option<String>,
        detail: String,
    ) -> AppResult<()> {
        match self {
            Self::Memory(store) => {
                store.append_audit_log(action, entity_type, entity_id, actor_id, detail)
            }
            Self::Postgres(store) => {
                store
                    .append_audit_log(action, entity_type, entity_id, actor_id, detail)
                    .await
            }
        }
    }

    pub fn backend_name(&self) -> &'static str {
        match self {
            Self::Memory(_) => "memory",
            Self::Postgres(_) => "postgres",
        }
    }

    pub async fn ready(&mut self) -> AppResult<()> {
        match self {
            Self::Memory(_) => Ok(()),
            Self::Postgres(store) => store.ready().await,
        }
    }
}

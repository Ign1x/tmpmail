use std::collections::HashSet;

use chrono::Duration;
use uuid::Uuid;

use crate::{
    config::Config,
    error::{ApiError, AppResult},
    models::{
        Account, Domain, DomainDnsRecord, ImportedMessage, MessageDetail, MessageSeenResponse,
        MessageSummary,
    },
    pg_store::PgStore,
};

#[derive(Clone, Debug, Default)]
pub struct ImportedMessageReceipt {
    pub account_id: Uuid,
    pub message_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct PendingDomainCheck {
    pub id: Uuid,
    pub domain: String,
    pub verification_token: String,
}

#[derive(Clone, Debug, Default)]
pub struct CleanupReport {
    pub deleted_accounts: usize,
    pub deleted_messages: usize,
    pub deleted_domains: usize,
}

#[derive(Clone, Debug, Default)]
pub struct StoreStats {
    pub total_domains: usize,
    pub active_domains: usize,
    pub pending_domains: usize,
    pub total_accounts: usize,
    pub active_accounts: usize,
    pub total_messages: usize,
    pub active_messages: usize,
    pub deleted_messages: usize,
    pub audit_logs_total: usize,
}

#[derive(Debug)]
pub struct AppStore(PgStore);

impl AppStore {
    pub async fn new(config: &Config) -> AppResult<Self> {
        let database_url = config
            .required_database_url()
            .map_err(|error| ApiError::internal(error.to_string()))?;

        Ok(Self(PgStore::new(config, database_url).await?))
    }

    pub async fn list_domains(&self) -> AppResult<Vec<Domain>> {
        self.0.list_domains().await
    }

    pub async fn list_all_domains(&self) -> AppResult<Vec<Domain>> {
        self.0.list_all_domains().await
    }

    pub async fn list_domains_for_owner(&self, owner_user_id: Uuid) -> AppResult<Vec<Domain>> {
        self.0.list_domains_for_owner(owner_user_id).await
    }

    pub async fn count_domains_owned_by(&self, owner_user_id: Uuid) -> AppResult<usize> {
        self.0.count_domains_owned_by(owner_user_id).await
    }

    pub async fn domain_owner_user_id(&self, domain_id: Uuid) -> AppResult<Option<Uuid>> {
        self.0.domain_owner_user_id(domain_id).await
    }

    pub async fn get_domain(&self, domain_id: Uuid) -> AppResult<Domain> {
        self.0.get_domain(domain_id).await
    }

    pub async fn create_domain(
        &self,
        domain: &str,
        owner_user_id: Option<Uuid>,
    ) -> AppResult<Domain> {
        self.0.create_domain(domain, owner_user_id).await
    }

    pub async fn domain_dns_records(
        &self,
        domain_id: Uuid,
        config: &Config,
    ) -> AppResult<Vec<DomainDnsRecord>> {
        self.0.domain_dns_records(domain_id, config).await
    }

    pub async fn domain_verification_context(
        &self,
        domain_id: Uuid,
    ) -> AppResult<(String, String)> {
        self.0.domain_verification_context(domain_id).await
    }

    pub async fn delete_domain(&self, domain_id: Uuid) -> AppResult<()> {
        self.0.delete_domain(domain_id).await
    }

    pub async fn update_domain_verification_status(
        &self,
        domain_id: Uuid,
        is_verified: bool,
        verification_error: Option<String>,
    ) -> AppResult<Domain> {
        self.0
            .update_domain_verification_status(domain_id, is_verified, verification_error)
            .await
    }

    pub async fn pending_domain_checks(&self) -> AppResult<Vec<PendingDomainCheck>> {
        self.0.pending_domain_checks().await
    }

    pub async fn create_account(
        &self,
        address: &str,
        password: &str,
        expires_in: Option<i64>,
    ) -> AppResult<Account> {
        self.0.create_account(address, password, expires_in).await
    }

    pub async fn create_account_for_owner(
        &self,
        address: &str,
        password: &str,
        expires_in: Option<i64>,
        owner_user_id: Option<Uuid>,
    ) -> AppResult<Account> {
        self.0
            .create_account_for_owner(address, password, expires_in, owner_user_id)
            .await
    }

    pub async fn authenticate(&self, address: &str, password: &str) -> AppResult<(Uuid, String)> {
        self.0.authenticate(address, password).await
    }

    pub async fn get_account(&self, account_id: Uuid) -> AppResult<Account> {
        self.0.get_account(account_id).await
    }

    pub async fn list_accounts_for_owner(&self, owner_user_id: Uuid) -> AppResult<Vec<Account>> {
        self.0.list_accounts_for_owner(owner_user_id).await
    }

    pub async fn count_accounts_owned_by(&self, owner_user_id: Uuid) -> AppResult<usize> {
        self.0.count_accounts_owned_by(owner_user_id).await
    }

    pub async fn account_owner_user_id(&self, account_id: Uuid) -> AppResult<Option<Uuid>> {
        self.0.account_owner_user_id(account_id).await
    }

    pub async fn delete_account(&self, account_id: Uuid) -> AppResult<()> {
        self.0.delete_account(account_id).await
    }

    pub async fn active_account_addresses(&self) -> AppResult<Vec<String>> {
        self.0.active_account_addresses().await
    }

    pub async fn has_imported_source(&self, source_key: &str) -> AppResult<bool> {
        self.0.has_imported_source(source_key).await
    }

    pub async fn import_message_for_recipients(
        &self,
        recipients: &[String],
        imported: ImportedMessage,
    ) -> AppResult<Vec<ImportedMessageReceipt>> {
        self.0
            .import_message_for_recipients(recipients, imported)
            .await
    }

    pub async fn list_messages(
        &self,
        account_id: Uuid,
        page: usize,
    ) -> AppResult<(Vec<MessageSummary>, usize)> {
        self.0.list_messages(account_id, page).await
    }

    pub async fn get_message(
        &self,
        account_id: Uuid,
        message_id: Uuid,
    ) -> AppResult<MessageDetail> {
        self.0.get_message(account_id, message_id).await
    }

    pub async fn mark_message_seen(
        &self,
        account_id: Uuid,
        message_id: Uuid,
        seen: bool,
    ) -> AppResult<MessageSeenResponse> {
        self.0.mark_message_seen(account_id, message_id, seen).await
    }

    pub async fn delete_message(&self, account_id: Uuid, message_id: Uuid) -> AppResult<()> {
        self.0.delete_message(account_id, message_id).await
    }

    pub async fn reconcile_mailbox_sources(
        &self,
        mailbox: &str,
        active_source_keys: &HashSet<String>,
    ) -> AppResult<usize> {
        self.0
            .reconcile_mailbox_sources(mailbox, active_source_keys)
            .await
    }

    pub async fn cleanup_expired_accounts(&self) -> AppResult<CleanupReport> {
        self.0.cleanup_expired_accounts().await
    }

    pub async fn cleanup_stale_pending_domains(&self, max_age: Duration) -> AppResult<usize> {
        self.0.cleanup_stale_pending_domains(max_age).await
    }

    pub async fn stats(&self) -> AppResult<StoreStats> {
        self.0.stats().await
    }

    pub async fn audit_logs(&self, limit: usize) -> AppResult<Vec<String>> {
        self.0.audit_logs(limit).await
    }

    pub async fn clear_audit_logs(&self) -> AppResult<()> {
        self.0.clear_audit_logs().await
    }

    pub async fn append_audit_log(
        &self,
        action: &str,
        entity_type: &str,
        entity_id: String,
        actor_id: Option<String>,
        detail: String,
    ) -> AppResult<()> {
        self.0
            .append_audit_log(action, entity_type, entity_id, actor_id, detail)
            .await
    }

    pub fn backend_name(&self) -> &'static str {
        "postgres"
    }

    pub async fn ready(&self) -> AppResult<()> {
        self.0.ready().await
    }
}

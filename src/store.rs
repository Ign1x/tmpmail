use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs,
    path::{Path, PathBuf},
};

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    auth,
    config::Config,
    domain_management::build_dns_records,
    error::{ApiError, AppResult},
    models::{
        Account, Attachment, Domain, DomainDnsRecord, ImportedMessage, MessageAddress,
        MessageDetail, MessageSeenResponse, MessageSummary,
    },
};

const PAGE_SIZE: usize = 30;
const DEFAULT_QUOTA_BYTES: u64 = 50 * 1024 * 1024;
const MAX_AUDIT_LOGS: usize = 500;
const STORE_SNAPSHOT_VERSION: u32 = 1;

#[derive(Clone, Debug, Serialize, Deserialize)]
struct StoredDomain {
    id: Uuid,
    domain: String,
    is_verified: bool,
    status: String,
    verification_token: Option<String>,
    verification_error: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct StoredAccount {
    id: Uuid,
    address: String,
    password_hash: String,
    quota: u64,
    is_disabled: bool,
    is_deleted: bool,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    expires_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct StoredMessage {
    id: Uuid,
    source_key: Option<String>,
    msgid: String,
    from: MessageAddress,
    to: Vec<MessageAddress>,
    subject: String,
    intro: String,
    seen: bool,
    is_deleted: bool,
    has_attachments: bool,
    size: u64,
    download_url: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    text: String,
    html: Vec<String>,
    attachments: Vec<Attachment>,
}

#[derive(Clone, Debug)]
pub struct PendingDomainCheck {
    pub id: Uuid,
    pub domain: String,
    pub verification_token: String,
}

#[derive(Clone, Debug, Default)]
pub struct ImportedMessageReceipt {
    pub account_id: Uuid,
    pub message_id: Uuid,
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

#[derive(Debug, Serialize, Deserialize)]
struct StoreSnapshot {
    version: u32,
    domains: Vec<StoredDomain>,
    audit_logs: VecDeque<String>,
    accounts: HashMap<Uuid, StoredAccount>,
    imported_source_keys: HashSet<String>,
    messages: HashMap<Uuid, Vec<StoredMessage>>,
}

#[derive(Debug)]
pub struct MemoryStore {
    domains: Vec<StoredDomain>,
    audit_logs: VecDeque<String>,
    accounts: HashMap<Uuid, StoredAccount>,
    accounts_by_address: HashMap<String, Uuid>,
    imported_source_keys: HashSet<String>,
    messages: HashMap<Uuid, Vec<StoredMessage>>,
    default_account_ttl_seconds: i64,
    snapshot_path: Option<PathBuf>,
}

impl MemoryStore {
    pub fn new(config: &Config) -> AppResult<Self> {
        let snapshot_path = normalize_snapshot_path(&config.store_state_path);
        let mut store = if let Some(path) = snapshot_path.clone() {
            Self::load_from_snapshot(&path, config.default_account_ttl_seconds)?
        } else {
            Self::bootstrap(config, None)
        };
        let changed = store.ensure_configured_public_domains(config);

        if changed {
            store.persist()?;
        }

        Ok(store)
    }

    fn bootstrap(config: &Config, snapshot_path: Option<PathBuf>) -> Self {
        let now = Utc::now();
        let domains = config
            .public_domains
            .iter()
            .map(|domain| StoredDomain {
                id: Uuid::new_v4(),
                domain: domain.clone(),
                is_verified: true,
                status: "active".to_owned(),
                verification_token: None,
                verification_error: None,
                created_at: now,
                updated_at: now,
            })
            .collect();
        Self {
            domains,
            audit_logs: VecDeque::new(),
            accounts: HashMap::new(),
            accounts_by_address: HashMap::new(),
            imported_source_keys: HashSet::new(),
            messages: HashMap::new(),
            default_account_ttl_seconds: config.default_account_ttl_seconds,
            snapshot_path,
        }
    }

    fn load_from_snapshot(path: &Path, default_account_ttl_seconds: i64) -> AppResult<Self> {
        if !path.exists() {
            return Ok(Self {
                domains: Vec::new(),
                audit_logs: VecDeque::new(),
                accounts: HashMap::new(),
                accounts_by_address: HashMap::new(),
                imported_source_keys: HashSet::new(),
                messages: HashMap::new(),
                default_account_ttl_seconds,
                snapshot_path: Some(path.to_path_buf()),
            });
        }

        let raw = fs::read_to_string(path).map_err(|error| {
            ApiError::internal(format!(
                "failed to read store snapshot {}: {error}",
                path.display()
            ))
        })?;
        let snapshot: StoreSnapshot = serde_json::from_str(&raw).map_err(|error| {
            ApiError::internal(format!(
                "failed to parse store snapshot {}: {error}",
                path.display()
            ))
        })?;

        if snapshot.version != STORE_SNAPSHOT_VERSION {
            return Err(ApiError::internal(format!(
                "unsupported store snapshot version {} in {}",
                snapshot.version,
                path.display()
            )));
        }

        let mut store = Self {
            domains: snapshot.domains,
            audit_logs: snapshot.audit_logs,
            accounts: snapshot.accounts,
            accounts_by_address: HashMap::new(),
            imported_source_keys: snapshot.imported_source_keys,
            messages: snapshot.messages,
            default_account_ttl_seconds,
            snapshot_path: Some(path.to_path_buf()),
        };
        store.rebuild_indexes();

        Ok(store)
    }

    fn ensure_configured_public_domains(&mut self, config: &Config) -> bool {
        let now = Utc::now();
        let mut changed = false;

        for public_domain in &config.public_domains {
            if let Some(existing) = self
                .domains
                .iter_mut()
                .find(|domain| domain.domain == *public_domain)
            {
                let needs_update = !existing.is_verified
                    || existing.status != "active"
                    || existing.verification_token.is_some()
                    || existing.verification_error.is_some();
                if needs_update {
                    existing.is_verified = true;
                    existing.status = "active".to_owned();
                    existing.verification_token = None;
                    existing.verification_error = None;
                    existing.updated_at = now;
                    changed = true;
                }
                continue;
            }

            self.domains.push(StoredDomain {
                id: Uuid::new_v4(),
                domain: public_domain.clone(),
                is_verified: true,
                status: "active".to_owned(),
                verification_token: None,
                verification_error: None,
                created_at: now,
                updated_at: now,
            });
            changed = true;
        }

        changed
    }

    fn rebuild_indexes(&mut self) {
        self.accounts_by_address.clear();
        for account in self.accounts.values() {
            if !account.is_deleted {
                self.accounts_by_address
                    .insert(account.address.clone(), account.id);
            }
        }
    }

    fn persist(&self) -> AppResult<()> {
        let Some(path) = self.snapshot_path.as_deref() else {
            return Ok(());
        };

        if let Some(parent) = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            fs::create_dir_all(parent).map_err(|error| {
                ApiError::internal(format!(
                    "failed to prepare store snapshot directory {}: {error}",
                    parent.display()
                ))
            })?;
        }

        let snapshot = StoreSnapshot {
            version: STORE_SNAPSHOT_VERSION,
            domains: self.domains.clone(),
            audit_logs: self.audit_logs.clone(),
            accounts: self.accounts.clone(),
            imported_source_keys: self.imported_source_keys.clone(),
            messages: self.messages.clone(),
        };
        let serialized = serde_json::to_string_pretty(&snapshot).map_err(|error| {
            ApiError::internal(format!(
                "failed to serialize store snapshot {}: {error}",
                path.display()
            ))
        })?;
        let temp_path = path.with_extension("tmp");
        fs::write(&temp_path, serialized).map_err(|error| {
            ApiError::internal(format!(
                "failed to write store snapshot {}: {error}",
                temp_path.display()
            ))
        })?;
        fs::rename(&temp_path, path).map_err(|error| {
            ApiError::internal(format!(
                "failed to finalize store snapshot {}: {error}",
                path.display()
            ))
        })?;

        Ok(())
    }

    pub fn list_domains(&self) -> Vec<Domain> {
        let mut domains = self
            .domains
            .iter()
            .filter(|domain| domain.is_verified && domain.status == "active")
            .map(StoredDomain::to_public)
            .collect::<Vec<_>>();

        domains.sort_by(|left, right| left.domain.cmp(&right.domain));
        domains
    }

    pub fn list_all_domains(&self) -> Vec<Domain> {
        let mut domains = self
            .domains
            .iter()
            .map(StoredDomain::to_public)
            .collect::<Vec<_>>();

        domains.sort_by(|left, right| left.domain.cmp(&right.domain));
        domains
    }

    pub fn create_domain(&mut self, domain: &str) -> AppResult<Domain> {
        let normalized_domain = normalize_domain(domain)?;

        if self
            .domains
            .iter()
            .any(|stored| stored.domain == normalized_domain)
        {
            return Err(ApiError::validation("domain already exists"));
        }

        let now = Utc::now();
        let stored = StoredDomain {
            id: Uuid::new_v4(),
            domain: normalized_domain,
            is_verified: false,
            status: "pending_verification".to_owned(),
            verification_token: Some(format!("tmpmail-verify-{}", Uuid::new_v4().simple())),
            verification_error: None,
            created_at: now,
            updated_at: now,
        };
        let public = stored.to_public();
        self.domains.push(stored.clone());
        self.record_audit(
            "domain.create",
            "domain",
            public.id.clone(),
            None,
            format!("domain={} status={}", public.domain, public.status),
        );
        self.persist()?;

        Ok(public)
    }

    pub fn domain_dns_records(
        &self,
        domain_id: Uuid,
        config: &Config,
    ) -> AppResult<Vec<DomainDnsRecord>> {
        let domain = self.domain_by_id(domain_id)?;
        let verification_token = domain.verification_token.as_deref().ok_or_else(|| {
            ApiError::validation("system domains do not expose verification records")
        })?;

        Ok(build_dns_records(
            &domain.domain,
            verification_token,
            config,
        ))
    }

    pub fn domain_verification_context(&self, domain_id: Uuid) -> AppResult<(String, String)> {
        let domain = self.domain_by_id(domain_id)?;
        let token = domain
            .verification_token
            .clone()
            .ok_or_else(|| ApiError::validation("system domains do not require verification"))?;

        Ok((domain.domain.clone(), token))
    }

    pub fn update_domain_verification_status(
        &mut self,
        domain_id: Uuid,
        is_verified: bool,
        verification_error: Option<String>,
    ) -> AppResult<Domain> {
        let (public_domain, detail) = {
            let domain = self
                .domains
                .iter_mut()
                .find(|domain| domain.id == domain_id)
                .ok_or_else(|| ApiError::not_found("domain not found"))?;

            domain.is_verified = is_verified;
            domain.status = if is_verified {
                "active".to_owned()
            } else {
                "pending_verification".to_owned()
            };
            domain.verification_error = verification_error.clone();
            domain.updated_at = Utc::now();

            (
                domain.to_public(),
                verification_error.unwrap_or_else(|| "domain is active".to_owned()),
            )
        };

        self.record_audit(
            if is_verified {
                "domain.verify.success"
            } else {
                "domain.verify.failed"
            },
            "domain",
            public_domain.id.clone(),
            None,
            detail,
        );
        self.persist()?;

        Ok(public_domain)
    }

    pub fn pending_domain_checks(&self) -> Vec<PendingDomainCheck> {
        self.domains
            .iter()
            .filter_map(|domain| {
                if domain.is_verified || domain.status != "pending_verification" {
                    return None;
                }

                Some(PendingDomainCheck {
                    id: domain.id,
                    domain: domain.domain.clone(),
                    verification_token: domain.verification_token.clone().unwrap_or_default(),
                })
            })
            .collect()
    }

    pub fn create_account(
        &mut self,
        address: &str,
        password: &str,
        expires_in: Option<i64>,
    ) -> AppResult<Account> {
        let normalized_address = normalize_address(address)?;
        if password.trim().is_empty() {
            return Err(ApiError::validation("password must not be empty"));
        }

        if password.chars().count() < 6 {
            return Err(ApiError::validation(
                "password must be at least 6 characters",
            ));
        }

        let (_, domain) = split_address(&normalized_address)?;
        let domain = self
            .domains
            .iter()
            .find(|item| item.domain == domain)
            .ok_or_else(|| ApiError::validation("selected domain is not available"))?;

        if !domain.is_verified || domain.status != "active" {
            return Err(ApiError::validation("selected domain is not available"));
        }

        if self
            .accounts_by_address
            .get(&normalized_address)
            .and_then(|account_id| self.accounts.get(account_id))
            .is_some_and(|account| !account.is_deleted)
        {
            return Err(ApiError::validation("Email address already exists"));
        }

        let now = Utc::now();
        let expires_at = resolve_expires_at(now, expires_in, self.default_account_ttl_seconds)?;
        let account = StoredAccount {
            id: Uuid::new_v4(),
            address: normalized_address.clone(),
            password_hash: auth::hash_password(password)?,
            quota: DEFAULT_QUOTA_BYTES,
            is_disabled: false,
            is_deleted: false,
            created_at: now,
            updated_at: now,
            expires_at,
        };

        self.accounts_by_address
            .insert(normalized_address, account.id);
        self.messages
            .entry(account.id)
            .or_default()
            .push(build_welcome_message(&account));
        self.accounts.insert(account.id, account.clone());
        self.record_audit(
            "account.create",
            "account",
            account.id.to_string(),
            None,
            format!("address={}", account.address),
        );
        self.persist()?;

        Ok(self.to_account(&account))
    }

    pub fn authenticate(&self, address: &str, password: &str) -> AppResult<(Uuid, String)> {
        let normalized_address = normalize_address(address)?;
        let account_id = self
            .accounts_by_address
            .get(&normalized_address)
            .ok_or_else(|| ApiError::unauthorized("invalid email or password"))?;

        let account = self
            .accounts
            .get(account_id)
            .ok_or_else(|| ApiError::unauthorized("invalid email or password"))?;

        ensure_account_active(account)?;

        let is_valid = auth::verify_password(password, &account.password_hash)?;
        if !is_valid {
            return Err(ApiError::unauthorized("invalid email or password"));
        }

        Ok((account.id, account.address.clone()))
    }

    pub fn get_account(&self, account_id: Uuid) -> AppResult<Account> {
        let account = self
            .accounts
            .get(&account_id)
            .ok_or_else(|| ApiError::not_found("account not found"))?;

        ensure_account_active(account)?;

        Ok(self.to_account(account))
    }

    pub fn delete_account(&mut self, account_id: Uuid) -> AppResult<()> {
        let (account_id, address) = {
            let account = self
                .accounts
                .get_mut(&account_id)
                .ok_or_else(|| ApiError::not_found("account not found"))?;

            ensure_account_active(account)?;
            account.is_deleted = true;
            account.updated_at = Utc::now();

            (account.id, account.address.clone())
        };
        self.accounts_by_address.remove(&address);

        if let Some(messages) = self.messages.get_mut(&account_id) {
            for message in messages {
                message.is_deleted = true;
                message.updated_at = Utc::now();
            }
        }

        self.record_audit(
            "account.delete",
            "account",
            account_id.to_string(),
            None,
            format!("address={address}"),
        );
        self.persist()?;

        Ok(())
    }

    pub fn active_account_addresses(&self) -> Vec<String> {
        self.accounts
            .values()
            .filter(|account| ensure_account_active(account).is_ok())
            .map(|account| account.address.clone())
            .collect()
    }

    pub fn has_imported_source(&self, source_key: &str) -> bool {
        self.imported_source_keys.contains(source_key)
    }

    pub fn import_message_for_recipients(
        &mut self,
        recipients: &[String],
        imported: ImportedMessage,
    ) -> AppResult<Vec<ImportedMessageReceipt>> {
        if self.imported_source_keys.contains(&imported.source_key) {
            return Ok(Vec::new());
        }

        let mut receipts = Vec::new();

        for recipient in recipients {
            let Some(account_id) = self.accounts_by_address.get(recipient).copied() else {
                continue;
            };
            let Some(account) = self.accounts.get(&account_id) else {
                continue;
            };

            if ensure_account_active(account).is_err() {
                continue;
            }

            let message = build_imported_message(&imported);
            let message_id = message.id;
            self.messages.entry(account_id).or_default().push(message);
            self.record_audit(
                "message.import",
                "message",
                message_id.to_string(),
                Some(account_id.to_string()),
                format!(
                    "source_key={} subject={}",
                    imported.source_key, imported.subject
                ),
            );
            receipts.push(ImportedMessageReceipt {
                account_id,
                message_id,
            });
        }

        if !receipts.is_empty() {
            self.imported_source_keys.insert(imported.source_key);
            self.persist()?;
        }

        Ok(receipts)
    }

    pub fn list_messages(
        &self,
        account_id: Uuid,
        page: usize,
    ) -> AppResult<(Vec<MessageSummary>, usize)> {
        let account = self
            .accounts
            .get(&account_id)
            .ok_or_else(|| ApiError::not_found("account not found"))?;
        ensure_account_active(account)?;

        let mut messages = self.messages.get(&account_id).cloned().unwrap_or_default();
        messages.retain(|message| !message.is_deleted);
        messages.sort_by(|left, right| right.created_at.cmp(&left.created_at));

        let total = messages.len();
        let page = page.max(1);
        let start = (page - 1) * PAGE_SIZE;
        let items = messages
            .into_iter()
            .skip(start)
            .take(PAGE_SIZE)
            .map(|message| message.to_summary(account_id))
            .collect();

        Ok((items, total))
    }

    pub fn get_message(&self, account_id: Uuid, message_id: Uuid) -> AppResult<MessageDetail> {
        let account = self
            .accounts
            .get(&account_id)
            .ok_or_else(|| ApiError::not_found("account not found"))?;
        ensure_account_active(account)?;

        let message = self
            .messages
            .get(&account_id)
            .and_then(|messages| {
                messages
                    .iter()
                    .find(|message| message.id == message_id && !message.is_deleted)
            })
            .ok_or_else(|| ApiError::not_found("message not found"))?;

        Ok(message.to_detail(account_id))
    }

    pub fn mark_message_seen(
        &mut self,
        account_id: Uuid,
        message_id: Uuid,
        seen: bool,
    ) -> AppResult<MessageSeenResponse> {
        let account = self
            .accounts
            .get(&account_id)
            .ok_or_else(|| ApiError::not_found("account not found"))?;
        ensure_account_active(account)?;

        let response = {
            let message = self
                .messages
                .get_mut(&account_id)
                .and_then(|messages| {
                    messages
                        .iter_mut()
                        .find(|message| message.id == message_id && !message.is_deleted)
                })
                .ok_or_else(|| ApiError::not_found("message not found"))?;

            message.seen = seen;
            message.updated_at = Utc::now();
            MessageSeenResponse { seen: message.seen }
        };
        self.record_audit(
            "message.seen",
            "message",
            message_id.to_string(),
            Some(account_id.to_string()),
            format!("seen={seen}"),
        );
        self.persist()?;

        Ok(response)
    }

    pub fn delete_message(&mut self, account_id: Uuid, message_id: Uuid) -> AppResult<()> {
        let account = self
            .accounts
            .get(&account_id)
            .ok_or_else(|| ApiError::not_found("account not found"))?;
        ensure_account_active(account)?;

        {
            let message = self
                .messages
                .get_mut(&account_id)
                .and_then(|messages| {
                    messages
                        .iter_mut()
                        .find(|message| message.id == message_id && !message.is_deleted)
                })
                .ok_or_else(|| ApiError::not_found("message not found"))?;

            message.is_deleted = true;
            message.updated_at = Utc::now();
        }
        self.record_audit(
            "message.delete",
            "message",
            message_id.to_string(),
            Some(account_id.to_string()),
            "soft deleted from mailbox".to_owned(),
        );
        self.persist()?;

        Ok(())
    }

    pub fn reconcile_mailbox_sources(
        &mut self,
        mailbox: &str,
        active_source_keys: &HashSet<String>,
    ) -> AppResult<usize> {
        let mut deleted_count = 0_usize;
        let mailbox_prefix = format!("{mailbox}:");

        let account_ids = self.accounts.keys().copied().collect::<Vec<_>>();
        for account_id in account_ids {
            let mut deleted_message_ids = Vec::new();
            if let Some(messages) = self.messages.get_mut(&account_id) {
                for message in messages.iter_mut() {
                    let Some(source_key) = message.source_key.as_deref() else {
                        continue;
                    };

                    if !source_key.starts_with(&mailbox_prefix)
                        || active_source_keys.contains(source_key)
                        || message.is_deleted
                    {
                        continue;
                    }

                    message.is_deleted = true;
                    message.updated_at = Utc::now();
                    deleted_message_ids.push(message.id);
                    deleted_count += 1;
                }
            }

            for message_id in deleted_message_ids {
                self.record_audit(
                    "message.delete.sync",
                    "message",
                    message_id.to_string(),
                    Some(account_id.to_string()),
                    format!("mailbox={mailbox} upstream message missing"),
                );
            }
        }

        if deleted_count > 0 {
            self.persist()?;
        }

        Ok(deleted_count)
    }

    pub fn cleanup_expired_accounts(&mut self) -> AppResult<CleanupReport> {
        let now = Utc::now();
        let mut report = CleanupReport::default();
        let mut expired_accounts = Vec::new();

        for (account_id, account) in &self.accounts {
            if account.is_deleted || account.is_disabled {
                continue;
            }

            if account
                .expires_at
                .map(|expires_at| expires_at <= now)
                .unwrap_or(false)
            {
                expired_accounts.push((*account_id, account.address.clone()));
            }
        }

        for (account_id, address) in expired_accounts {
            if let Some(account) = self.accounts.get_mut(&account_id) {
                account.is_deleted = true;
                account.updated_at = now;
            }
            self.accounts_by_address.remove(&address);

            if let Some(messages) = self.messages.get_mut(&account_id) {
                for message in messages.iter_mut().filter(|message| !message.is_deleted) {
                    message.is_deleted = true;
                    message.updated_at = now;
                    report.deleted_messages += 1;
                }
            }

            report.deleted_accounts += 1;
            self.record_audit(
                "account.expire",
                "account",
                account_id.to_string(),
                None,
                format!("address={address}"),
            );
        }

        if report.deleted_accounts > 0 || report.deleted_messages > 0 {
            self.persist()?;
        }

        Ok(report)
    }

    pub fn cleanup_stale_pending_domains(&mut self, max_age: Duration) -> AppResult<usize> {
        let now = Utc::now();
        let mut removed = 0_usize;
        let mut removed_domains = Vec::new();

        self.domains.retain(|domain| {
            let should_remove = !domain.is_verified
                && domain.status == "pending_verification"
                && now.signed_duration_since(domain.created_at) >= max_age;

            if should_remove {
                removed_domains.push((domain.id, domain.domain.clone()));
                removed += 1;
                false
            } else {
                true
            }
        });

        for (domain_id, domain_name) in removed_domains {
            self.record_audit(
                "domain.cleanup",
                "domain",
                domain_id.to_string(),
                None,
                format!("removed stale pending domain {domain_name}"),
            );
        }

        if removed > 0 {
            self.persist()?;
        }

        Ok(removed)
    }

    pub fn stats(&self) -> StoreStats {
        let total_domains = self.domains.len();
        let active_domains = self
            .domains
            .iter()
            .filter(|domain| domain.is_verified && domain.status == "active")
            .count();
        let pending_domains = self
            .domains
            .iter()
            .filter(|domain| domain.status == "pending_verification")
            .count();
        let total_accounts = self.accounts.len();
        let active_accounts = self
            .accounts
            .values()
            .filter(|account| ensure_account_active(account).is_ok())
            .count();
        let total_messages = self.messages.values().map(Vec::len).sum::<usize>();
        let deleted_messages = self
            .messages
            .values()
            .flatten()
            .filter(|message| message.is_deleted)
            .count();

        StoreStats {
            total_domains,
            active_domains,
            pending_domains,
            total_accounts,
            active_accounts,
            total_messages,
            active_messages: total_messages.saturating_sub(deleted_messages),
            deleted_messages,
            audit_logs_total: self.audit_logs.len(),
        }
    }

    pub fn audit_logs(&self, limit: usize) -> Vec<String> {
        self.audit_logs.iter().rev().take(limit).cloned().collect()
    }

    pub fn append_audit_log(
        &mut self,
        action: &str,
        entity_type: &str,
        entity_id: String,
        actor_id: Option<String>,
        detail: String,
    ) -> AppResult<()> {
        self.record_audit(action, entity_type, entity_id, actor_id, detail);
        self.persist()
    }

    fn to_account(&self, account: &StoredAccount) -> Account {
        Account {
            id: account.id.to_string(),
            address: account.address.clone(),
            quota: account.quota,
            used: self
                .messages
                .get(&account.id)
                .map(|messages| {
                    messages
                        .iter()
                        .filter(|message| !message.is_deleted)
                        .map(|message| message.size)
                        .sum()
                })
                .unwrap_or(0),
            is_disabled: account.is_disabled,
            is_deleted: account.is_deleted,
            created_at: account.created_at,
            updated_at: account.updated_at,
        }
    }

    fn domain_by_id(&self, domain_id: Uuid) -> AppResult<&StoredDomain> {
        self.domains
            .iter()
            .find(|domain| domain.id == domain_id)
            .ok_or_else(|| ApiError::not_found("domain not found"))
    }

    fn record_audit(
        &mut self,
        action: &str,
        entity_type: &str,
        entity_id: String,
        actor_id: Option<String>,
        detail: String,
    ) {
        let actor = actor_id.as_deref().unwrap_or("system");
        let entry = format!(
            "{} action={action} entity={entity_type}:{entity_id} actor={actor} detail={detail}",
            Utc::now().to_rfc3339(),
        );

        self.audit_logs.push_back(entry);
        if self.audit_logs.len() > MAX_AUDIT_LOGS {
            let _ = self.audit_logs.pop_front();
        }
    }
}

impl StoredDomain {
    fn to_public(&self) -> Domain {
        Domain {
            id: self.id.to_string(),
            domain: self.domain.clone(),
            is_verified: self.is_verified,
            status: self.status.clone(),
            verification_token: self.verification_token.clone(),
            verification_error: self.verification_error.clone(),
            created_at: self.created_at,
            updated_at: self.updated_at,
        }
    }
}

impl StoredMessage {
    fn to_summary(&self, account_id: Uuid) -> MessageSummary {
        MessageSummary {
            id: self.id.to_string(),
            account_id: account_id.to_string(),
            msgid: self.msgid.clone(),
            from: self.from.clone(),
            to: self.to.clone(),
            subject: self.subject.clone(),
            intro: self.intro.clone(),
            seen: self.seen,
            is_deleted: self.is_deleted,
            has_attachments: self.has_attachments,
            size: self.size,
            download_url: self.download_url.clone(),
            created_at: self.created_at,
            updated_at: self.updated_at,
        }
    }

    fn to_detail(&self, account_id: Uuid) -> MessageDetail {
        MessageDetail {
            summary: self.to_summary(account_id),
            cc: Vec::new(),
            bcc: Vec::new(),
            text: self.text.clone(),
            html: self.html.clone(),
            attachments: self.attachments.clone(),
        }
    }
}

fn normalize_address(address: &str) -> AppResult<String> {
    let normalized = address.trim().to_lowercase();
    if normalized.len() > 320 {
        return Err(ApiError::validation("address must be a valid email"));
    }
    split_address(&normalized)?;
    Ok(normalized)
}

fn split_address(address: &str) -> AppResult<(&str, &str)> {
    if address.chars().any(char::is_whitespace) {
        return Err(ApiError::validation("address must be a valid email"));
    }

    let mut parts = address.split('@');
    let local_part = parts
        .next()
        .ok_or_else(|| ApiError::validation("address must be a valid email"))?;
    let domain = parts
        .next()
        .ok_or_else(|| ApiError::validation("address must be a valid email"))?;

    if parts.next().is_some() {
        return Err(ApiError::validation("address must be a valid email"));
    }

    if local_part.trim().is_empty() || domain.trim().is_empty() {
        return Err(ApiError::validation("address must be a valid email"));
    }

    if local_part.trim().chars().count() < 3 {
        return Err(ApiError::validation(
            "address username must be at least 3 characters",
        ));
    }

    if local_part.chars().count() > 64
        || local_part.starts_with('.')
        || local_part.ends_with('.')
        || local_part.contains("..")
    {
        return Err(ApiError::validation("address must be a valid email"));
    }

    if local_part
        .chars()
        .any(|ch| !(ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-' | '+')))
    {
        return Err(ApiError::validation("address must be a valid email"));
    }

    validate_domain_name(domain)?;

    Ok((local_part, domain))
}

fn normalize_domain(domain: &str) -> AppResult<String> {
    let normalized = domain.trim().trim_matches('.').to_lowercase();
    validate_domain_name(&normalized)?;
    Ok(normalized)
}

fn validate_domain_name(domain: &str) -> AppResult<()> {
    if domain.is_empty() || !domain.contains('.') || domain.len() > 253 {
        return Err(ApiError::validation("domain must be a valid hostname"));
    }

    for label in domain.split('.') {
        if label.is_empty() || label.len() > 63 || label.starts_with('-') || label.ends_with('-') {
            return Err(ApiError::validation("domain must be a valid hostname"));
        }

        if label
            .chars()
            .any(|ch| !(ch.is_ascii_alphanumeric() || ch == '-'))
        {
            return Err(ApiError::validation("domain must be a valid hostname"));
        }
    }

    Ok(())
}

fn normalize_snapshot_path(path: &str) -> Option<PathBuf> {
    let normalized = path.trim();
    if normalized.is_empty() {
        return None;
    }

    Some(PathBuf::from(normalized))
}

fn resolve_expires_at(
    now: DateTime<Utc>,
    expires_in: Option<i64>,
    default_ttl_seconds: i64,
) -> AppResult<Option<DateTime<Utc>>> {
    match expires_in {
        Some(-1) | Some(0) => Ok(None),
        Some(seconds) if seconds > 0 => Ok(Some(now + Duration::seconds(seconds))),
        Some(_) => Err(ApiError::validation("expiresIn must be positive, 0, or -1")),
        None => Ok(Some(now + Duration::seconds(default_ttl_seconds))),
    }
}

fn ensure_account_active(account: &StoredAccount) -> AppResult<()> {
    if account.is_deleted {
        return Err(ApiError::not_found("account not found"));
    }

    if account.is_disabled {
        return Err(ApiError::forbidden("account is disabled"));
    }

    if account
        .expires_at
        .map(|expires_at| expires_at <= Utc::now())
        .unwrap_or(false)
    {
        return Err(ApiError::unauthorized("account has expired"));
    }

    Ok(())
}

fn build_welcome_message(account: &StoredAccount) -> StoredMessage {
    let now = Utc::now();
    let message_id = Uuid::new_v4();
    let text = format!(
        "Welcome to TmpMail.\n\nMailbox {} is ready. This is a seed message for the P0 flow.\n",
        account.address
    );
    let html = vec![format!(
        "<p><strong>Welcome to TmpMail.</strong></p><p>Mailbox <code>{}</code> is ready. This is a seed message for the P0 flow.</p>",
        account.address
    )];
    let size = text.len() as u64 + html.iter().map(|part| part.len() as u64).sum::<u64>();

    StoredMessage {
        id: message_id,
        source_key: None,
        msgid: format!("<{}@tmpmail.local>", message_id),
        from: MessageAddress {
            name: "TmpMail".to_owned(),
            address: "noreply@tmpmail.local".to_owned(),
        },
        to: vec![MessageAddress {
            name: account.address.clone(),
            address: account.address.clone(),
        }],
        subject: "Welcome to TmpMail".to_owned(),
        intro: "Your mailbox is ready.".to_owned(),
        seen: false,
        is_deleted: false,
        has_attachments: false,
        size,
        download_url: format!("/messages/{message_id}/raw"),
        created_at: now,
        updated_at: now,
        text,
        html,
        attachments: Vec::new(),
    }
}

fn build_imported_message(imported: &ImportedMessage) -> StoredMessage {
    StoredMessage {
        id: Uuid::new_v4(),
        source_key: Some(imported.source_key.clone()),
        msgid: imported.msgid.clone(),
        from: imported.from.clone(),
        to: imported.to.clone(),
        subject: imported.subject.clone(),
        intro: imported.intro.clone(),
        seen: false,
        is_deleted: false,
        has_attachments: !imported.attachments.is_empty(),
        size: imported.size,
        download_url: imported.download_url.clone(),
        created_at: imported.created_at,
        updated_at: imported.created_at,
        text: imported.text.clone(),
        html: imported.html.clone(),
        attachments: imported.attachments.clone(),
    }
}

#[cfg(test)]
mod tests {
    use std::{env, fs};

    use chrono::Utc;
    use uuid::Uuid;

    use super::{MemoryStore, normalize_domain, split_address};
    use crate::{
        config::Config,
        models::{ImportedMessage, MessageAddress},
    };

    fn test_config() -> Config {
        Config {
            store_state_path: String::new(),
            ..Config::default()
        }
    }

    fn temp_snapshot_path(name: &str) -> String {
        env::temp_dir()
            .join(format!("tmpmail-store-{name}-{}.json", Uuid::new_v4()))
            .to_string_lossy()
            .into_owned()
    }

    #[test]
    fn account_flow_bootstraps_with_seed_message() {
        let config = test_config();
        let mut store = MemoryStore::new(&config).expect("load store");
        let account = store
            .create_account("demo@tmpmail.local", "secret", None)
            .expect("create account");

        let (messages, total) = store
            .list_messages(uuid::Uuid::parse_str(&account.id).expect("uuid"), 1)
            .expect("list messages");

        assert_eq!(total, 1);
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].subject, "Welcome to TmpMail");
    }

    #[test]
    fn admin_managed_domain_becomes_available_to_all_accounts_after_activation() {
        let config = test_config();
        let mut store = MemoryStore::new(&config).expect("load store");
        let domain = store
            .create_domain("public.example.com")
            .expect("create domain");
        let domain_id = uuid::Uuid::parse_str(&domain.id).expect("uuid");
        let _ = store
            .update_domain_verification_status(domain_id, true, None)
            .expect("verify domain");
        let account = store
            .create_account("alice@public.example.com", "secret123", None)
            .expect("create account on verified admin-managed domain");

        assert_eq!(account.address, "alice@public.example.com");
    }

    #[test]
    fn admin_list_includes_pending_domains_while_public_list_only_shows_active_domains() {
        let config = test_config();
        let mut store = MemoryStore::new(&config).expect("load store");
        store
            .create_domain("team.example.com")
            .expect("create domain");

        let public_domains = store.list_domains();
        let all_domains = store.list_all_domains();

        assert!(
            public_domains
                .iter()
                .all(|domain| domain.status == "active")
        );
        assert!(
            all_domains
                .iter()
                .any(|domain| domain.domain == "team.example.com"
                    && domain.status == "pending_verification")
        );
        assert!(
            all_domains
                .iter()
                .any(|domain| domain.domain == "tmpmail.local" && domain.status == "active")
        );
        assert!(
            public_domains
                .iter()
                .all(|domain| domain.domain != "team.example.com")
        );
    }

    #[test]
    fn create_account_rejects_short_password() {
        let config = test_config();
        let mut store = MemoryStore::new(&config).expect("load store");

        let error = store
            .create_account("demo@tmpmail.local", "short", None)
            .expect_err("short password should be rejected");

        assert_eq!(error.to_string(), "password must be at least 6 characters");
    }

    #[test]
    fn create_account_rejects_short_username() {
        let config = test_config();
        let mut store = MemoryStore::new(&config).expect("load store");

        let error = store
            .create_account("ab@tmpmail.local", "secret123", None)
            .expect_err("short username should be rejected");

        assert_eq!(
            error.to_string(),
            "address username must be at least 3 characters"
        );
    }

    #[test]
    fn public_domains_are_available_without_extra_credentials() {
        let config = test_config();
        let store = MemoryStore::new(&config).expect("load store");

        let public_domains = store.list_domains();

        assert!(!public_domains.is_empty());
        assert!(
            public_domains
                .iter()
                .all(|domain| domain.status == "active")
        );
    }

    #[test]
    fn split_address_rejects_multiple_at_signs() {
        let error = split_address("demo@@tmpmail.local").expect_err("multiple @ should fail");

        assert_eq!(error.to_string(), "address must be a valid email");
    }

    #[test]
    fn split_address_rejects_invalid_local_part() {
        let error =
            split_address(".bad@tmpmail.local").expect_err("invalid local part should fail");

        assert_eq!(error.to_string(), "address must be a valid email");
    }

    #[test]
    fn normalize_domain_rejects_invalid_labels() {
        let error = normalize_domain("bad..example.com").expect_err("empty label should fail");

        assert_eq!(error.to_string(), "domain must be a valid hostname");
    }

    #[test]
    fn normalize_domain_rejects_leading_hyphen_labels() {
        let error = normalize_domain("-bad.example.com").expect_err("leading hyphen should fail");

        assert_eq!(error.to_string(), "domain must be a valid hostname");
    }

    #[test]
    fn create_account_preserves_password_whitespace() {
        let config = test_config();
        let mut store = MemoryStore::new(&config).expect("load store");

        store
            .create_account("demo@tmpmail.local", "  secret123  ", None)
            .expect("create account");

        assert!(
            store
                .authenticate("demo@tmpmail.local", "  secret123  ")
                .is_ok()
        );
        assert!(
            store
                .authenticate("demo@tmpmail.local", "secret123")
                .is_err()
        );
    }

    #[test]
    fn store_restores_snapshot_after_restart() {
        let snapshot_path = temp_snapshot_path("restart");
        let config = Config {
            store_state_path: snapshot_path.clone(),
            ..Config::default()
        };
        let mut store = MemoryStore::new(&config).expect("load store");
        let domain = store
            .create_domain("persisted.example.com")
            .expect("create domain");
        let domain_id = Uuid::parse_str(&domain.id).expect("uuid");
        store
            .update_domain_verification_status(domain_id, true, None)
            .expect("verify domain");
        let account = store
            .create_account("demo@persisted.example.com", "secret123", None)
            .expect("create account");
        let account_id = Uuid::parse_str(&account.id).expect("uuid");
        store
            .import_message_for_recipients(
                std::slice::from_ref(&account.address),
                ImportedMessage {
                    source_key: "persisted.example.com:msg-1".to_owned(),
                    msgid: "<msg-1@example.com>".to_owned(),
                    from: MessageAddress {
                        name: "Sender".to_owned(),
                        address: "sender@example.com".to_owned(),
                    },
                    to: vec![MessageAddress {
                        name: account.address.clone(),
                        address: account.address.clone(),
                    }],
                    subject: "Persisted message".to_owned(),
                    intro: "snapshot check".to_owned(),
                    size: 42,
                    download_url: "/messages/raw".to_owned(),
                    created_at: Utc::now(),
                    text: "snapshot check".to_owned(),
                    html: vec!["<p>snapshot check</p>".to_owned()],
                    attachments: Vec::new(),
                },
            )
            .expect("import message");
        drop(store);

        let restored = MemoryStore::new(&config).expect("reload store");
        let (messages, total) = restored
            .list_messages(account_id, 1)
            .expect("list restored messages");

        assert_eq!(total, 2);
        assert_eq!(messages[0].subject, "Persisted message");
        assert!(restored.has_imported_source("persisted.example.com:msg-1"));
        assert!(
            restored
                .list_domains()
                .iter()
                .any(|item| item.domain == "persisted.example.com" && item.status == "active")
        );
        assert!(
            restored
                .authenticate("demo@persisted.example.com", "secret123")
                .is_ok()
        );

        let _ = fs::remove_file(snapshot_path);
    }

    #[test]
    fn store_rehydrates_missing_public_domains_from_config() {
        let snapshot_path = temp_snapshot_path("public-domains");
        let initial_config = Config {
            store_state_path: snapshot_path.clone(),
            public_domains: vec!["tmpmail.local".to_owned()],
            ..Config::default()
        };
        let _ = MemoryStore::new(&initial_config).expect("create initial snapshot");

        let updated_config = Config {
            store_state_path: snapshot_path.clone(),
            public_domains: vec![
                "tmpmail.local".to_owned(),
                "new-public.example.com".to_owned(),
            ],
            ..Config::default()
        };
        let restored = MemoryStore::new(&updated_config).expect("reload store");

        assert!(
            restored
                .list_domains()
                .iter()
                .any(|item| item.domain == "new-public.example.com" && item.status == "active")
        );

        let _ = fs::remove_file(snapshot_path);
    }
}

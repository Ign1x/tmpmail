use std::collections::{HashMap, HashSet, VecDeque};

use chrono::{DateTime, Duration, Utc};
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

#[derive(Clone, Debug)]
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

#[derive(Clone, Debug)]
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

#[derive(Clone, Debug)]
struct StoredMessage {
    id: Uuid,
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

#[derive(Debug)]
pub struct MemoryStore {
    domains: Vec<StoredDomain>,
    audit_logs: VecDeque<String>,
    accounts: HashMap<Uuid, StoredAccount>,
    accounts_by_address: HashMap<String, Uuid>,
    imported_source_keys: HashSet<String>,
    messages: HashMap<Uuid, Vec<StoredMessage>>,
    default_account_ttl_seconds: i64,
}

impl MemoryStore {
    pub fn new(config: &Config) -> Self {
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
        }
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
    ) -> AppResult<usize> {
        if self.imported_source_keys.contains(&imported.source_key) {
            return Ok(0);
        }

        let mut imported_count = 0;

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
            self.messages.entry(account_id).or_default().push(message);
            imported_count += 1;
        }

        if imported_count > 0 {
            self.imported_source_keys.insert(imported.source_key);
        }

        Ok(imported_count)
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

        Ok(MessageSeenResponse { seen: message.seen })
    }

    pub fn delete_message(&mut self, account_id: Uuid, message_id: Uuid) -> AppResult<()> {
        let account = self
            .accounts
            .get(&account_id)
            .ok_or_else(|| ApiError::not_found("account not found"))?;
        ensure_account_active(account)?;

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

        Ok(())
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
    use super::{MemoryStore, normalize_domain, split_address};
    use crate::config::Config;

    #[test]
    fn account_flow_bootstraps_with_seed_message() {
        let config = Config::default();
        let mut store = MemoryStore::new(&config);
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
        let config = Config::default();
        let mut store = MemoryStore::new(&config);
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
        let config = Config::default();
        let mut store = MemoryStore::new(&config);
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
        let config = Config::default();
        let mut store = MemoryStore::new(&config);

        let error = store
            .create_account("demo@tmpmail.local", "short", None)
            .expect_err("short password should be rejected");

        assert_eq!(error.to_string(), "password must be at least 6 characters");
    }

    #[test]
    fn create_account_rejects_short_username() {
        let config = Config::default();
        let mut store = MemoryStore::new(&config);

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
        let config = Config::default();
        let store = MemoryStore::new(&config);

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
        let config = Config::default();
        let mut store = MemoryStore::new(&config);

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
}

use std::collections::HashSet;

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool, Postgres, Transaction, postgres::PgPoolOptions, types::Json};
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
    store::{
        CleanupReport, ImportedMessageReceipt, PendingDomainCheck, StoreSnapshot, StoreStats,
        StoredMessage, load_snapshot_for_import, snapshot_has_records,
    },
};

const PAGE_SIZE: usize = 30;
const DEFAULT_QUOTA_BYTES: u64 = 50 * 1024 * 1024;
const MAX_AUDIT_LOGS: i64 = 500;

#[derive(Debug)]
pub struct PgStore {
    pool: PgPool,
    default_account_ttl_seconds: i64,
}

#[derive(Debug, FromRow)]
struct DomainRow {
    id: Uuid,
    domain: String,
    is_verified: bool,
    status: String,
    verification_token: Option<String>,
    verification_error: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
struct AccountRow {
    id: Uuid,
    address: String,
    password_hash: String,
    is_disabled: bool,
    is_deleted: bool,
    expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, FromRow)]
struct AccountWithUsedRow {
    id: Uuid,
    address: String,
    quota: i64,
    is_disabled: bool,
    is_deleted: bool,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    used: i64,
}

#[derive(Debug, FromRow)]
struct MessageRow {
    id: Uuid,
    account_id: Uuid,
    msgid: String,
    from_address: Json<MessageAddress>,
    to_addresses: Json<Vec<MessageAddress>>,
    subject: String,
    intro: String,
    seen: bool,
    is_deleted: bool,
    has_attachments: bool,
    size: i64,
    download_url: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    text_content: String,
    html_parts: Json<Vec<String>>,
    attachments: Json<Vec<Attachment>>,
}

#[derive(Debug, FromRow)]
struct CleanupDomainRow {
    id: Uuid,
    domain: String,
}

#[derive(Debug, FromRow)]
struct CleanupAccountRow {
    id: Uuid,
    address: String,
}

#[derive(Debug, FromRow)]
struct UpdatedMessageRow {
    id: Uuid,
    account_id: Uuid,
}

#[derive(Debug, FromRow)]
struct StatsRow {
    total_domains: i64,
    active_domains: i64,
    pending_domains: i64,
    total_accounts: i64,
    active_accounts: i64,
    total_messages: i64,
    active_messages: i64,
    deleted_messages: i64,
    audit_logs_total: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct PreparedMessageRecord {
    id: Uuid,
    source_key: Option<String>,
    msgid: String,
    from_address: MessageAddress,
    to_addresses: Vec<MessageAddress>,
    subject: String,
    intro: String,
    seen: bool,
    is_deleted: bool,
    has_attachments: bool,
    size: u64,
    download_url: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    text_content: String,
    html_parts: Vec<String>,
    attachments: Vec<Attachment>,
}

impl PgStore {
    pub async fn new(config: &Config, database_url: &str) -> AppResult<Self> {
        let pool = PgPoolOptions::new()
            .max_connections(10)
            .connect(database_url)
            .await
            .map_err(map_sqlx_error)?;

        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .map_err(|error| ApiError::internal(error.to_string()))?;

        let store = Self {
            pool,
            default_account_ttl_seconds: config.default_account_ttl_seconds,
        };
        store
            .import_snapshot_if_needed(&config.store_state_path)
            .await?;
        store.ensure_configured_public_domains(config).await?;

        Ok(store)
    }

    pub async fn ready(&self) -> AppResult<()> {
        sqlx::query_scalar::<_, i32>("SELECT 1")
            .fetch_one(&self.pool)
            .await
            .map_err(map_sqlx_error)?;

        Ok(())
    }

    pub async fn list_domains(&self) -> AppResult<Vec<Domain>> {
        let rows = sqlx::query_as::<_, DomainRow>(
            r#"
            SELECT id, domain, is_verified, status, verification_token, verification_error, created_at, updated_at
            FROM domains
            WHERE is_verified = TRUE AND status = 'active'
            ORDER BY domain
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        Ok(rows.into_iter().map(DomainRow::to_public).collect())
    }

    pub async fn list_all_domains(&self) -> AppResult<Vec<Domain>> {
        let rows = sqlx::query_as::<_, DomainRow>(
            r#"
            SELECT id, domain, is_verified, status, verification_token, verification_error, created_at, updated_at
            FROM domains
            ORDER BY domain
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        Ok(rows.into_iter().map(DomainRow::to_public).collect())
    }

    pub async fn create_domain(&self, domain: &str) -> AppResult<Domain> {
        let normalized_domain = normalize_domain(domain)?;
        let now = Utc::now();
        let row = sqlx::query_as::<_, DomainRow>(
            r#"
            INSERT INTO domains (
                id, domain, is_verified, status, verification_token, verification_error, created_at, updated_at
            )
            VALUES ($1, $2, FALSE, 'pending_verification', $3, NULL, $4, $4)
            RETURNING id, domain, is_verified, status, verification_token, verification_error, created_at, updated_at
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(&normalized_domain)
        .bind(format!("tmpmail-verify-{}", Uuid::new_v4().simple()))
        .bind(now)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| match_unique_violation(error, "domain already exists"))?;

        self.append_audit_log(
            "domain.create",
            "domain",
            row.id.to_string(),
            None,
            format!("domain={} status={}", row.domain, row.status),
        )
        .await?;

        Ok(row.to_public())
    }

    pub async fn domain_dns_records(
        &self,
        domain_id: Uuid,
        config: &Config,
    ) -> AppResult<Vec<DomainDnsRecord>> {
        let row = self.fetch_domain(domain_id).await?;
        let verification_token = row.verification_token.as_deref().ok_or_else(|| {
            ApiError::validation("system domains do not expose verification records")
        })?;

        Ok(build_dns_records(&row.domain, verification_token, config))
    }

    pub async fn domain_verification_context(
        &self,
        domain_id: Uuid,
    ) -> AppResult<(String, String)> {
        let row = self.fetch_domain(domain_id).await?;
        let token = row
            .verification_token
            .ok_or_else(|| ApiError::validation("system domains do not require verification"))?;

        Ok((row.domain, token))
    }

    pub async fn update_domain_verification_status(
        &self,
        domain_id: Uuid,
        is_verified: bool,
        verification_error: Option<String>,
    ) -> AppResult<Domain> {
        let now = Utc::now();
        let row = sqlx::query_as::<_, DomainRow>(
            r#"
            UPDATE domains
            SET
                is_verified = $2,
                status = $3,
                verification_error = $4,
                updated_at = $5
            WHERE id = $1
            RETURNING id, domain, is_verified, status, verification_token, verification_error, created_at, updated_at
            "#,
        )
        .bind(domain_id)
        .bind(is_verified)
        .bind(if is_verified {
            "active"
        } else {
            "pending_verification"
        })
        .bind(verification_error.clone())
        .bind(now)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_error)?
        .ok_or_else(|| ApiError::not_found("domain not found"))?;

        self.append_audit_log(
            if is_verified {
                "domain.verify.success"
            } else {
                "domain.verify.failed"
            },
            "domain",
            row.id.to_string(),
            None,
            verification_error.unwrap_or_else(|| "domain is active".to_owned()),
        )
        .await?;

        Ok(row.to_public())
    }

    pub async fn pending_domain_checks(&self) -> AppResult<Vec<PendingDomainCheck>> {
        let rows = sqlx::query_as::<_, DomainRow>(
            r#"
            SELECT id, domain, is_verified, status, verification_token, verification_error, created_at, updated_at
            FROM domains
            WHERE is_verified = FALSE
              AND status = 'pending_verification'
              AND verification_token IS NOT NULL
            ORDER BY created_at ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        Ok(rows
            .into_iter()
            .filter_map(|row| {
                Some(PendingDomainCheck {
                    id: row.id,
                    domain: row.domain,
                    verification_token: row.verification_token?,
                })
            })
            .collect())
    }

    pub async fn create_account(
        &self,
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
        let is_domain_available = sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS(
                SELECT 1
                FROM domains
                WHERE domain = $1
                  AND is_verified = TRUE
                  AND status = 'active'
            )
            "#,
        )
        .bind(domain)
        .fetch_one(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        if !is_domain_available {
            return Err(ApiError::validation("selected domain is not available"));
        }

        let now = Utc::now();
        let expires_at = resolve_expires_at(now, expires_in, self.default_account_ttl_seconds)?;
        let account_id = Uuid::new_v4();
        let mut tx = self.pool.begin().await.map_err(map_sqlx_error)?;

        let account_row = sqlx::query_as::<_, AccountRow>(
            r#"
            INSERT INTO accounts (
                id, address, password_hash, quota, is_disabled, is_deleted, created_at, updated_at, expires_at
            )
            VALUES ($1, $2, $3, $4, FALSE, FALSE, $5, $5, $6)
            RETURNING id, address, password_hash, is_disabled, is_deleted, expires_at
            "#,
        )
        .bind(account_id)
        .bind(&normalized_address)
        .bind(auth::hash_password(password)?)
        .bind(u64_to_i64(DEFAULT_QUOTA_BYTES, "quota")?)
        .bind(now)
        .bind(expires_at)
        .fetch_one(&mut *tx)
        .await
        .map_err(|error| match_unique_violation(error, "Email address already exists"))?;

        let welcome = build_welcome_message(&account_row.address);
        self.insert_message_tx(&mut tx, account_id, &welcome)
            .await?;
        insert_audit_log_tx(
            &mut tx,
            "account.create",
            "account",
            account_id.to_string(),
            None,
            format!("address={}", account_row.address),
        )
        .await?;
        trim_audit_logs_tx(&mut tx).await?;
        tx.commit().await.map_err(map_sqlx_error)?;

        self.get_account(account_id).await
    }

    pub async fn authenticate(&self, address: &str, password: &str) -> AppResult<(Uuid, String)> {
        let normalized_address = normalize_address(address)?;
        let account = sqlx::query_as::<_, AccountRow>(
            r#"
            SELECT id, address, password_hash, is_disabled, is_deleted, expires_at
            FROM accounts
            WHERE address = $1 AND is_deleted = FALSE
            LIMIT 1
            "#,
        )
        .bind(&normalized_address)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_error)?
        .ok_or_else(|| ApiError::unauthorized("invalid email or password"))?;

        ensure_account_active(&account)?;

        if !auth::verify_password(password, &account.password_hash)? {
            return Err(ApiError::unauthorized("invalid email or password"));
        }

        Ok((account.id, account.address))
    }

    pub async fn get_account(&self, account_id: Uuid) -> AppResult<Account> {
        let row = sqlx::query_as::<_, AccountWithUsedRow>(
            r#"
            SELECT
                accounts.id,
                accounts.address,
                accounts.quota,
                accounts.is_disabled,
                accounts.is_deleted,
                accounts.created_at,
                accounts.updated_at,
                COALESCE((
                    SELECT SUM(messages.size)
                    FROM messages
                    WHERE messages.account_id = accounts.id
                      AND messages.is_deleted = FALSE
                ), 0) AS used
            FROM accounts
            WHERE accounts.id = $1
            "#,
        )
        .bind(account_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_error)?
        .ok_or_else(|| ApiError::not_found("account not found"))?;

        let active_row = sqlx::query_as::<_, AccountRow>(
            r#"
            SELECT id, address, password_hash, is_disabled, is_deleted, expires_at
            FROM accounts
            WHERE id = $1
            "#,
        )
        .bind(account_id)
        .fetch_one(&self.pool)
        .await
        .map_err(map_sqlx_error)?;
        ensure_account_active(&active_row)?;

        Ok(Account {
            id: row.id.to_string(),
            address: row.address,
            quota: i64_to_u64(row.quota, "quota")?,
            used: i64_to_u64(row.used, "used")?,
            is_disabled: row.is_disabled,
            is_deleted: row.is_deleted,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
    }

    pub async fn delete_account(&self, account_id: Uuid) -> AppResult<()> {
        let account = sqlx::query_as::<_, AccountRow>(
            r#"
            SELECT id, address, password_hash, is_disabled, is_deleted, expires_at
            FROM accounts
            WHERE id = $1
            "#,
        )
        .bind(account_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_error)?
        .ok_or_else(|| ApiError::not_found("account not found"))?;
        ensure_account_active(&account)?;

        let now = Utc::now();
        let mut tx = self.pool.begin().await.map_err(map_sqlx_error)?;
        sqlx::query(
            r#"
            UPDATE accounts
            SET is_deleted = TRUE, updated_at = $2
            WHERE id = $1
            "#,
        )
        .bind(account_id)
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;
        sqlx::query(
            r#"
            UPDATE messages
            SET is_deleted = TRUE, updated_at = $2
            WHERE account_id = $1 AND is_deleted = FALSE
            "#,
        )
        .bind(account_id)
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;
        insert_audit_log_tx(
            &mut tx,
            "account.delete",
            "account",
            account_id.to_string(),
            None,
            format!("address={}", account.address),
        )
        .await?;
        trim_audit_logs_tx(&mut tx).await?;
        tx.commit().await.map_err(map_sqlx_error)?;

        Ok(())
    }

    pub async fn active_account_addresses(&self) -> AppResult<Vec<String>> {
        sqlx::query_scalar::<_, String>(
            r#"
            SELECT address
            FROM accounts
            WHERE is_deleted = FALSE
              AND is_disabled = FALSE
              AND (expires_at IS NULL OR expires_at > NOW())
            ORDER BY address
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_sqlx_error)
    }

    pub async fn has_imported_source(&self, source_key: &str) -> AppResult<bool> {
        sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS(
                SELECT 1
                FROM imported_source_keys
                WHERE source_key = $1
            )
            "#,
        )
        .bind(source_key)
        .fetch_one(&self.pool)
        .await
        .map_err(map_sqlx_error)
    }

    pub async fn import_message_for_recipients(
        &self,
        recipients: &[String],
        imported: ImportedMessage,
    ) -> AppResult<Vec<ImportedMessageReceipt>> {
        let normalized = recipients
            .iter()
            .map(|recipient| recipient.trim().to_lowercase())
            .filter(|recipient| !recipient.is_empty())
            .collect::<Vec<_>>();
        if normalized.is_empty() {
            return Ok(Vec::new());
        }

        let accounts = sqlx::query_as::<_, CleanupAccountRow>(
            r#"
            SELECT id, address
            FROM accounts
            WHERE address = ANY($1)
              AND is_deleted = FALSE
              AND is_disabled = FALSE
              AND (expires_at IS NULL OR expires_at > NOW())
            ORDER BY address
            "#,
        )
        .bind(&normalized)
        .fetch_all(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        if accounts.is_empty() {
            return Ok(Vec::new());
        }

        let mut tx = self.pool.begin().await.map_err(map_sqlx_error)?;
        let inserted_source = sqlx::query_scalar::<_, String>(
            r#"
            INSERT INTO imported_source_keys (source_key, created_at)
            VALUES ($1, $2)
            ON CONFLICT (source_key) DO NOTHING
            RETURNING source_key
            "#,
        )
        .bind(&imported.source_key)
        .bind(Utc::now())
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

        if inserted_source.is_none() {
            tx.rollback().await.map_err(map_sqlx_error)?;
            return Ok(Vec::new());
        }

        let mut receipts = Vec::with_capacity(accounts.len());
        for account in accounts {
            let prepared = build_imported_message(&imported);
            self.insert_message_tx(&mut tx, account.id, &prepared)
                .await?;
            insert_audit_log_tx(
                &mut tx,
                "message.import",
                "message",
                prepared.id.to_string(),
                Some(account.id.to_string()),
                format!(
                    "source_key={} subject={}",
                    imported.source_key, imported.subject
                ),
            )
            .await?;
            receipts.push(ImportedMessageReceipt {
                account_id: account.id,
                message_id: prepared.id,
            });
        }

        trim_audit_logs_tx(&mut tx).await?;
        tx.commit().await.map_err(map_sqlx_error)?;

        Ok(receipts)
    }

    pub async fn list_messages(
        &self,
        account_id: Uuid,
        page: usize,
    ) -> AppResult<(Vec<MessageSummary>, usize)> {
        self.assert_account_active(account_id).await?;

        let total = sqlx::query_scalar::<_, i64>(
            r#"
            SELECT COUNT(*)
            FROM messages
            WHERE account_id = $1 AND is_deleted = FALSE
            "#,
        )
        .bind(account_id)
        .fetch_one(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        let page = page.max(1);
        let start = ((page - 1) * PAGE_SIZE) as i64;
        let rows = sqlx::query_as::<_, MessageRow>(
            r#"
            SELECT
                id, account_id, msgid, from_address, to_addresses, subject, intro,
                seen, is_deleted, has_attachments, size, download_url, created_at, updated_at,
                text_content, html_parts, attachments
            FROM messages
            WHERE account_id = $1 AND is_deleted = FALSE
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
            "#,
        )
        .bind(account_id)
        .bind(PAGE_SIZE as i64)
        .bind(start)
        .fetch_all(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        let messages = rows
            .into_iter()
            .map(MessageRow::to_summary)
            .collect::<AppResult<Vec<_>>>()?;

        Ok((messages, i64_to_usize(total, "total messages")?))
    }

    pub async fn get_message(
        &self,
        account_id: Uuid,
        message_id: Uuid,
    ) -> AppResult<MessageDetail> {
        self.assert_account_active(account_id).await?;

        let row = sqlx::query_as::<_, MessageRow>(
            r#"
            SELECT
                id, account_id, msgid, from_address, to_addresses, subject, intro,
                seen, is_deleted, has_attachments, size, download_url, created_at, updated_at,
                text_content, html_parts, attachments
            FROM messages
            WHERE account_id = $1
              AND id = $2
              AND is_deleted = FALSE
            "#,
        )
        .bind(account_id)
        .bind(message_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_error)?
        .ok_or_else(|| ApiError::not_found("message not found"))?;

        row.to_detail()
    }

    pub async fn mark_message_seen(
        &self,
        account_id: Uuid,
        message_id: Uuid,
        seen: bool,
    ) -> AppResult<MessageSeenResponse> {
        self.assert_account_active(account_id).await?;

        let response = sqlx::query_scalar::<_, bool>(
            r#"
            UPDATE messages
            SET seen = $3, updated_at = $4
            WHERE account_id = $1
              AND id = $2
              AND is_deleted = FALSE
            RETURNING seen
            "#,
        )
        .bind(account_id)
        .bind(message_id)
        .bind(seen)
        .bind(Utc::now())
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_error)?
        .ok_or_else(|| ApiError::not_found("message not found"))?;

        self.append_audit_log(
            "message.seen",
            "message",
            message_id.to_string(),
            Some(account_id.to_string()),
            format!("seen={seen}"),
        )
        .await?;

        Ok(MessageSeenResponse { seen: response })
    }

    pub async fn delete_message(&self, account_id: Uuid, message_id: Uuid) -> AppResult<()> {
        self.assert_account_active(account_id).await?;

        let rows_affected = sqlx::query(
            r#"
            UPDATE messages
            SET is_deleted = TRUE, updated_at = $3
            WHERE account_id = $1
              AND id = $2
              AND is_deleted = FALSE
            "#,
        )
        .bind(account_id)
        .bind(message_id)
        .bind(Utc::now())
        .execute(&self.pool)
        .await
        .map_err(map_sqlx_error)?
        .rows_affected();

        if rows_affected == 0 {
            return Err(ApiError::not_found("message not found"));
        }

        self.append_audit_log(
            "message.delete",
            "message",
            message_id.to_string(),
            Some(account_id.to_string()),
            "soft deleted from mailbox".to_owned(),
        )
        .await?;

        Ok(())
    }

    pub async fn reconcile_mailbox_sources(
        &self,
        mailbox: &str,
        active_source_keys: &HashSet<String>,
    ) -> AppResult<usize> {
        let mailbox_prefix = format!("{mailbox}:%");
        let now = Utc::now();
        let rows = if active_source_keys.is_empty() {
            sqlx::query_as::<_, UpdatedMessageRow>(
                r#"
                UPDATE messages
                SET is_deleted = TRUE, updated_at = $2
                WHERE source_key IS NOT NULL
                  AND source_key LIKE $1
                  AND is_deleted = FALSE
                RETURNING id, account_id
                "#,
            )
            .bind(&mailbox_prefix)
            .bind(now)
            .fetch_all(&self.pool)
            .await
            .map_err(map_sqlx_error)?
        } else {
            let active_keys = active_source_keys.iter().cloned().collect::<Vec<_>>();
            sqlx::query_as::<_, UpdatedMessageRow>(
                r#"
                UPDATE messages
                SET is_deleted = TRUE, updated_at = $3
                WHERE source_key IS NOT NULL
                  AND source_key LIKE $1
                  AND NOT (source_key = ANY($2))
                  AND is_deleted = FALSE
                RETURNING id, account_id
                "#,
            )
            .bind(&mailbox_prefix)
            .bind(&active_keys)
            .bind(now)
            .fetch_all(&self.pool)
            .await
            .map_err(map_sqlx_error)?
        };

        if rows.is_empty() {
            return Ok(0);
        }

        let mut tx = self.pool.begin().await.map_err(map_sqlx_error)?;
        for row in &rows {
            insert_audit_log_tx(
                &mut tx,
                "message.delete.sync",
                "message",
                row.id.to_string(),
                Some(row.account_id.to_string()),
                format!("mailbox={mailbox} upstream message missing"),
            )
            .await?;
        }
        trim_audit_logs_tx(&mut tx).await?;
        tx.commit().await.map_err(map_sqlx_error)?;

        Ok(rows.len())
    }

    pub async fn cleanup_expired_accounts(&self) -> AppResult<CleanupReport> {
        let expired_accounts = sqlx::query_as::<_, CleanupAccountRow>(
            r#"
            SELECT id, address
            FROM accounts
            WHERE is_deleted = FALSE
              AND is_disabled = FALSE
              AND expires_at IS NOT NULL
              AND expires_at <= NOW()
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        if expired_accounts.is_empty() {
            return Ok(CleanupReport::default());
        }

        let account_ids = expired_accounts
            .iter()
            .map(|row| row.id)
            .collect::<Vec<_>>();
        let now = Utc::now();
        let mut tx = self.pool.begin().await.map_err(map_sqlx_error)?;
        let deleted_messages = sqlx::query_scalar::<_, i64>(
            r#"
            SELECT COUNT(*)
            FROM messages
            WHERE account_id = ANY($1) AND is_deleted = FALSE
            "#,
        )
        .bind(&account_ids)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

        sqlx::query(
            r#"
            UPDATE accounts
            SET is_deleted = TRUE, updated_at = $2
            WHERE id = ANY($1)
            "#,
        )
        .bind(&account_ids)
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;
        sqlx::query(
            r#"
            UPDATE messages
            SET is_deleted = TRUE, updated_at = $2
            WHERE account_id = ANY($1) AND is_deleted = FALSE
            "#,
        )
        .bind(&account_ids)
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

        for account in &expired_accounts {
            insert_audit_log_tx(
                &mut tx,
                "account.expire",
                "account",
                account.id.to_string(),
                None,
                format!("address={}", account.address),
            )
            .await?;
        }

        trim_audit_logs_tx(&mut tx).await?;
        tx.commit().await.map_err(map_sqlx_error)?;

        Ok(CleanupReport {
            deleted_accounts: expired_accounts.len(),
            deleted_messages: i64_to_usize(deleted_messages, "deleted messages")?,
            deleted_domains: 0,
        })
    }

    pub async fn cleanup_stale_pending_domains(&self, max_age: Duration) -> AppResult<usize> {
        let threshold = Utc::now() - max_age;
        let removed = sqlx::query_as::<_, CleanupDomainRow>(
            r#"
            DELETE FROM domains
            WHERE id IN (
                SELECT id
                FROM domains
                WHERE is_verified = FALSE
                  AND status = 'pending_verification'
                  AND created_at <= $1
            )
            RETURNING id, domain
            "#,
        )
        .bind(threshold)
        .fetch_all(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        if removed.is_empty() {
            return Ok(0);
        }

        let mut tx = self.pool.begin().await.map_err(map_sqlx_error)?;
        for domain in &removed {
            insert_audit_log_tx(
                &mut tx,
                "domain.cleanup",
                "domain",
                domain.id.to_string(),
                None,
                format!("removed stale pending domain {}", domain.domain),
            )
            .await?;
        }
        trim_audit_logs_tx(&mut tx).await?;
        tx.commit().await.map_err(map_sqlx_error)?;

        Ok(removed.len())
    }

    pub async fn stats(&self) -> AppResult<StoreStats> {
        let row = sqlx::query_as::<_, StatsRow>(
            r#"
            SELECT
                (SELECT COUNT(*) FROM domains) AS total_domains,
                (SELECT COUNT(*) FROM domains WHERE is_verified = TRUE AND status = 'active') AS active_domains,
                (SELECT COUNT(*) FROM domains WHERE status = 'pending_verification') AS pending_domains,
                (SELECT COUNT(*) FROM accounts) AS total_accounts,
                (SELECT COUNT(*) FROM accounts WHERE is_deleted = FALSE AND is_disabled = FALSE AND (expires_at IS NULL OR expires_at > NOW())) AS active_accounts,
                (SELECT COUNT(*) FROM messages) AS total_messages,
                (SELECT COUNT(*) FROM messages WHERE is_deleted = FALSE) AS active_messages,
                (SELECT COUNT(*) FROM messages WHERE is_deleted = TRUE) AS deleted_messages,
                (SELECT COUNT(*) FROM audit_logs) AS audit_logs_total
            "#,
        )
        .fetch_one(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        Ok(StoreStats {
            total_domains: i64_to_usize(row.total_domains, "total domains")?,
            active_domains: i64_to_usize(row.active_domains, "active domains")?,
            pending_domains: i64_to_usize(row.pending_domains, "pending domains")?,
            total_accounts: i64_to_usize(row.total_accounts, "total accounts")?,
            active_accounts: i64_to_usize(row.active_accounts, "active accounts")?,
            total_messages: i64_to_usize(row.total_messages, "total messages")?,
            active_messages: i64_to_usize(row.active_messages, "active messages")?,
            deleted_messages: i64_to_usize(row.deleted_messages, "deleted messages")?,
            audit_logs_total: i64_to_usize(row.audit_logs_total, "audit logs")?,
        })
    }

    pub async fn audit_logs(&self, limit: usize) -> AppResult<Vec<String>> {
        sqlx::query_scalar::<_, String>(
            r#"
            SELECT entry
            FROM audit_logs
            ORDER BY created_at DESC, id DESC
            LIMIT $1
            "#,
        )
        .bind(limit.clamp(1, MAX_AUDIT_LOGS as usize) as i64)
        .fetch_all(&self.pool)
        .await
        .map_err(map_sqlx_error)
    }

    pub async fn append_audit_log(
        &self,
        action: &str,
        entity_type: &str,
        entity_id: String,
        actor_id: Option<String>,
        detail: String,
    ) -> AppResult<()> {
        let mut tx = self.pool.begin().await.map_err(map_sqlx_error)?;
        insert_audit_log_tx(&mut tx, action, entity_type, entity_id, actor_id, detail).await?;
        trim_audit_logs_tx(&mut tx).await?;
        tx.commit().await.map_err(map_sqlx_error)?;

        Ok(())
    }

    async fn ensure_configured_public_domains(&self, config: &Config) -> AppResult<()> {
        let now = Utc::now();
        for domain in &config.public_domains {
            sqlx::query(
                r#"
                INSERT INTO domains (
                    id, domain, is_verified, status, verification_token, verification_error, created_at, updated_at
                )
                VALUES ($1, $2, TRUE, 'active', NULL, NULL, $3, $3)
                ON CONFLICT (domain) DO UPDATE
                SET
                    is_verified = TRUE,
                    status = 'active',
                    verification_token = NULL,
                    verification_error = NULL,
                    updated_at = EXCLUDED.updated_at
                "#,
            )
            .bind(Uuid::new_v4())
            .bind(domain)
            .bind(now)
            .execute(&self.pool)
            .await
            .map_err(map_sqlx_error)?;
        }

        Ok(())
    }

    async fn import_snapshot_if_needed(&self, snapshot_path: &str) -> AppResult<()> {
        if !self.is_database_empty().await? {
            return Ok(());
        }

        let Some(snapshot) = load_snapshot_for_import(snapshot_path)? else {
            return Ok(());
        };
        if !snapshot_has_records(&snapshot) {
            return Ok(());
        }

        let mut tx = self.pool.begin().await.map_err(map_sqlx_error)?;
        self.import_domains_tx(&mut tx, &snapshot).await?;
        self.import_accounts_tx(&mut tx, &snapshot).await?;
        self.import_imported_sources_tx(&mut tx, &snapshot).await?;
        self.import_messages_tx(&mut tx, &snapshot).await?;
        self.import_audit_logs_tx(&mut tx, &snapshot).await?;
        tx.commit().await.map_err(map_sqlx_error)?;

        tracing::info!(
            domains = snapshot.domains.len(),
            accounts = snapshot.accounts.len(),
            mailbox_count = snapshot.messages.len(),
            audit_logs = snapshot.audit_logs.len(),
            "imported JSON snapshot into PostgreSQL store"
        );

        Ok(())
    }

    async fn is_database_empty(&self) -> AppResult<bool> {
        let has_records = sqlx::query_scalar::<_, bool>(
            r#"
            SELECT
                EXISTS(SELECT 1 FROM domains LIMIT 1)
                OR EXISTS(SELECT 1 FROM accounts LIMIT 1)
                OR EXISTS(SELECT 1 FROM messages LIMIT 1)
                OR EXISTS(SELECT 1 FROM imported_source_keys LIMIT 1)
                OR EXISTS(SELECT 1 FROM audit_logs LIMIT 1)
            "#,
        )
        .fetch_one(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        Ok(!has_records)
    }

    async fn import_domains_tx(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        snapshot: &StoreSnapshot,
    ) -> AppResult<()> {
        for domain in &snapshot.domains {
            sqlx::query(
                r#"
                INSERT INTO domains (
                    id, domain, is_verified, status, verification_token, verification_error, created_at, updated_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (domain) DO NOTHING
                "#,
            )
            .bind(domain.id)
            .bind(&domain.domain)
            .bind(domain.is_verified)
            .bind(&domain.status)
            .bind(domain.verification_token.clone())
            .bind(domain.verification_error.clone())
            .bind(domain.created_at)
            .bind(domain.updated_at)
            .execute(&mut **tx)
            .await
            .map_err(map_sqlx_error)?;
        }

        Ok(())
    }

    async fn import_accounts_tx(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        snapshot: &StoreSnapshot,
    ) -> AppResult<()> {
        for account in snapshot.accounts.values() {
            sqlx::query(
                r#"
                INSERT INTO accounts (
                    id, address, password_hash, quota, is_disabled, is_deleted, created_at, updated_at, expires_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT (id) DO NOTHING
                "#,
            )
            .bind(account.id)
            .bind(&account.address)
            .bind(&account.password_hash)
            .bind(u64_to_i64(account.quota, "quota")?)
            .bind(account.is_disabled)
            .bind(account.is_deleted)
            .bind(account.created_at)
            .bind(account.updated_at)
            .bind(account.expires_at)
            .execute(&mut **tx)
            .await
            .map_err(map_sqlx_error)?;
        }

        Ok(())
    }

    async fn import_imported_sources_tx(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        snapshot: &StoreSnapshot,
    ) -> AppResult<()> {
        for source_key in &snapshot.imported_source_keys {
            sqlx::query(
                r#"
                INSERT INTO imported_source_keys (source_key, created_at)
                VALUES ($1, $2)
                ON CONFLICT (source_key) DO NOTHING
                "#,
            )
            .bind(source_key)
            .bind(Utc::now())
            .execute(&mut **tx)
            .await
            .map_err(map_sqlx_error)?;
        }

        Ok(())
    }

    async fn import_messages_tx(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        snapshot: &StoreSnapshot,
    ) -> AppResult<()> {
        for (account_id, messages) in &snapshot.messages {
            for message in messages {
                let prepared = prepared_message_from_snapshot(message);
                self.insert_message_tx(tx, *account_id, &prepared).await?;
            }
        }

        Ok(())
    }

    async fn import_audit_logs_tx(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        snapshot: &StoreSnapshot,
    ) -> AppResult<()> {
        for entry in &snapshot.audit_logs {
            sqlx::query(
                r#"
                INSERT INTO audit_logs (entry, created_at)
                VALUES ($1, $2)
                "#,
            )
            .bind(entry)
            .bind(parse_audit_log_timestamp(entry))
            .execute(&mut **tx)
            .await
            .map_err(map_sqlx_error)?;
        }

        trim_audit_logs_tx(tx).await
    }

    async fn fetch_domain(&self, domain_id: Uuid) -> AppResult<DomainRow> {
        sqlx::query_as::<_, DomainRow>(
            r#"
            SELECT id, domain, is_verified, status, verification_token, verification_error, created_at, updated_at
            FROM domains
            WHERE id = $1
            "#,
        )
        .bind(domain_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_error)?
        .ok_or_else(|| ApiError::not_found("domain not found"))
    }

    async fn assert_account_active(&self, account_id: Uuid) -> AppResult<AccountRow> {
        let account = sqlx::query_as::<_, AccountRow>(
            r#"
            SELECT id, address, password_hash, is_disabled, is_deleted, expires_at
            FROM accounts
            WHERE id = $1
            "#,
        )
        .bind(account_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_error)?
        .ok_or_else(|| ApiError::not_found("account not found"))?;
        ensure_account_active(&account)?;
        Ok(account)
    }

    async fn insert_message_tx(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        account_id: Uuid,
        message: &PreparedMessageRecord,
    ) -> AppResult<()> {
        sqlx::query(
            r#"
            INSERT INTO messages (
                id, account_id, source_key, msgid, from_address, to_addresses, subject, intro,
                seen, is_deleted, has_attachments, size, download_url, created_at, updated_at,
                text_content, html_parts, attachments
            )
            VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8,
                $9, $10, $11, $12, $13, $14, $15,
                $16, $17, $18
            )
            "#,
        )
        .bind(message.id)
        .bind(account_id)
        .bind(message.source_key.clone())
        .bind(&message.msgid)
        .bind(Json(message.from_address.clone()))
        .bind(Json(message.to_addresses.clone()))
        .bind(&message.subject)
        .bind(&message.intro)
        .bind(message.seen)
        .bind(message.is_deleted)
        .bind(message.has_attachments)
        .bind(u64_to_i64(message.size, "message size")?)
        .bind(&message.download_url)
        .bind(message.created_at)
        .bind(message.updated_at)
        .bind(&message.text_content)
        .bind(Json(message.html_parts.clone()))
        .bind(Json(message.attachments.clone()))
        .execute(&mut **tx)
        .await
        .map_err(map_sqlx_error)?;

        Ok(())
    }
}

impl DomainRow {
    fn to_public(self) -> Domain {
        Domain {
            id: self.id.to_string(),
            domain: self.domain,
            is_verified: self.is_verified,
            status: self.status,
            verification_token: self.verification_token,
            verification_error: self.verification_error,
            created_at: self.created_at,
            updated_at: self.updated_at,
        }
    }
}

impl MessageRow {
    fn to_summary(self) -> AppResult<MessageSummary> {
        Ok(MessageSummary {
            id: self.id.to_string(),
            account_id: self.account_id.to_string(),
            msgid: self.msgid,
            from: self.from_address.0,
            to: self.to_addresses.0,
            subject: self.subject,
            intro: self.intro,
            seen: self.seen,
            is_deleted: self.is_deleted,
            has_attachments: self.has_attachments,
            size: i64_to_u64(self.size, "message size")?,
            download_url: self.download_url,
            created_at: self.created_at,
            updated_at: self.updated_at,
        })
    }

    fn to_detail(self) -> AppResult<MessageDetail> {
        let MessageRow {
            id,
            account_id,
            msgid,
            from_address,
            to_addresses,
            subject,
            intro,
            seen,
            is_deleted,
            has_attachments,
            size,
            download_url,
            created_at,
            updated_at,
            text_content,
            html_parts,
            attachments,
        } = self;

        Ok(MessageDetail {
            summary: MessageSummary {
                id: id.to_string(),
                account_id: account_id.to_string(),
                msgid,
                from: from_address.0,
                to: to_addresses.0,
                subject,
                intro,
                seen,
                is_deleted,
                has_attachments,
                size: i64_to_u64(size, "message size")?,
                download_url,
                created_at,
                updated_at,
            },
            cc: Vec::new(),
            bcc: Vec::new(),
            text: text_content,
            html: html_parts.0,
            attachments: attachments.0,
        })
    }
}

fn build_welcome_message(address: &str) -> PreparedMessageRecord {
    let now = Utc::now();
    let message_id = Uuid::new_v4();
    let sender_domain = address
        .split_once('@')
        .map(|(_, domain)| domain)
        .unwrap_or("localhost");
    let text = format!(
        "Welcome to TmpMail.\n\nMailbox {} is ready. This is a seed message for the P0 flow.\n",
        address
    );
    let html_parts = vec![format!(
        "<p><strong>Welcome to TmpMail.</strong></p><p>Mailbox <code>{}</code> is ready. This is a seed message for the P0 flow.</p>",
        address
    )];
    let size = text.len() as u64 + html_parts.iter().map(|part| part.len() as u64).sum::<u64>();

    PreparedMessageRecord {
        id: message_id,
        source_key: None,
        msgid: format!("<{}@{}>", message_id, sender_domain),
        from_address: MessageAddress {
            name: "TmpMail".to_owned(),
            address: format!("noreply@{}", sender_domain),
        },
        to_addresses: vec![MessageAddress {
            name: address.to_owned(),
            address: address.to_owned(),
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
        text_content: text,
        html_parts,
        attachments: Vec::new(),
    }
}

fn build_imported_message(imported: &ImportedMessage) -> PreparedMessageRecord {
    PreparedMessageRecord {
        id: Uuid::new_v4(),
        source_key: Some(imported.source_key.clone()),
        msgid: imported.msgid.clone(),
        from_address: imported.from.clone(),
        to_addresses: imported.to.clone(),
        subject: imported.subject.clone(),
        intro: imported.intro.clone(),
        seen: false,
        is_deleted: false,
        has_attachments: !imported.attachments.is_empty(),
        size: imported.size,
        download_url: imported.download_url.clone(),
        created_at: imported.created_at,
        updated_at: imported.created_at,
        text_content: imported.text.clone(),
        html_parts: imported.html.clone(),
        attachments: imported.attachments.clone(),
    }
}

fn prepared_message_from_snapshot(message: &StoredMessage) -> PreparedMessageRecord {
    PreparedMessageRecord {
        id: message.id,
        source_key: message.source_key.clone(),
        msgid: message.msgid.clone(),
        from_address: message.from.clone(),
        to_addresses: message.to.clone(),
        subject: message.subject.clone(),
        intro: message.intro.clone(),
        seen: message.seen,
        is_deleted: message.is_deleted,
        has_attachments: message.has_attachments,
        size: message.size,
        download_url: message.download_url.clone(),
        created_at: message.created_at,
        updated_at: message.updated_at,
        text_content: message.text.clone(),
        html_parts: message.html.clone(),
        attachments: message.attachments.clone(),
    }
}

async fn insert_audit_log_tx(
    tx: &mut Transaction<'_, Postgres>,
    action: &str,
    entity_type: &str,
    entity_id: String,
    actor_id: Option<String>,
    detail: String,
) -> AppResult<()> {
    let entry = format_audit_entry(action, entity_type, entity_id, actor_id, detail);
    sqlx::query(
        r#"
        INSERT INTO audit_logs (entry, created_at)
        VALUES ($1, $2)
        "#,
    )
    .bind(entry)
    .bind(Utc::now())
    .execute(&mut **tx)
    .await
    .map_err(map_sqlx_error)?;

    Ok(())
}

async fn trim_audit_logs_tx(tx: &mut Transaction<'_, Postgres>) -> AppResult<()> {
    sqlx::query(
        r#"
        DELETE FROM audit_logs
        WHERE id NOT IN (
            SELECT id
            FROM audit_logs
            ORDER BY created_at DESC, id DESC
            LIMIT $1
        )
        "#,
    )
    .bind(MAX_AUDIT_LOGS)
    .execute(&mut **tx)
    .await
    .map_err(map_sqlx_error)?;

    Ok(())
}

fn format_audit_entry(
    action: &str,
    entity_type: &str,
    entity_id: String,
    actor_id: Option<String>,
    detail: String,
) -> String {
    let actor = actor_id.as_deref().unwrap_or("system");
    format!(
        "{} action={action} entity={entity_type}:{entity_id} actor={actor} detail={detail}",
        Utc::now().to_rfc3339(),
    )
}

fn parse_audit_log_timestamp(entry: &str) -> DateTime<Utc> {
    entry
        .split_whitespace()
        .next()
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&Utc))
        .unwrap_or_else(Utc::now)
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

fn ensure_account_active(account: &AccountRow) -> AppResult<()> {
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

fn map_sqlx_error(error: sqlx::Error) -> ApiError {
    ApiError::internal(error.to_string())
}

fn match_unique_violation(error: sqlx::Error, message: &'static str) -> ApiError {
    if let sqlx::Error::Database(database_error) = &error {
        if database_error.code().as_deref() == Some("23505") {
            return ApiError::validation(message);
        }
    }

    map_sqlx_error(error)
}

fn u64_to_i64(value: u64, field: &str) -> AppResult<i64> {
    i64::try_from(value).map_err(|_| ApiError::internal(format!("{field} overflowed i64")))
}

fn i64_to_u64(value: i64, field: &str) -> AppResult<u64> {
    u64::try_from(value).map_err(|_| ApiError::internal(format!("{field} was negative")))
}

fn i64_to_usize(value: i64, field: &str) -> AppResult<usize> {
    usize::try_from(value).map_err(|_| ApiError::internal(format!("{field} was negative")))
}

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize)]
pub struct HydraCollection<T> {
    #[serde(rename = "hydra:member")]
    pub member: Vec<T>,
    #[serde(rename = "hydra:totalItems")]
    pub total_items: usize,
}

impl<T> HydraCollection<T> {
    pub fn new(member: Vec<T>, total_items: usize) -> Self {
        Self {
            member,
            total_items,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Domain {
    pub id: String,
    pub domain: String,
    pub is_verified: bool,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification_error: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DomainDnsRecord {
    pub kind: String,
    pub name: String,
    pub value: String,
    pub ttl: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub address: String,
    pub quota: u64,
    pub used: u64,
    pub is_disabled: bool,
    pub is_deleted: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageAddress {
    pub name: String,
    pub address: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageSummary {
    pub id: String,
    pub account_id: String,
    pub msgid: String,
    pub from: MessageAddress,
    pub to: Vec<MessageAddress>,
    pub subject: String,
    pub intro: String,
    pub seen: bool,
    pub is_deleted: bool,
    pub has_attachments: bool,
    pub size: u64,
    pub download_url: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub filename: String,
    pub content_type: String,
    pub disposition: String,
    pub transfer_encoding: String,
    pub related: bool,
    pub size: u64,
    pub download_url: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageDetail {
    #[serde(flatten)]
    pub summary: MessageSummary,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub cc: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub bcc: Vec<String>,
    pub text: String,
    pub html: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<Attachment>,
}

#[derive(Clone, Debug, Serialize)]
pub struct TokenResponse {
    pub token: String,
    pub id: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct MessageSeenResponse {
    pub seen: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminStatusResponse {
    pub is_password_configured: bool,
    pub has_generated_api_key: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminSessionResponse {
    pub session_token: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminSetupResponse {
    pub session_token: String,
    pub api_key: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminAccessKeyResponse {
    pub api_key: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminAuditLogsResponse {
    pub entries: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupRunResponse {
    pub deleted_accounts: usize,
    pub deleted_messages: usize,
    pub deleted_domains: usize,
}

impl From<crate::store::CleanupReport> for CleanupRunResponse {
    fn from(value: crate::store::CleanupReport) -> Self {
        Self {
            deleted_accounts: value.deleted_accounts,
            deleted_messages: value.deleted_messages,
            deleted_domains: value.deleted_domains,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminMetricsResponse {
    pub total_domains: usize,
    pub active_domains: usize,
    pub pending_domains: usize,
    pub total_accounts: usize,
    pub active_accounts: usize,
    pub total_messages: usize,
    pub active_messages: usize,
    pub deleted_messages: usize,
    pub audit_logs_total: usize,
    pub inbucket_sync_runs_total: u64,
    pub inbucket_sync_failures_total: u64,
    pub imported_messages_total: u64,
    pub deleted_upstream_messages_total: u64,
    pub domain_verification_runs_total: u64,
    pub domain_verification_failures_total: u64,
    pub cleanup_runs_total: u64,
    pub cleanup_deleted_accounts_total: u64,
    pub cleanup_deleted_messages_total: u64,
    pub cleanup_deleted_domains_total: u64,
    pub realtime_events_total: u64,
    pub sse_connections_active: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_inbucket_sync_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_domain_verification_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_cleanup_at: Option<DateTime<Utc>>,
}

impl AdminMetricsResponse {
    pub fn from_parts(
        stats: crate::store::StoreStats,
        metrics: crate::metrics::MetricsSnapshot,
    ) -> Self {
        Self {
            total_domains: stats.total_domains,
            active_domains: stats.active_domains,
            pending_domains: stats.pending_domains,
            total_accounts: stats.total_accounts,
            active_accounts: stats.active_accounts,
            total_messages: stats.total_messages,
            active_messages: stats.active_messages,
            deleted_messages: stats.deleted_messages,
            audit_logs_total: stats.audit_logs_total,
            inbucket_sync_runs_total: metrics.inbucket_sync_runs_total,
            inbucket_sync_failures_total: metrics.inbucket_sync_failures_total,
            imported_messages_total: metrics.imported_messages_total,
            deleted_upstream_messages_total: metrics.deleted_upstream_messages_total,
            domain_verification_runs_total: metrics.domain_verification_runs_total,
            domain_verification_failures_total: metrics.domain_verification_failures_total,
            cleanup_runs_total: metrics.cleanup_runs_total,
            cleanup_deleted_accounts_total: metrics.cleanup_deleted_accounts_total,
            cleanup_deleted_messages_total: metrics.cleanup_deleted_messages_total,
            cleanup_deleted_domains_total: metrics.cleanup_deleted_domains_total,
            realtime_events_total: metrics.realtime_events_total,
            sse_connections_active: metrics.sse_connections_active,
            last_inbucket_sync_at: metrics.last_inbucket_sync_at,
            last_domain_verification_at: metrics.last_domain_verification_at,
            last_cleanup_at: metrics.last_cleanup_at,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAccountRequest {
    pub address: String,
    pub password: String,
    pub expires_in: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct TokenRequest {
    pub address: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateMessageRequest {
    pub seen: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct CreateDomainRequest {
    pub domain: String,
}

#[derive(Debug, Deserialize)]
pub struct AdminPasswordRequest {
    pub password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminPasswordChangeRequest {
    pub current_password: String,
    pub new_password: String,
}

#[derive(Clone, Debug)]
pub struct ImportedMessage {
    pub source_key: String,
    pub msgid: String,
    pub from: MessageAddress,
    pub to: Vec<MessageAddress>,
    pub subject: String,
    pub intro: String,
    pub size: u64,
    pub download_url: String,
    pub created_at: DateTime<Utc>,
    pub text: String,
    pub html: Vec<String>,
    pub attachments: Vec<Attachment>,
}

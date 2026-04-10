use chrono::{DateTime, Utc};
use serde::{Deserialize, Deserializer, Serialize};

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
    pub is_shared: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_user_id: Option<String>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_user_id: Option<String>,
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
    pub is_bootstrap_required: bool,
    pub users_total: usize,
    pub admin_users_total: usize,
    pub is_recovery_enabled: bool,
    pub system_enabled: bool,
    pub open_registration_enabled: bool,
    pub console_invite_code_required: bool,
    pub linux_do_enabled: bool,
    pub email_otp_enabled: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConsoleUserRole {
    Admin,
    User,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleUser {
    pub id: String,
    pub username: String,
    pub role: ConsoleUserRole,
    pub domain_limit: u32,
    pub is_disabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key_hint: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PublicNoticeTone {
    Info,
    Warning,
    Success,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicUpdateNoticeSection {
    pub tone: PublicNoticeTone,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub bullets: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalizedUpdateNoticeContent {
    pub title: String,
    pub date_label: String,
    pub dismiss_label: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sections: Vec<PublicUpdateNoticeSection>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub footer: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicUpdateNotice {
    pub enabled: bool,
    pub auto_open: bool,
    pub version: String,
    pub zh: LocalizedUpdateNoticeContent,
    pub en: LocalizedUpdateNoticeContent,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminEmailOtpSettings {
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    pub ttl_seconds: u32,
    pub cooldown_seconds: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinuxDoAuthSettings {
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_id: Option<String>,
    #[serde(default, skip_serializing)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_secret: Option<String>,
    #[serde(default)]
    pub client_secret_configured: bool,
    #[serde(default)]
    pub minimum_trust_level: u8,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub authorize_url: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_url: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub userinfo_url: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub callback_url: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminRegistrationSettings {
    pub open_registration_enabled: bool,
    #[serde(default)]
    pub console_invite_code_required: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub allowed_email_suffixes: Vec<String>,
    pub email_otp: AdminEmailOtpSettings,
    pub linux_do: LinuxDoAuthSettings,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminUserLimitsSettings {
    pub default_domain_limit: u32,
    pub mailbox_limit: u32,
    pub api_key_limit: u32,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SiteBrandingSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub logo_url: Option<String>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SmtpSecurity {
    Plain,
    Starttls,
    Tls,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminSmtpSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(default = "default_smtp_port")]
    pub port: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(default, skip_serializing)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(default)]
    pub password_configured: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_address: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_name: Option<String>,
    #[serde(
        default = "default_smtp_security",
        alias = "starttls",
        deserialize_with = "deserialize_smtp_security"
    )]
    pub security: SmtpSecurity,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleCloudflareSettings {
    pub enabled: bool,
    pub api_token_configured: bool,
    pub auto_sync_enabled: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminSystemSettings {
    pub system_enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mail_exchange_host: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mail_route_target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub domain_txt_prefix: Option<String>,
    #[serde(default)]
    pub branding: SiteBrandingSettings,
    pub smtp: AdminSmtpSettings,
    pub registration_settings: AdminRegistrationSettings,
    pub user_limits: AdminUserLimitsSettings,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub update_notice: Option<PublicUpdateNotice>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminSessionInfo {
    pub user: ConsoleUser,
    pub system_settings: AdminSystemSettings,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminSessionResponse {
    pub session_token: String,
    pub session: AdminSessionInfo,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminSetupResponse {
    pub session_token: String,
    pub api_key: String,
    pub session: AdminSessionInfo,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminAccessKey {
    pub id: String,
    pub name: String,
    pub masked_key: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminAccessKeyListResponse {
    pub keys: Vec<AdminAccessKey>,
    pub limit: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminAccessKeyInfoResponse {
    pub key: AdminAccessKey,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminAccessKeyResponse {
    pub key: AdminAccessKey,
    pub api_key: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminInviteCode {
    pub id: String,
    pub name: String,
    pub masked_code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_uses: Option<u32>,
    pub uses_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remaining_uses: Option<u32>,
    pub is_disabled: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_used_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminInviteCodeListResponse {
    pub codes: Vec<AdminInviteCode>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminInviteCodeResponse {
    pub code: AdminInviteCode,
    pub invite_code: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminCreateInviteCodeRequest {
    pub name: Option<String>,
    pub max_uses: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminUpdateInviteCodeRequest {
    pub is_disabled: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminCreateAccessKeyRequest {
    pub name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinuxDoAuthorizeRequest {
    pub redirect_uri: String,
    pub state: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinuxDoAuthorizeResponse {
    pub authorization_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinuxDoCompleteRequest {
    #[serde(default)]
    pub code: Option<String>,
    pub redirect_uri: String,
    #[serde(default)]
    pub invite_code: Option<String>,
    #[serde(default)]
    pub pending_token: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum LinuxDoCompleteResponse {
    Authenticated {
        session_token: String,
        session: AdminSessionInfo,
    },
    InviteCodeRequired {
        pending_token: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },
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

impl From<crate::app_store::CleanupReport> for CleanupRunResponse {
    fn from(value: crate::app_store::CleanupReport) -> Self {
        Self {
            deleted_accounts: value.deleted_accounts,
            deleted_messages: value.deleted_messages,
            deleted_domains: value.deleted_domains,
        }
    }
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatusSnapshot {
    pub cpu_usage_percent: f32,
    pub memory_used_bytes: u64,
    pub memory_total_bytes: u64,
    pub memory_usage_percent: f32,
    pub uptime_seconds: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminMetricsResponse {
    pub console_users_total: usize,
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
    pub runtime: RuntimeStatusSnapshot,
}

impl AdminMetricsResponse {
    pub fn from_parts(
        console_users_total: usize,
        stats: crate::app_store::StoreStats,
        metrics: crate::metrics::MetricsSnapshot,
        runtime: RuntimeStatusSnapshot,
    ) -> Self {
        Self {
            console_users_total,
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
            runtime,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAccountRequest {
    pub address: String,
    #[serde(default)]
    pub password: Option<String>,
    pub expires_in: Option<i64>,
    #[serde(default)]
    pub otp_code: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendEmailOtpRequest {
    pub email: String,
    #[serde(default)]
    pub invite_code: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendEmailOtpResponse {
    pub expires_in_seconds: u32,
    pub cooldown_seconds: u32,
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
#[serde(rename_all = "camelCase")]
pub struct UpdateDomainRequest {
    pub is_shared: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminBootstrapRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminLoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleRegisterRequest {
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    pub password: String,
    #[serde(default)]
    pub otp_code: Option<String>,
    #[serde(default)]
    pub invite_code: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminPasswordChangeRequest {
    pub current_password: String,
    pub new_password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminRecoveryRequest {
    pub recovery_token: String,
    pub username: Option<String>,
    pub new_password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminCreateUserRequest {
    pub username: String,
    pub password: String,
    pub role: ConsoleUserRole,
    pub domain_limit: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminUpdateUserRequest {
    pub username: Option<String>,
    pub role: Option<ConsoleUserRole>,
    pub domain_limit: Option<u32>,
    pub is_disabled: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminResetUserPasswordRequest {
    pub new_password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminUpdateSystemSettingsRequest {
    pub system_enabled: Option<bool>,
    pub mail_exchange_host: Option<String>,
    pub mail_route_target: Option<String>,
    pub domain_txt_prefix: Option<String>,
    pub branding: Option<SiteBrandingSettings>,
    pub smtp: Option<AdminSmtpSettings>,
    pub registration_settings: Option<AdminRegistrationSettings>,
    pub user_limits: Option<AdminUserLimitsSettings>,
    pub update_notice: Option<PublicUpdateNotice>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateConsoleCloudflareSettingsRequest {
    pub enabled: bool,
    #[serde(default)]
    pub api_token: Option<String>,
    #[serde(default = "default_true")]
    pub auto_sync_enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestConsoleCloudflareTokenRequest {
    #[serde(default)]
    pub api_token: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudflareDnsSyncResponse {
    pub zone_name: String,
    pub created_records: usize,
    pub updated_records: usize,
    pub unchanged_records: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub domain: Option<Domain>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudflareTokenValidationResponse {
    pub zone_count: usize,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub zones: Vec<String>,
}

fn default_true() -> bool {
    true
}

fn default_smtp_security() -> SmtpSecurity {
    SmtpSecurity::Starttls
}

fn default_smtp_port() -> u16 {
    default_smtp_port_for_security(default_smtp_security())
}

pub fn default_smtp_port_for_security(security: SmtpSecurity) -> u16 {
    match security {
        SmtpSecurity::Plain => 25,
        SmtpSecurity::Starttls => 587,
        SmtpSecurity::Tls => 465,
    }
}

fn deserialize_smtp_security<'de, D>(deserializer: D) -> Result<SmtpSecurity, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum RawSmtpSecurity {
        Security(SmtpSecurity),
        LegacyStarttls(bool),
    }

    Ok(
        match Option::<RawSmtpSecurity>::deserialize(deserializer)? {
            Some(RawSmtpSecurity::Security(security)) => security,
            Some(RawSmtpSecurity::LegacyStarttls(true)) => SmtpSecurity::Starttls,
            Some(RawSmtpSecurity::LegacyStarttls(false)) => SmtpSecurity::Plain,
            None => default_smtp_security(),
        },
    )
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

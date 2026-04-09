use std::{
    collections::{BTreeMap, BTreeSet},
    net::IpAddr,
    thread,
};

use anyhow::Context;
use chrono::{DateTime, Utc};
use rand_core::{OsRng, RngCore};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use sqlx::{Connection, PgConnection, PgPool, postgres::PgPoolOptions, types::Json};
use uuid::Uuid;

use crate::{
    auth,
    config::Config,
    error::{ApiError, AppResult},
    models::{
        AdminAccessKey, AdminEmailOtpSettings, AdminInviteCode, AdminRegistrationSettings,
        AdminSmtpSettings, AdminSystemSettings, AdminUserLimitsSettings,
        ConsoleCloudflareSettings, ConsoleUser, ConsoleUserRole, LinuxDoAuthSettings,
        LocalizedUpdateNoticeContent, PublicNoticeTone, PublicUpdateNotice,
        PublicUpdateNoticeSection, SmtpSecurity,
        default_smtp_port_for_security,
    },
    state::AppState,
};

const MIN_USERNAME_LENGTH: usize = 3;
const MAX_USERNAME_LENGTH: usize = 32;
const MAX_EMAIL_IDENTITY_LENGTH: usize = 128;
const ADMIN_API_KEY_PREFIX: &str = "tmpmail_admin_";
const INVITE_CODE_PREFIX: &str = "tmpmail_inv_";
const LINUX_DO_DEFAULT_AUTHORIZE_URL: &str = "https://connect.linux.do/oauth2/authorize";
const LINUX_DO_DEFAULT_TOKEN_URL: &str = "https://connect.linux.do/oauth2/token";
const LINUX_DO_DEFAULT_USERINFO_URL: &str = "https://connect.linux.do/api/user";

#[derive(Clone, Debug)]
pub struct AuthenticatedConsoleUser {
    pub id: Uuid,
    pub username: String,
    pub role: ConsoleUserRole,
    pub domain_limit: u32,
}

impl AuthenticatedConsoleUser {
    pub fn is_admin(&self) -> bool {
        matches!(self.role, ConsoleUserRole::Admin)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedSystemSettings {
    #[serde(default = "default_true")]
    system_enabled: bool,
    #[serde(default)]
    mail_exchange_host: Option<String>,
    #[serde(default)]
    mail_route_target: Option<String>,
    #[serde(default)]
    domain_txt_prefix: Option<String>,
    #[serde(default)]
    smtp: PersistedSmtpSettings,
    #[serde(default = "default_registration_settings")]
    registration_settings: AdminRegistrationSettings,
    #[serde(default = "default_user_limits_settings")]
    user_limits: AdminUserLimitsSettings,
    #[serde(default = "default_public_update_notice")]
    update_notice: Option<PublicUpdateNotice>,
}

impl Default for PersistedSystemSettings {
    fn default() -> Self {
        Self {
            system_enabled: true,
            mail_exchange_host: None,
            mail_route_target: None,
            domain_txt_prefix: None,
            smtp: PersistedSmtpSettings::default(),
            registration_settings: default_registration_settings(),
            user_limits: default_user_limits_settings(),
            update_notice: default_public_update_notice(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PersistedSmtpSettings {
    #[serde(default)]
    host: Option<String>,
    #[serde(default)]
    port: Option<u16>,
    #[serde(default)]
    username: Option<String>,
    #[serde(default, skip_serializing)]
    password: Option<String>,
    #[serde(default)]
    from_address: Option<String>,
    #[serde(default)]
    from_name: Option<String>,
    #[serde(default)]
    security: Option<SmtpSecurity>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    starttls: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedConsoleAccessKey {
    id: Uuid,
    name: String,
    key_hash: String,
    key_hint: String,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedInviteCode {
    id: Uuid,
    name: String,
    code_hash: String,
    code_hint: String,
    #[serde(default)]
    max_uses: Option<u32>,
    #[serde(default)]
    uses_count: u32,
    #[serde(default)]
    is_disabled: bool,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    #[serde(default)]
    last_used_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedCloudflareSettings {
    #[serde(default)]
    enabled: bool,
    #[serde(default, skip_serializing)]
    api_token: Option<String>,
    #[serde(default = "default_cloudflare_auto_sync_enabled")]
    auto_sync_enabled: bool,
}

impl Default for PersistedCloudflareSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            api_token: None,
            auto_sync_enabled: default_cloudflare_auto_sync_enabled(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedConsoleUser {
    id: Uuid,
    username: String,
    role: ConsoleUserRole,
    password_hash: String,
    #[serde(default)]
    domain_limit: u32,
    #[serde(default)]
    is_disabled: bool,
    #[serde(default)]
    api_keys: Vec<PersistedConsoleAccessKey>,
    #[serde(default, skip_serializing)]
    api_key_hash: Option<String>,
    #[serde(default, skip_serializing)]
    api_key_hint: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    password_updated_at: DateTime<Utc>,
    #[serde(default, skip_serializing)]
    api_key_updated_at: Option<DateTime<Utc>>,
    #[serde(default)]
    last_login_at: Option<DateTime<Utc>>,
    #[serde(default)]
    linux_do_user_id: Option<String>,
    #[serde(default)]
    linux_do_username: Option<String>,
    #[serde(default)]
    linux_do_trust_level: Option<u8>,
    #[serde(default)]
    cloudflare: PersistedCloudflareSettings,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedAdminState {
    #[serde(default)]
    users: Vec<PersistedConsoleUser>,
    #[serde(default)]
    invite_codes: Vec<PersistedInviteCode>,
    #[serde(default)]
    system_settings: PersistedSystemSettings,
    #[serde(default)]
    password_hash: Option<String>,
    #[serde(default)]
    api_key: Option<String>,
    #[serde(default)]
    api_key_hash: Option<String>,
    #[serde(default)]
    api_key_hint: Option<String>,
    #[serde(default)]
    created_at: Option<DateTime<Utc>>,
    #[serde(default)]
    updated_at: Option<DateTime<Utc>>,
    #[serde(default)]
    password_updated_at: Option<DateTime<Utc>>,
    #[serde(default)]
    api_key_updated_at: Option<DateTime<Utc>>,
}

impl PersistedAdminState {
    fn cloudflare_tokens_map(&self) -> BTreeMap<String, String> {
        self.users
            .iter()
            .filter_map(|user| {
                user.cloudflare
                    .api_token
                    .as_ref()
                    .map(|token| (user.id.to_string(), token.clone()))
            })
            .collect()
    }

    fn apply_cloudflare_tokens(&mut self, tokens: &BTreeMap<String, String>) {
        for user in &mut self.users {
            user.cloudflare.api_token = tokens.get(&user.id.to_string()).cloned();
        }
    }

    fn linux_do_client_secret(&self) -> Option<String> {
        self.system_settings
            .registration_settings
            .linux_do
            .client_secret
            .clone()
    }

    fn apply_linux_do_client_secret(&mut self, client_secret: Option<String>) {
        self.system_settings
            .registration_settings
            .linux_do
            .client_secret = client_secret;
    }

    fn smtp_password(&self) -> Option<String> {
        self.system_settings.smtp.password.clone()
    }

    fn apply_smtp_password(&mut self, smtp_password: Option<String>) {
        self.system_settings.smtp.password = smtp_password;
    }
}

#[derive(Debug, sqlx::FromRow)]
struct AdminStateRow {
    state: Json<PersistedAdminState>,
    cloudflare_tokens: Json<BTreeMap<String, String>>,
    linux_do_client_secret: Option<String>,
    smtp_password: Option<String>,
}

fn redact_sensitive_admin_state_for_serialization(
    persisted: &PersistedAdminState,
) -> PersistedAdminState {
    let mut serialized = persisted.clone();
    for user in &mut serialized.users {
        user.cloudflare.api_token = None;
    }
    serialized
        .system_settings
        .registration_settings
        .linux_do
        .client_secret = None;
    serialized.system_settings.smtp.password = None;

    serialized
}

#[derive(Clone, Debug)]
struct PgAdminStateBackend {
    database_url: String,
    pool: PgPool,
}

#[derive(Clone, Debug)]
pub struct AdminStateStore {
    backend: PgAdminStateBackend,
    persisted: PersistedAdminState,
}

impl AdminStateStore {
    pub async fn load(config: &Config) -> anyhow::Result<Self> {
        let mut store = Self::load_from_postgres(config.required_database_url()?).await?;
        store.migrate_legacy_single_admin_if_needed()?;

        Ok(store)
    }

    async fn load_from_postgres(database_url: &str) -> anyhow::Result<Self> {
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(database_url)
            .await
            .with_context(|| "failed to connect postgres admin state backend")?;
        let backend = PgAdminStateBackend {
            database_url: database_url.to_owned(),
            pool,
        };
        let persisted = backend.load_state().await?;

        Ok(Self { backend, persisted })
    }

    pub fn is_bootstrap_required(&self) -> bool {
        self.persisted.users.is_empty()
    }

    pub fn users_total(&self) -> usize {
        self.persisted.users.len()
    }

    pub fn admin_users_total(&self) -> usize {
        self.persisted
            .users
            .iter()
            .filter(|user| matches!(user.role, ConsoleUserRole::Admin))
            .count()
    }

    pub fn is_system_enabled(&self) -> bool {
        self.persisted.system_settings.system_enabled
    }

    pub fn system_settings(&self) -> AdminSystemSettings {
        let registration_settings = self.registration_settings();

        AdminSystemSettings {
            system_enabled: self.persisted.system_settings.system_enabled,
            mail_exchange_host: self.persisted.system_settings.mail_exchange_host.clone(),
            mail_route_target: self.persisted.system_settings.mail_route_target.clone(),
            domain_txt_prefix: self.persisted.system_settings.domain_txt_prefix.clone(),
            smtp: self.persisted.system_settings.smtp.to_public(),
            registration_settings,
            user_limits: self.persisted.system_settings.user_limits.clone(),
            update_notice: self.persisted.system_settings.update_notice.clone(),
        }
    }

    pub fn effective_system_settings(&self, config: &Config) -> AdminSystemSettings {
        let mut settings = self.system_settings();

        settings.mail_exchange_host = config.configured_mail_exchange_host();
        settings.mail_route_target = config.effective_mail_route_target().and_then(|value| {
            normalize_optional_hostname_or_ip_setting_lossy(Some(value.as_str()))
        });
        settings.domain_txt_prefix =
            normalize_txt_prefix_setting(Some(config.domain_txt_prefix.as_str()));
        settings.smtp = smtp_settings_from_config(config);

        settings
    }

    pub fn registration_settings(&self) -> AdminRegistrationSettings {
        let mut settings = self.persisted.system_settings.registration_settings.clone();
        settings.linux_do.client_secret_configured = settings
            .linux_do
            .client_secret
            .as_deref()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false);
        settings
    }

    pub fn is_public_registration_enabled(&self) -> bool {
        self.persisted
            .system_settings
            .registration_settings
            .open_registration_enabled
    }

    pub fn is_console_invite_code_required(&self) -> bool {
        self.persisted
            .system_settings
            .registration_settings
            .console_invite_code_required
    }

    pub fn default_public_domain_limit(&self) -> u32 {
        self.persisted
            .system_settings
            .user_limits
            .default_domain_limit
    }

    pub fn mailbox_limit(&self) -> u32 {
        self.persisted.system_settings.user_limits.mailbox_limit
    }

    pub fn api_key_limit(&self) -> u32 {
        self.persisted.system_settings.user_limits.api_key_limit
    }

    pub fn is_domain_allowed_for_public_registration(&self, domain: &str) -> bool {
        domain_matches_public_registration_rules(
            &self.persisted.system_settings.registration_settings,
            domain,
        )
    }

    pub fn apply_runtime_overrides(&self, config: &mut Config) {
        if let Some(value) = normalize_optional_hostname_setting_lossy(
            self.persisted.system_settings.mail_exchange_host.as_deref(),
        ) {
            config.mail_exchange_host = value;
        }

        if let Some(value) = normalize_optional_hostname_or_ip_setting_lossy(
            self.persisted.system_settings.mail_route_target.as_deref(),
        ) {
            config.mail_cname_target = value;
        }

        if let Some(value) = normalize_txt_prefix_setting(
            self.persisted.system_settings.domain_txt_prefix.as_deref(),
        ) {
            config.domain_txt_prefix = value.to_owned();
        }

        if let Some(value) = normalize_optional_hostname_or_ip_setting_lossy(
            self.persisted.system_settings.smtp.host.as_deref(),
        ) {
            config.smtp_host = Some(value);
        }
        if let Some(value) = self.persisted.system_settings.smtp.port {
            config.smtp_port = value.clamp(1, u16::MAX);
        }
        if let Some(value) =
            normalize_optional_copy(self.persisted.system_settings.smtp.username.clone())
        {
            config.smtp_username = Some(value);
        }
        if let Some(value) =
            normalize_optional_copy(self.persisted.system_settings.smtp.password.clone())
        {
            config.smtp_password = Some(value);
        }
        if let Some(value) =
            normalize_optional_copy(self.persisted.system_settings.smtp.from_address.clone())
        {
            config.smtp_from_address = Some(value);
        }
        if let Some(value) =
            normalize_optional_copy(self.persisted.system_settings.smtp.from_name.clone())
        {
            config.smtp_from_name = Some(value);
        }
        config.smtp_security = self.persisted.system_settings.smtp.security();
    }

    pub fn bootstrap_first_admin(
        &mut self,
        username: &str,
        password: &str,
    ) -> AppResult<(ConsoleUser, String)> {
        if !self.is_bootstrap_required() {
            return Err(ApiError::forbidden("console users are already configured"));
        }

        let normalized_username = normalize_username(username)?;
        validate_password(password)?;
        let now = Utc::now();
        let api_key = generate_admin_api_key();
        let user = PersistedConsoleUser {
            id: Uuid::new_v4(),
            username: normalized_username,
            role: ConsoleUserRole::Admin,
            password_hash: auth::hash_password(password)?,
            domain_limit: u32::MAX,
            is_disabled: false,
            api_keys: vec![PersistedConsoleAccessKey {
                id: Uuid::new_v4(),
                name: "Default Key".to_owned(),
                key_hash: auth::hash_password(&api_key)?,
                key_hint: mask_api_key(&api_key),
                created_at: now,
            }],
            api_key_hash: None,
            api_key_hint: None,
            created_at: now,
            updated_at: now,
            password_updated_at: now,
            api_key_updated_at: None,
            last_login_at: None,
            linux_do_user_id: None,
            linux_do_username: None,
            linux_do_trust_level: None,
            cloudflare: PersistedCloudflareSettings::default(),
        };

        self.persisted.users.push(user.clone());
        self.persisted.updated_at = Some(now);
        self.save()?;

        Ok((user.to_public(), api_key))
    }

    pub fn bootstrap_default_admin_from_env(&mut self, password: &str) -> AppResult<()> {
        validate_password(password)?;

        if !self.is_bootstrap_required() {
            return Ok(());
        }

        let _ = self.bootstrap_first_admin("admin", password)?;
        Ok(())
    }

    pub fn force_sync_default_admin_from_env(&mut self, password: &str) -> AppResult<()> {
        validate_password(password)?;

        if let Some(admin_index) = self
            .persisted
            .users
            .iter()
            .position(|user| user.username == "admin")
        {
            let should_update = {
                let user = &self.persisted.users[admin_index];
                !auth::verify_password(password, &user.password_hash)?
            };
            if !should_update {
                return Ok(());
            }

            let now = Utc::now();
            let user = &mut self.persisted.users[admin_index];
            user.password_hash = auth::hash_password(password)?;
            user.role = ConsoleUserRole::Admin;
            user.is_disabled = false;
            user.domain_limit = u32::MAX;
            user.updated_at = now;
            user.password_updated_at = now;
            self.persisted.updated_at = Some(now);
            return self.save();
        }

        self.bootstrap_default_admin_from_env(password)
    }

    pub fn sync_linux_do_client_secret_from_env(
        &mut self,
        client_secret: Option<&str>,
    ) -> AppResult<()> {
        let Some(value) = client_secret
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            return Ok(());
        };

        let current = self
            .persisted
            .system_settings
            .registration_settings
            .linux_do
            .client_secret
            .as_deref()
            .map(str::trim)
            .filter(|secret| !secret.is_empty());

        if current == Some(value) {
            return Ok(());
        }

        let now = Utc::now();
        self.persisted
            .system_settings
            .registration_settings
            .linux_do
            .client_secret = Some(value.to_owned());
        self.persisted
            .system_settings
            .registration_settings
            .linux_do
            .client_secret_configured = true;
        self.persisted.updated_at = Some(now);
        self.save()
    }

    pub fn authenticate(
        &mut self,
        username: &str,
        password: &str,
    ) -> AppResult<AuthenticatedConsoleUser> {
        let normalized_username = normalize_username(username)?;
        let now = Utc::now();
        let user = self
            .persisted
            .users
            .iter_mut()
            .find(|user| user.username == normalized_username)
            .ok_or_else(|| ApiError::unauthorized("invalid console username or password"))?;

        if user.is_disabled {
            return Err(ApiError::forbidden("console user is disabled"));
        }

        if !auth::verify_password(password, &user.password_hash)? {
            return Err(ApiError::unauthorized(
                "invalid console username or password",
            ));
        }

        user.last_login_at = Some(now);
        user.updated_at = now;
        let authenticated = user.to_authenticated();
        self.persisted.updated_at = Some(now);
        self.save()?;

        Ok(authenticated)
    }

    pub fn current_user(&self, user_id: Uuid) -> AppResult<ConsoleUser> {
        self.find_user(user_id)
            .map(PersistedConsoleUser::to_public)
            .ok_or_else(|| ApiError::unauthorized("console user not found"))
    }

    pub fn current_session_version(&self, user_id: Uuid) -> AppResult<i64> {
        self.find_user(user_id)
            .map(PersistedConsoleUser::session_version)
            .ok_or_else(|| ApiError::unauthorized("console user not found"))
    }

    pub fn list_users(&self) -> Vec<ConsoleUser> {
        let mut users = self
            .persisted
            .users
            .iter()
            .map(PersistedConsoleUser::to_public)
            .collect::<Vec<_>>();
        users.sort_by(|left, right| left.username.cmp(&right.username));
        users
    }

    pub fn list_invite_codes(&self) -> Vec<AdminInviteCode> {
        let mut codes = self
            .persisted
            .invite_codes
            .iter()
            .map(PersistedInviteCode::to_public)
            .collect::<Vec<_>>();
        codes.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        codes
    }

    pub fn create_invite_code(
        &mut self,
        name: Option<&str>,
        max_uses: Option<u32>,
    ) -> AppResult<(AdminInviteCode, String)> {
        let now = Utc::now();
        let invite_code = generate_invite_code();
        let persisted = PersistedInviteCode {
            id: Uuid::new_v4(),
            name: normalize_invite_code_name(name, self.persisted.invite_codes.len() + 1),
            code_hash: auth::hash_password(&invite_code)?,
            code_hint: mask_invite_code(&invite_code),
            max_uses: normalize_invite_code_max_uses(max_uses)?,
            uses_count: 0,
            is_disabled: false,
            created_at: now,
            updated_at: now,
            last_used_at: None,
        };
        let public = persisted.to_public();
        self.persisted.invite_codes.push(persisted);
        self.persisted.updated_at = Some(now);
        self.save()?;

        Ok((public, invite_code))
    }

    pub fn update_invite_code(
        &mut self,
        invite_code_id: Uuid,
        is_disabled: Option<bool>,
    ) -> AppResult<AdminInviteCode> {
        let now = Utc::now();
        let invite_code = self
            .persisted
            .invite_codes
            .iter_mut()
            .find(|candidate| candidate.id == invite_code_id)
            .ok_or_else(|| ApiError::not_found("invite code not found"))?;

        if let Some(value) = is_disabled {
            invite_code.is_disabled = value;
        }
        invite_code.updated_at = now;
        let public = invite_code.to_public();
        self.persisted.updated_at = Some(now);
        self.save()?;

        Ok(public)
    }

    pub fn delete_invite_code(&mut self, invite_code_id: Uuid) -> AppResult<AdminInviteCode> {
        let now = Utc::now();
        let index = self
            .persisted
            .invite_codes
            .iter()
            .position(|candidate| candidate.id == invite_code_id)
            .ok_or_else(|| ApiError::not_found("invite code not found"))?;
        let removed = self.persisted.invite_codes.remove(index);
        self.persisted.updated_at = Some(now);
        self.save()?;

        Ok(removed.to_public())
    }

    pub fn validate_invite_code(&self, invite_code: &str) -> AppResult<()> {
        let index = self.find_invite_code_index(invite_code)?;
        ensure_invite_code_available(&self.persisted.invite_codes[index])
    }

    pub fn create_user(
        &mut self,
        username: &str,
        password: &str,
        role: ConsoleUserRole,
        domain_limit: u32,
    ) -> AppResult<ConsoleUser> {
        let normalized_username = normalize_username(username)?;
        self.create_user_with_normalized(normalized_username, password, role, domain_limit)
    }

    pub fn create_public_user(
        &mut self,
        username: &str,
        password: &str,
        domain_limit: u32,
        invite_code: Option<&str>,
    ) -> AppResult<ConsoleUser> {
        let normalized_username = normalize_username(username)?;
        self.ensure_public_registration_identifier_allowed(&normalized_username)?;
        validate_password(password)?;
        self.ensure_username_available(&normalized_username, None)?;

        let now = Utc::now();
        if self.is_console_invite_code_required() {
            self.consume_invite_code_without_saving(
                invite_code
                    .ok_or_else(|| ApiError::validation("invite code is required"))?,
                now,
            )?;
        }

        let user = self.build_console_user(
            normalized_username,
            ConsoleUserRole::User,
            auth::hash_password(password)?,
            domain_limit,
            now,
        );
        self.persist_new_user(user)
    }

    fn create_user_with_normalized(
        &mut self,
        normalized_username: String,
        password: &str,
        role: ConsoleUserRole,
        domain_limit: u32,
    ) -> AppResult<ConsoleUser> {
        validate_password(password)?;
        self.ensure_username_available(&normalized_username, None)?;

        let now = Utc::now();
        let user = self.build_console_user(
            normalized_username,
            role,
            auth::hash_password(password)?,
            domain_limit,
            now,
        );
        self.persist_new_user(user)
    }

    fn build_console_user(
        &self,
        username: String,
        role: ConsoleUserRole,
        password_hash: String,
        domain_limit: u32,
        now: DateTime<Utc>,
    ) -> PersistedConsoleUser {
        PersistedConsoleUser {
            id: Uuid::new_v4(),
            username,
            role,
            password_hash,
            domain_limit,
            is_disabled: false,
            api_keys: Vec::new(),
            api_key_hash: None,
            api_key_hint: None,
            created_at: now,
            updated_at: now,
            password_updated_at: now,
            api_key_updated_at: None,
            last_login_at: None,
            linux_do_user_id: None,
            linux_do_username: None,
            linux_do_trust_level: None,
            cloudflare: PersistedCloudflareSettings::default(),
        }
    }

    fn persist_new_user(&mut self, user: PersistedConsoleUser) -> AppResult<ConsoleUser> {
        let public = user.to_public();
        self.persisted.users.push(user);
        self.persisted.updated_at = Some(Utc::now());
        self.save()?;

        Ok(public)
    }

    fn find_invite_code_index(&self, invite_code: &str) -> AppResult<usize> {
        let normalized_invite_code = normalize_invite_code(invite_code)?;
        self.persisted
            .invite_codes
            .iter()
            .position(|candidate| {
                auth::verify_password(&normalized_invite_code, &candidate.code_hash).unwrap_or(false)
            })
            .ok_or_else(|| ApiError::validation("invite code is invalid"))
    }

    fn consume_invite_code_without_saving(
        &mut self,
        invite_code: &str,
        now: DateTime<Utc>,
    ) -> AppResult<()> {
        let index = self.find_invite_code_index(invite_code)?;
        let persisted = self
            .persisted
            .invite_codes
            .get_mut(index)
            .ok_or_else(|| ApiError::validation("invite code is invalid"))?;
        ensure_invite_code_available(persisted)?;
        persisted.uses_count = persisted.uses_count.saturating_add(1);
        persisted.last_used_at = Some(now);
        persisted.updated_at = now;
        Ok(())
    }

    pub fn update_user(
        &mut self,
        user_id: Uuid,
        username: Option<&str>,
        role: Option<ConsoleUserRole>,
        domain_limit: Option<u32>,
        is_disabled: Option<bool>,
    ) -> AppResult<ConsoleUser> {
        let next_username = username.map(normalize_username).transpose()?;
        if let Some(value) = next_username.as_deref() {
            self.ensure_username_available(value, Some(user_id))?;
        }

        let admin_users_total = self.admin_users_total();
        let user = self
            .persisted
            .users
            .iter_mut()
            .find(|user| user.id == user_id)
            .ok_or_else(|| ApiError::not_found("console user not found"))?;

        let next_role = role.unwrap_or_else(|| user.role.clone());
        let next_is_disabled = is_disabled.unwrap_or(user.is_disabled);
        if matches!(user.role, ConsoleUserRole::Admin)
            && admin_users_total <= 1
            && (!matches!(next_role, ConsoleUserRole::Admin) || next_is_disabled)
        {
            return Err(ApiError::validation(
                "the last administrator cannot be disabled",
            ));
        }

        let now = Utc::now();
        if let Some(value) = next_username {
            user.username = value;
        }
        user.role = next_role;
        if let Some(value) = domain_limit {
            user.domain_limit = value;
        }
        user.is_disabled = next_is_disabled;
        user.updated_at = now;
        let public = user.to_public();
        self.persisted.updated_at = Some(now);
        self.save()?;

        Ok(public)
    }

    pub fn authenticate_linux_do(
        &mut self,
        linux_do_user_id: &str,
        linux_do_username: &str,
        trust_level: u8,
        invite_code: Option<&str>,
    ) -> AppResult<AuthenticatedConsoleUser> {
        let normalized_user_id = normalize_linux_do_user_id(linux_do_user_id)?;
        let trimmed_linux_do_username = linux_do_username.trim();
        let now = Utc::now();

        if let Some(user) = self.persisted.users.iter_mut().find(|candidate| {
            candidate.linux_do_user_id.as_deref() == Some(normalized_user_id.as_str())
        }) {
            if user.is_disabled {
                return Err(ApiError::forbidden("console user is disabled"));
            }

            user.linux_do_username =
                normalize_optional_copy(Some(trimmed_linux_do_username.to_owned()));
            user.linux_do_trust_level = Some(trust_level);
            user.last_login_at = Some(now);
            user.updated_at = now;
            let authenticated = user.to_authenticated();
            self.persisted.updated_at = Some(now);
            self.save()?;
            return Ok(authenticated);
        }

        let username =
            self.allocate_linux_do_username(trimmed_linux_do_username, &normalized_user_id)?;
        if self.is_console_invite_code_required() {
            self.consume_invite_code_without_saving(
                invite_code
                    .ok_or_else(|| ApiError::validation("invite code is required"))?,
                now,
            )?;
        }
        let password_hash = auth::hash_password(&generate_linux_do_placeholder_password())?;
        let mut user = self.build_console_user(
            username,
            ConsoleUserRole::User,
            password_hash,
            self.default_public_domain_limit(),
            now,
        );
        user.last_login_at = Some(now);
        user.linux_do_user_id = Some(normalized_user_id);
        user.linux_do_username = normalize_optional_copy(Some(trimmed_linux_do_username.to_owned()));
        user.linux_do_trust_level = Some(trust_level);
        let authenticated = user.to_authenticated();
        self.persisted.users.push(user);
        self.persisted.updated_at = Some(now);
        self.save()?;

        Ok(authenticated)
    }

    pub fn delete_user(&mut self, user_id: Uuid) -> AppResult<()> {
        let user = self
            .find_user(user_id)
            .cloned()
            .ok_or_else(|| ApiError::not_found("console user not found"))?;
        if matches!(user.role, ConsoleUserRole::Admin) && self.admin_users_total() <= 1 {
            return Err(ApiError::validation(
                "the last administrator cannot be deleted",
            ));
        }

        self.persisted
            .users
            .retain(|candidate| candidate.id != user_id);
        self.persisted.updated_at = Some(Utc::now());
        self.save()
    }

    pub fn change_password(
        &mut self,
        user_id: Uuid,
        current_password: &str,
        new_password: &str,
    ) -> AppResult<()> {
        validate_password(new_password)?;
        let now = Utc::now();
        let user = self
            .persisted
            .users
            .iter_mut()
            .find(|user| user.id == user_id)
            .ok_or_else(|| ApiError::not_found("console user not found"))?;

        if !auth::verify_password(current_password, &user.password_hash)? {
            return Err(ApiError::unauthorized("invalid console password"));
        }

        user.password_hash = auth::hash_password(new_password)?;
        user.updated_at = now;
        user.password_updated_at = now;
        self.persisted.updated_at = Some(now);
        self.save()
    }

    pub fn reset_user_password(&mut self, user_id: Uuid, new_password: &str) -> AppResult<()> {
        validate_password(new_password)?;
        let now = Utc::now();
        let user = self
            .persisted
            .users
            .iter_mut()
            .find(|user| user.id == user_id)
            .ok_or_else(|| ApiError::not_found("console user not found"))?;
        user.password_hash = auth::hash_password(new_password)?;
        user.updated_at = now;
        user.password_updated_at = now;
        self.persisted.updated_at = Some(now);
        self.save()
    }

    pub fn reset_password_with_recovery(
        &mut self,
        username: &str,
        new_password: &str,
    ) -> AppResult<(ConsoleUser, String)> {
        let normalized_username = normalize_username(username)?;
        validate_password(new_password)?;
        let now = Utc::now();
        let user = self
            .persisted
            .users
            .iter_mut()
            .find(|user| user.username == normalized_username)
            .ok_or_else(|| ApiError::not_found("console user not found"))?;
        let api_key = generate_admin_api_key();

        user.password_hash = auth::hash_password(new_password)?;
        user.api_keys = vec![PersistedConsoleAccessKey {
            id: Uuid::new_v4(),
            name: "Recovery Key".to_owned(),
            key_hash: auth::hash_password(&api_key)?,
            key_hint: mask_api_key(&api_key),
            created_at: now,
        }];
        user.api_key_hash = None;
        user.api_key_hint = None;
        user.updated_at = now;
        user.password_updated_at = now;
        user.api_key_updated_at = None;
        user.is_disabled = false;
        let public = user.to_public();
        self.persisted.updated_at = Some(now);
        self.save()?;

        Ok((public, api_key))
    }

    pub fn list_api_keys(&self, user_id: Uuid) -> AppResult<Vec<AdminAccessKey>> {
        let user = self
            .find_user(user_id)
            .ok_or_else(|| ApiError::not_found("console user not found"))?;

        let mut keys = user
            .api_keys
            .iter()
            .map(PersistedConsoleAccessKey::to_public)
            .collect::<Vec<_>>();
        keys.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        Ok(keys)
    }

    pub fn latest_api_key(&self, user_id: Uuid) -> AppResult<Option<AdminAccessKey>> {
        Ok(self
            .list_api_keys(user_id)?
            .into_iter()
            .max_by(|left, right| left.created_at.cmp(&right.created_at)))
    }

    pub fn create_api_key(
        &mut self,
        user_id: Uuid,
        name: Option<&str>,
    ) -> AppResult<(AdminAccessKey, String)> {
        let now = Utc::now();
        let api_key = generate_admin_api_key();
        let api_key_limit = self.api_key_limit() as usize;
        let user = self
            .persisted
            .users
            .iter_mut()
            .find(|user| user.id == user_id)
            .ok_or_else(|| ApiError::not_found("console user not found"))?;
        if user.api_keys.len() >= api_key_limit {
            return Err(ApiError::validation(
                "api key limit has been reached for this user",
            ));
        }

        let access_key = PersistedConsoleAccessKey {
            id: Uuid::new_v4(),
            name: normalize_api_key_name(name, user.api_keys.len() + 1),
            key_hash: auth::hash_password(&api_key)?,
            key_hint: mask_api_key(&api_key),
            created_at: now,
        };
        let public = access_key.to_public();
        user.api_keys.push(access_key);
        user.updated_at = now;
        self.persisted.updated_at = Some(now);
        self.save()?;

        Ok((public, api_key))
    }

    pub fn delete_api_key(&mut self, user_id: Uuid, key_id: Uuid) -> AppResult<AdminAccessKey> {
        let now = Utc::now();
        let user = self
            .persisted
            .users
            .iter_mut()
            .find(|user| user.id == user_id)
            .ok_or_else(|| ApiError::not_found("console user not found"))?;
        let key_index = user
            .api_keys
            .iter()
            .position(|key| key.id == key_id)
            .ok_or_else(|| ApiError::not_found("access key not found"))?;
        let removed = user.api_keys.remove(key_index);
        user.updated_at = now;
        self.persisted.updated_at = Some(now);
        self.save()?;

        Ok(removed.to_public())
    }

    pub fn cloudflare_settings(&self, user_id: Uuid) -> AppResult<ConsoleCloudflareSettings> {
        let user = self
            .find_user(user_id)
            .ok_or_else(|| ApiError::not_found("console user not found"))?;

        Ok(user.cloudflare.to_public())
    }

    pub fn cloudflare_api_token(&self, user_id: Uuid) -> AppResult<Option<String>> {
        let user = self
            .find_user(user_id)
            .ok_or_else(|| ApiError::not_found("console user not found"))?;

        Ok(normalize_optional_copy(user.cloudflare.api_token.clone()))
    }

    pub fn update_cloudflare_settings(
        &mut self,
        user_id: Uuid,
        enabled: bool,
        api_token: Option<String>,
        auto_sync_enabled: bool,
    ) -> AppResult<ConsoleCloudflareSettings> {
        let now = Utc::now();
        let user = self
            .persisted
            .users
            .iter_mut()
            .find(|user| user.id == user_id)
            .ok_or_else(|| ApiError::not_found("console user not found"))?;

        if let Some(value) = api_token {
            user.cloudflare.api_token = normalize_optional_copy(Some(value));
        }

        user.cloudflare.enabled = enabled;
        user.cloudflare.auto_sync_enabled = auto_sync_enabled;
        user.updated_at = now;
        let public_settings = user.cloudflare.to_public();
        self.persisted.updated_at = Some(now);
        self.save()?;

        Ok(public_settings)
    }

    pub fn authenticate_api_key(&self, token: &str) -> Option<AuthenticatedConsoleUser> {
        self.persisted
            .users
            .iter()
            .find(|user| {
                !user.is_disabled
                    && user
                        .api_keys
                        .iter()
                        .any(|key| auth::verify_password(token, &key.key_hash).unwrap_or(false))
            })
            .map(PersistedConsoleUser::to_authenticated)
    }

    pub fn user_from_claims(
        &self,
        claims: &auth::ConsoleSessionClaims,
    ) -> AppResult<AuthenticatedConsoleUser> {
        let user_id =
            Uuid::parse_str(&claims.sub).map_err(|_| ApiError::unauthorized("invalid session"))?;
        let user = self
            .find_user(user_id)
            .ok_or_else(|| ApiError::unauthorized("console user not found"))?;
        if user.is_disabled {
            return Err(ApiError::forbidden("console user is disabled"));
        }
        if claims.session_version != user.session_version() {
            return Err(ApiError::unauthorized("invalid console session"));
        }

        Ok(user.to_authenticated())
    }

    pub fn update_system_settings(
        &mut self,
        system_enabled: Option<bool>,
        mail_exchange_host: Option<&str>,
        mail_route_target: Option<&str>,
        domain_txt_prefix: Option<&str>,
        smtp: Option<AdminSmtpSettings>,
        registration_settings: Option<AdminRegistrationSettings>,
        user_limits: Option<AdminUserLimitsSettings>,
        update_notice: Option<PublicUpdateNotice>,
    ) -> AppResult<AdminSystemSettings> {
        let now = Utc::now();
        if let Some(value) = system_enabled {
            self.persisted.system_settings.system_enabled = value;
        }
        if let Some(value) = mail_exchange_host {
            self.persisted.system_settings.mail_exchange_host =
                normalize_optional_hostname_setting(Some(value))?;
        }
        if let Some(value) = mail_route_target {
            self.persisted.system_settings.mail_route_target =
                normalize_optional_hostname_or_ip_setting(Some(value))?;
        }
        if let Some(value) = domain_txt_prefix {
            self.persisted.system_settings.domain_txt_prefix =
                normalize_txt_prefix_setting(Some(value));
        }
        if let Some(value) = smtp {
            self.persisted.system_settings.smtp =
                normalize_smtp_settings(value, Some(&self.persisted.system_settings.smtp))?;
        }
        if let Some(value) = registration_settings {
            self.persisted.system_settings.registration_settings = normalize_registration_settings(
                value,
                Some(&self.persisted.system_settings.registration_settings),
            )?;
        }
        if let Some(value) = user_limits {
            self.persisted.system_settings.user_limits = normalize_user_limits_settings(value)?;
        }
        if let Some(value) = update_notice {
            self.persisted.system_settings.update_notice = Some(normalize_update_notice(value)?);
        }
        self.persisted.updated_at = Some(now);
        self.save()?;

        Ok(self.system_settings())
    }

    fn save(&self) -> AppResult<()> {
        self.backend.save_state_blocking(&self.persisted)?;
        Ok(())
    }

    fn ensure_username_available(
        &self,
        username: &str,
        exclude_user_id: Option<Uuid>,
    ) -> AppResult<()> {
        if self.persisted.users.iter().any(|user| {
            user.username == username && exclude_user_id.map(|id| id != user.id).unwrap_or(true)
        }) {
            return Err(ApiError::validation("console account already exists"));
        }

        Ok(())
    }

    fn ensure_public_registration_identifier_allowed(&self, identifier: &str) -> AppResult<()> {
        let Some((_, domain)) = identifier.rsplit_once('@') else {
            return Ok(());
        };
        let allowed_suffixes = &self
            .persisted
            .system_settings
            .registration_settings
            .allowed_email_suffixes;

        if allowed_suffixes.is_empty() {
            return Ok(());
        }

        if allowed_suffixes.iter().any(|suffix| {
            domain == suffix
                || domain
                    .strip_suffix(suffix)
                    .is_some_and(|prefix| prefix.ends_with('.'))
        }) {
            return Ok(());
        }

        Err(ApiError::validation(
            "registration email suffix is not allowed",
        ))
    }

    fn allocate_linux_do_username(
        &self,
        preferred_username: &str,
        linux_do_user_id: &str,
    ) -> AppResult<String> {
        let mut candidates = Vec::new();

        if let Ok(normalized_preferred) = normalize_username(preferred_username) {
            candidates.push(normalized_preferred.clone());
            candidates.push(build_linux_do_username_candidate(
                &normalized_preferred,
                linux_do_user_id,
            ));
        }

        candidates.push(build_linux_do_username_candidate(
            "linuxdo",
            linux_do_user_id,
        ));

        for candidate in candidates {
            if self
                .persisted
                .users
                .iter()
                .all(|user| user.username != candidate)
            {
                return Ok(candidate);
            }
        }

        Err(ApiError::validation(
            "unable to allocate a linux.do username for this account",
        ))
    }

    fn find_user(&self, user_id: Uuid) -> Option<&PersistedConsoleUser> {
        self.persisted.users.iter().find(|user| user.id == user_id)
    }

    fn migrate_legacy_single_admin_if_needed(&mut self) -> AppResult<()> {
        let mut changed = false;
        for user in &mut self.persisted.users {
            if user.api_keys.is_empty()
                && let Some(access_key) = build_legacy_access_key(
                    user.api_key_hash.take(),
                    None,
                    user.api_key_hint.take(),
                    user.api_key_updated_at.unwrap_or(user.updated_at),
                    "Migrated Key",
                )?
            {
                user.api_keys.push(access_key);
                changed = true;
            }

            if user.api_key_hash.take().is_some() {
                changed = true;
            }
            if user.api_key_hint.take().is_some() {
                changed = true;
            }
            if user.api_key_updated_at.take().is_some() {
                changed = true;
            }
        }

        if !self.persisted.users.is_empty() {
            if self.persisted.api_key.take().is_some() {
                changed = true;
            }
            if self.persisted.api_key_hash.take().is_some() {
                changed = true;
            }
            if self.persisted.api_key_hint.take().is_some() {
                changed = true;
            }
            if self.persisted.api_key_updated_at.take().is_some() {
                changed = true;
            }
            self.persisted.api_key = None;
            if changed {
                self.save()?;
            }
            return Ok(());
        }

        let Some(password_hash) = self.persisted.password_hash.clone() else {
            if self.persisted.api_key.take().is_some() {
                changed = true;
            }
            if self.persisted.api_key_hash.take().is_some() {
                changed = true;
            }
            if self.persisted.api_key_hint.take().is_some() {
                changed = true;
            }
            if self.persisted.api_key_updated_at.take().is_some() {
                changed = true;
            }
            if changed {
                self.save()?;
            }
            return Ok(());
        };
        let now = self.persisted.updated_at.unwrap_or_else(Utc::now);
        let api_keys = build_legacy_access_key(
            self.persisted.api_key_hash.clone(),
            self.persisted.api_key.clone(),
            self.persisted.api_key_hint.clone(),
            self.persisted.api_key_updated_at.unwrap_or(now),
            "Migrated Key",
        )?
        .into_iter()
        .collect::<Vec<_>>();

        self.persisted.users.push(PersistedConsoleUser {
            id: Uuid::new_v4(),
            username: "admin".to_owned(),
            role: ConsoleUserRole::Admin,
            password_hash,
            domain_limit: u32::MAX,
            is_disabled: false,
            api_keys,
            api_key_hash: None,
            api_key_hint: None,
            created_at: self.persisted.created_at.unwrap_or(now),
            updated_at: now,
            password_updated_at: self.persisted.password_updated_at.unwrap_or(now),
            api_key_updated_at: None,
            last_login_at: None,
            linux_do_user_id: None,
            linux_do_username: None,
            linux_do_trust_level: None,
            cloudflare: PersistedCloudflareSettings::default(),
        });
        self.persisted.password_hash = None;
        self.persisted.api_key = None;
        self.persisted.api_key_hash = None;
        self.persisted.api_key_hint = None;
        self.save()
    }
}

impl PgAdminStateBackend {
    async fn load_state(&self) -> anyhow::Result<PersistedAdminState> {
        let row = sqlx::query_as::<_, AdminStateRow>(
            r#"
            SELECT state, cloudflare_tokens, linux_do_client_secret, smtp_password
            FROM admin_state_store
            WHERE id = TRUE
            "#,
        )
        .fetch_optional(&self.pool)
        .await
        .with_context(|| "failed to load admin state from postgres")?;

        if let Some(row) = row {
            let mut persisted = row.state.0;
            persisted.apply_cloudflare_tokens(&row.cloudflare_tokens.0);
            persisted.apply_linux_do_client_secret(row.linux_do_client_secret);
            persisted.apply_smtp_password(row.smtp_password);
            return Ok(persisted);
        }

        Ok(PersistedAdminState {
            system_settings: PersistedSystemSettings::default(),
            ..PersistedAdminState::default()
        })
    }

    fn save_state_blocking(&self, persisted: &PersistedAdminState) -> AppResult<()> {
        let persisted = persisted.clone();
        let database_url = self.database_url.clone();

        thread::spawn(move || {
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .map_err(|error| {
                    ApiError::internal(format!("failed to build admin state runtime: {error}"))
                })?
                .block_on(async move {
                    let serialized = redact_sensitive_admin_state_for_serialization(&persisted);
                    let cloudflare_tokens = persisted.cloudflare_tokens_map();
                    let linux_do_client_secret = persisted.linux_do_client_secret();
                    let smtp_password = persisted.smtp_password();
                    let mut connection =
                        PgConnection::connect(&database_url).await.map_err(|error| {
                            ApiError::internal(format!(
                                "failed to connect admin state writer: {error}"
                            ))
                        })?;

                    sqlx::query(
                        r#"
                        INSERT INTO admin_state_store (id, state, cloudflare_tokens, linux_do_client_secret, smtp_password, updated_at)
                        VALUES (TRUE, $1, $2, $3, $4, NOW())
                        ON CONFLICT (id)
                        DO UPDATE SET state = EXCLUDED.state, cloudflare_tokens = EXCLUDED.cloudflare_tokens, linux_do_client_secret = EXCLUDED.linux_do_client_secret, smtp_password = EXCLUDED.smtp_password, updated_at = NOW()
                        "#,
                    )
                    .bind(Json(&serialized))
                    .bind(Json(&cloudflare_tokens))
                    .bind(linux_do_client_secret)
                    .bind(smtp_password)
                    .execute(&mut connection)
                    .await
                    .map_err(|error| {
                        ApiError::internal(format!("failed to persist admin state: {error}"))
                    })?;

                    connection.close().await.ok();
                    Ok(())
                })
        })
        .join()
        .map_err(|_| ApiError::internal("admin state persistence thread panicked"))?
    }
}

pub async fn optional_console_user(
    headers: &axum::http::HeaderMap,
    state: &AppState,
) -> Option<AuthenticatedConsoleUser> {
    if auth::require_secure_admin_transport(headers, &state.config).is_err() {
        return None;
    }

    let token = auth::optional_bearer_token(headers)?;
    if let Ok(claims) = auth::decode_console_session_token(&token, &state.config) {
        let admin_state = state.admin_state.read().await;
        return admin_state.user_from_claims(&claims).ok();
    }

    let admin_state = state.admin_state.read().await;
    admin_state.authenticate_api_key(&token)
}

pub async fn require_console_session_user(
    headers: &axum::http::HeaderMap,
    state: &AppState,
) -> AppResult<AuthenticatedConsoleUser> {
    auth::require_secure_admin_transport(headers, &state.config)?;
    let token = auth::bearer_token(headers)?;
    let claims = auth::decode_console_session_token(&token, &state.config)?;
    let admin_state = state.admin_state.read().await;
    admin_state.user_from_claims(&claims)
}

pub async fn require_console_access(
    headers: &axum::http::HeaderMap,
    state: &AppState,
) -> AppResult<AuthenticatedConsoleUser> {
    optional_console_user(headers, state)
        .await
        .ok_or_else(|| ApiError::unauthorized("invalid console credentials"))
}

pub async fn require_admin_access(
    headers: &axum::http::HeaderMap,
    state: &AppState,
) -> AppResult<AuthenticatedConsoleUser> {
    let user = require_console_access(headers, state).await?;
    if !user.is_admin() {
        return Err(ApiError::forbidden("administrator privileges required"));
    }

    Ok(user)
}

fn domain_matches_public_registration_rules(
    registration_settings: &AdminRegistrationSettings,
    domain: &str,
) -> bool {
    let normalized_domain = normalize_hostname_like(domain);
    if registration_settings.public_domains.is_empty()
        && registration_settings.allowed_email_suffixes.is_empty()
    {
        return true;
    }

    registration_settings
        .public_domains
        .iter()
        .any(|public_domain| normalized_domain == *public_domain)
        || registration_settings
            .allowed_email_suffixes
            .iter()
            .any(|suffix| {
                normalized_domain == *suffix || normalized_domain.ends_with(&format!(".{suffix}"))
            })
}

fn default_true() -> bool {
    true
}

fn default_cloudflare_auto_sync_enabled() -> bool {
    true
}

fn default_registration_settings() -> AdminRegistrationSettings {
    AdminRegistrationSettings {
        open_registration_enabled: true,
        console_invite_code_required: false,
        public_domains: Vec::new(),
        allowed_email_suffixes: Vec::new(),
        email_otp: default_email_otp_settings(),
        linux_do: default_linux_do_auth_settings(),
    }
}

fn default_user_limits_settings() -> AdminUserLimitsSettings {
    AdminUserLimitsSettings {
        default_domain_limit: 3,
        mailbox_limit: 5,
        api_key_limit: 5,
    }
}

fn default_email_otp_settings() -> AdminEmailOtpSettings {
    AdminEmailOtpSettings {
        enabled: false,
        subject: None,
        body: None,
        ttl_seconds: 600,
        cooldown_seconds: 60,
    }
}

pub(crate) fn default_email_otp_subject() -> String {
    "TmpMail verification code".to_owned()
}

pub(crate) fn default_email_otp_body() -> String {
    "Your TmpMail verification code is {{code}}. It expires in {{ttlSeconds}} seconds.".to_owned()
}

fn default_smtp_settings() -> AdminSmtpSettings {
    AdminSmtpSettings {
        host: None,
        port: default_smtp_port_for_security(SmtpSecurity::Starttls),
        username: None,
        password: None,
        password_configured: false,
        from_address: None,
        from_name: None,
        security: SmtpSecurity::Starttls,
    }
}

fn smtp_settings_from_config(config: &Config) -> AdminSmtpSettings {
    let mut settings = default_smtp_settings();
    settings.host = config.smtp_host.clone();
    settings.port = config.smtp_port;
    settings.username = config.smtp_username.clone();
    settings.password_configured = config
        .smtp_password
        .as_deref()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    settings.from_address = config.smtp_from_address.clone();
    settings.from_name = config.smtp_from_name.clone();
    settings.security = config.smtp_security;
    settings
}

fn default_linux_do_auth_settings() -> LinuxDoAuthSettings {
    LinuxDoAuthSettings {
        enabled: false,
        client_id: None,
        client_secret: None,
        client_secret_configured: false,
        minimum_trust_level: 0,
        authorize_url: Some(LINUX_DO_DEFAULT_AUTHORIZE_URL.to_owned()),
        token_url: Some(LINUX_DO_DEFAULT_TOKEN_URL.to_owned()),
        userinfo_url: Some(LINUX_DO_DEFAULT_USERINFO_URL.to_owned()),
        callback_url: None,
    }
}

fn default_public_update_notice() -> Option<PublicUpdateNotice> {
    Some(PublicUpdateNotice {
        enabled: true,
        auto_open: true,
        version: "2026-01-16-storage-upgrade".to_owned(),
        zh: LocalizedUpdateNoticeContent {
            title: "系统更新通知".to_owned(),
            date_label: "2026年1月16日".to_owned(),
            dismiss_label: "我知道了".to_owned(),
            sections: vec![
                PublicUpdateNoticeSection {
                    tone: PublicNoticeTone::Info,
                    title: "存储系统升级".to_owned(),
                    body: Some("由于之前系统的存储方式存在部分问题，影响了 API 性能，因此在 2026 年 1 月 16 日进行了后端的存储方式重构，采取更加高效化的存储方式。".to_owned()),
                    bullets: Vec::new(),
                },
                PublicUpdateNoticeSection {
                    tone: PublicNoticeTone::Warning,
                    title: "账户数据说明".to_owned(),
                    body: Some("由于存储方式的兼容性问题，之前的账户信息并没有迁移保留。如果您需要使用原账户，请使用相同的用户名再次创建一次即可，不影响后续的正常接码使用。".to_owned()),
                    bullets: Vec::new(),
                },
                PublicUpdateNoticeSection {
                    tone: PublicNoticeTone::Success,
                    title: "如何恢复原账户".to_owned(),
                    body: None,
                    bullets: vec![
                        "使用与之前相同的用户名创建新账户".to_owned(),
                        "设置一个新密码（可以与之前相同或不同）".to_owned(),
                        "原邮箱地址的邮件将继续正常接收".to_owned(),
                    ],
                },
            ],
            footer: Some(
                "对于此次更新带来的不便，我们深表歉意。感谢您继续测试 TmpMail。"
                    .to_owned(),
            ),
        },
        en: LocalizedUpdateNoticeContent {
            title: "System Update Notice".to_owned(),
            date_label: "January 16, 2026".to_owned(),
            dismiss_label: "I Understand".to_owned(),
            sections: vec![
                PublicUpdateNoticeSection {
                    tone: PublicNoticeTone::Info,
                    title: "Storage System Upgrade".to_owned(),
                    body: Some("Due to issues with the previous storage method affecting API performance, we restructured backend storage on January 16, 2026 and adopted a more efficient storage approach.".to_owned()),
                    bullets: Vec::new(),
                },
                PublicUpdateNoticeSection {
                    tone: PublicNoticeTone::Warning,
                    title: "Account Data Notice".to_owned(),
                    body: Some("Because of storage compatibility issues, previous account data was not migrated. If you need your original account, create it again with the same username and it will continue to receive mail normally.".to_owned()),
                    bullets: Vec::new(),
                },
                PublicUpdateNoticeSection {
                    tone: PublicNoticeTone::Success,
                    title: "How to Recover Your Account".to_owned(),
                    body: None,
                    bullets: vec![
                        "Create a new account with the same username as before".to_owned(),
                        "Set a new password, either the same as before or a different one"
                            .to_owned(),
                        "Mail sent to the original address will continue to arrive normally"
                            .to_owned(),
                    ],
                },
            ],
            footer: Some(
                "We apologize for any inconvenience caused by this update. Thank you for continuing to test TmpMail.".to_owned(),
            ),
        },
    })
}

fn normalize_update_notice(value: PublicUpdateNotice) -> AppResult<PublicUpdateNotice> {
    let version = value.version.trim().to_owned();
    if version.is_empty() {
        return Err(ApiError::validation(
            "update notice version cannot be empty",
        ));
    }

    Ok(PublicUpdateNotice {
        enabled: value.enabled,
        auto_open: value.auto_open,
        version,
        zh: normalize_update_notice_content(value.zh, "zh")?,
        en: normalize_update_notice_content(value.en, "en")?,
    })
}

fn normalize_update_notice_content(
    value: LocalizedUpdateNoticeContent,
    locale: &str,
) -> AppResult<LocalizedUpdateNoticeContent> {
    let title = value.title.trim().to_owned();
    let date_label = value.date_label.trim().to_owned();
    let dismiss_label = value.dismiss_label.trim().to_owned();
    let sections = value
        .sections
        .into_iter()
        .map(|section| normalize_update_notice_section(section, locale))
        .collect::<AppResult<Vec<_>>>()?;
    let footer = normalize_optional_copy(value.footer);

    if title.is_empty() {
        return Err(ApiError::validation(format!(
            "update notice title for locale {locale} cannot be empty"
        )));
    }
    if date_label.is_empty() {
        return Err(ApiError::validation(format!(
            "update notice dateLabel for locale {locale} cannot be empty"
        )));
    }
    if dismiss_label.is_empty() {
        return Err(ApiError::validation(format!(
            "update notice dismissLabel for locale {locale} cannot be empty"
        )));
    }
    if sections.is_empty() {
        return Err(ApiError::validation(format!(
            "update notice sections for locale {locale} cannot be empty"
        )));
    }

    Ok(LocalizedUpdateNoticeContent {
        title,
        date_label,
        dismiss_label,
        sections,
        footer,
    })
}

fn normalize_update_notice_section(
    value: PublicUpdateNoticeSection,
    locale: &str,
) -> AppResult<PublicUpdateNoticeSection> {
    let title = value.title.trim().to_owned();
    let body = normalize_optional_copy(value.body);
    let bullets = value
        .bullets
        .into_iter()
        .map(|bullet| bullet.trim().to_owned())
        .filter(|bullet| !bullet.is_empty())
        .collect::<Vec<_>>();

    if title.is_empty() {
        return Err(ApiError::validation(format!(
            "update notice section title for locale {locale} cannot be empty"
        )));
    }
    if body.is_none() && bullets.is_empty() {
        return Err(ApiError::validation(format!(
            "update notice section content for locale {locale} cannot be empty"
        )));
    }

    Ok(PublicUpdateNoticeSection {
        tone: value.tone,
        title,
        body,
        bullets,
    })
}

fn normalize_optional_copy(value: Option<String>) -> Option<String> {
    value
        .map(|text| text.trim().to_owned())
        .filter(|text| !text.is_empty())
}

fn normalize_registration_settings(
    value: AdminRegistrationSettings,
    existing: Option<&AdminRegistrationSettings>,
) -> AppResult<AdminRegistrationSettings> {
    let public_domains = value
        .public_domains
        .into_iter()
        .filter_map(normalize_public_domain_setting)
        .collect::<AppResult<BTreeSet<_>>>()?
        .into_iter()
        .collect::<Vec<_>>();
    let allowed_email_suffixes = value
        .allowed_email_suffixes
        .into_iter()
        .filter_map(normalize_email_suffix_setting)
        .collect::<AppResult<BTreeSet<_>>>()?
        .into_iter()
        .collect::<Vec<_>>();

    let email_otp_enabled = value.email_otp.enabled;
    let email_otp = AdminEmailOtpSettings {
        enabled: email_otp_enabled,
        subject: normalize_optional_copy(value.email_otp.subject)
            .or_else(|| email_otp_enabled.then(default_email_otp_subject)),
        body: normalize_optional_copy(value.email_otp.body)
            .or_else(|| email_otp_enabled.then(default_email_otp_body)),
        ttl_seconds: value.email_otp.ttl_seconds.clamp(60, 3_600),
        cooldown_seconds: value.email_otp.cooldown_seconds.clamp(0, 3_600),
    };

    let linux_do = LinuxDoAuthSettings {
        enabled: value.linux_do.enabled,
        client_id: normalize_optional_copy(value.linux_do.client_id),
        client_secret: normalize_optional_copy(value.linux_do.client_secret)
            .or_else(|| existing.and_then(|settings| settings.linux_do.client_secret.clone())),
        client_secret_configured: false,
        minimum_trust_level: value.linux_do.minimum_trust_level.min(4),
        authorize_url: normalize_optional_linux_do_endpoint_url(
            value.linux_do.authorize_url.as_deref(),
        )?
        .or_else(|| existing.and_then(|settings| settings.linux_do.authorize_url.clone()))
        .or_else(|| Some(LINUX_DO_DEFAULT_AUTHORIZE_URL.to_owned())),
        token_url: normalize_optional_linux_do_endpoint_url(value.linux_do.token_url.as_deref())?
            .or_else(|| existing.and_then(|settings| settings.linux_do.token_url.clone()))
            .or_else(|| Some(LINUX_DO_DEFAULT_TOKEN_URL.to_owned())),
        userinfo_url: normalize_optional_linux_do_endpoint_url(
            value.linux_do.userinfo_url.as_deref(),
        )?
        .or_else(|| existing.and_then(|settings| settings.linux_do.userinfo_url.clone()))
        .or_else(|| Some(LINUX_DO_DEFAULT_USERINFO_URL.to_owned())),
        callback_url: normalize_optional_linux_do_callback_url(
            value.linux_do.callback_url.as_deref(),
        )?
        .or_else(|| existing.and_then(|settings| settings.linux_do.callback_url.clone())),
    };

    let mut linux_do = linux_do;
    linux_do.client_secret_configured = linux_do
        .client_secret
        .as_deref()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);

    if linux_do.enabled
        && (linux_do.client_id.is_none()
            || linux_do.client_secret.is_none()
            || linux_do.authorize_url.is_none()
            || linux_do.token_url.is_none()
            || linux_do.userinfo_url.is_none())
    {
        return Err(ApiError::validation(
            "linux.do auth requires client id, client secret, authorize url, token url, and userinfo url",
        ));
    }

    Ok(AdminRegistrationSettings {
        open_registration_enabled: value.open_registration_enabled,
        console_invite_code_required: value.console_invite_code_required,
        public_domains,
        allowed_email_suffixes,
        email_otp,
        linux_do,
    })
}

fn normalize_smtp_settings(
    value: AdminSmtpSettings,
    existing: Option<&PersistedSmtpSettings>,
) -> AppResult<PersistedSmtpSettings> {
    let security = value.security;
    Ok(PersistedSmtpSettings {
        host: normalize_optional_hostname_or_ip_setting(value.host.as_deref())?,
        port: Some(value.port.clamp(1, u16::MAX)),
        username: normalize_optional_copy(value.username),
        password: normalize_optional_copy(value.password).or_else(|| {
            value
                .password_configured
                .then(|| existing.and_then(|settings| settings.password.clone()))
                .flatten()
        }),
        from_address: normalize_optional_copy(value.from_address),
        from_name: normalize_optional_copy(value.from_name),
        security: Some(security),
        starttls: Some(matches!(security, SmtpSecurity::Starttls)),
    })
}

fn normalize_user_limits_settings(
    value: AdminUserLimitsSettings,
) -> AppResult<AdminUserLimitsSettings> {
    Ok(AdminUserLimitsSettings {
        default_domain_limit: value.default_domain_limit.min(500),
        mailbox_limit: value.mailbox_limit.min(200),
        api_key_limit: value.api_key_limit.min(50),
    })
}

fn validate_password(password: &str) -> AppResult<()> {
    auth::validate_password(password, "console password")
}

fn normalize_linux_do_user_id(value: &str) -> AppResult<String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(ApiError::validation("linux.do user id is required"));
    }

    Ok(normalized.to_owned())
}

fn normalize_username(username: &str) -> AppResult<String> {
    let normalized = username.trim().to_ascii_lowercase();
    if normalized.contains('@') {
        return normalize_console_email_identifier(&normalized);
    }

    normalize_console_username_identifier(&normalized)
}

fn normalize_console_username_identifier(normalized: &str) -> AppResult<String> {
    if normalized.chars().count() < MIN_USERNAME_LENGTH {
        return Err(ApiError::validation(format!(
            "console username must be at least {MIN_USERNAME_LENGTH} characters"
        )));
    }
    if normalized.chars().count() > MAX_USERNAME_LENGTH {
        return Err(ApiError::validation(format!(
            "console username must be at most {MAX_USERNAME_LENGTH} characters"
        )));
    }
    if normalized.starts_with('.') || normalized.ends_with('.') || normalized.contains("..") {
        return Err(ApiError::validation("console username format is invalid"));
    }
    if normalized
        .chars()
        .any(|ch| !(ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-')))
    {
        return Err(ApiError::validation("console username format is invalid"));
    }

    Ok(normalized.to_owned())
}

fn normalize_console_email_identifier(normalized: &str) -> AppResult<String> {
    if normalized.chars().count() < MIN_USERNAME_LENGTH {
        return Err(ApiError::validation(format!(
            "console email must be at least {MIN_USERNAME_LENGTH} characters"
        )));
    }
    if normalized.chars().count() > MAX_EMAIL_IDENTITY_LENGTH {
        return Err(ApiError::validation(format!(
            "console email must be at most {MAX_EMAIL_IDENTITY_LENGTH} characters"
        )));
    }

    let mut parts = normalized.split('@');
    let local = parts
        .next()
        .ok_or_else(|| ApiError::validation("console email format is invalid"))?;
    let domain = parts
        .next()
        .ok_or_else(|| ApiError::validation("console email format is invalid"))?;
    if parts.next().is_some() || local.is_empty() || domain.is_empty() {
        return Err(ApiError::validation("console email format is invalid"));
    }
    if local.starts_with('.') || local.ends_with('.') || local.contains("..") {
        return Err(ApiError::validation("console email format is invalid"));
    }
    if local
        .chars()
        .any(|ch| !(ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-' | '+')))
    {
        return Err(ApiError::validation("console email format is invalid"));
    }

    let normalized_domain = normalize_optional_hostname_setting(Some(domain))?
        .ok_or_else(|| ApiError::validation("console email format is invalid"))?;

    Ok(format!("{local}@{normalized_domain}"))
}

fn build_linux_do_username_candidate(prefix: &str, linux_do_user_id: &str) -> String {
    let sanitized_prefix = prefix
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
        .collect::<String>()
        .trim_matches('-')
        .trim_matches('_')
        .trim_matches('.')
        .to_ascii_lowercase();
    let prefix = if sanitized_prefix.len() >= MIN_USERNAME_LENGTH {
        sanitized_prefix
    } else {
        "linuxdo".to_owned()
    };
    let subject_suffix = linux_do_user_id
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase();
    let subject_suffix = if subject_suffix.is_empty() {
        "user".to_owned()
    } else {
        subject_suffix
    };
    let suffix = if subject_suffix.len() > 12 {
        subject_suffix[..12].to_owned()
    } else {
        subject_suffix
    };

    let available_prefix_len = MAX_USERNAME_LENGTH.saturating_sub(suffix.len() + 1);
    let trimmed_prefix = if prefix.len() > available_prefix_len {
        prefix[..available_prefix_len].to_owned()
    } else {
        prefix
    };

    format!("{trimmed_prefix}-{suffix}")
}

fn normalize_hostname_like(value: &str) -> String {
    value.trim().trim_end_matches('.').to_ascii_lowercase()
}

fn normalize_optional_hostname_setting(value: Option<&str>) -> AppResult<Option<String>> {
    let Some(normalized) = value.map(normalize_hostname_like) else {
        return Ok(None);
    };
    if normalized.is_empty() {
        return Ok(None);
    }
    if normalized.parse::<IpAddr>().is_ok() {
        return Err(ApiError::validation(
            "mail exchange host must be a hostname",
        ));
    }

    Ok(Some(normalized))
}

fn normalize_optional_hostname_or_ip_setting(value: Option<&str>) -> AppResult<Option<String>> {
    let Some(normalized) = value.map(normalize_hostname_like) else {
        return Ok(None);
    };
    if normalized.is_empty() {
        return Ok(None);
    }

    Ok(Some(normalized))
}

fn normalize_optional_hostname_setting_lossy(value: Option<&str>) -> Option<String> {
    normalize_optional_hostname_setting(value).ok().flatten()
}

fn normalize_optional_hostname_or_ip_setting_lossy(value: Option<&str>) -> Option<String> {
    normalize_optional_hostname_or_ip_setting(value)
        .ok()
        .flatten()
}

fn normalize_email_suffix_setting(value: String) -> Option<AppResult<String>> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    let normalized = trimmed
        .trim_start_matches('@')
        .trim_start_matches("*.")
        .trim()
        .to_owned();

    Some(
        normalize_optional_hostname_setting(Some(&normalized)).and_then(|value| {
            value.ok_or_else(|| ApiError::validation("registration email suffix cannot be empty"))
        }),
    )
}

fn normalize_public_domain_setting(value: String) -> Option<AppResult<String>> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    Some(
        normalize_optional_hostname_setting(Some(trimmed)).and_then(|value| {
            value.ok_or_else(|| ApiError::validation("public domain cannot be empty"))
        }),
    )
}

fn normalize_optional_linux_do_endpoint_url(value: Option<&str>) -> AppResult<Option<String>> {
    normalize_optional_linux_do_url(value, "endpoint", false)
}

fn normalize_optional_linux_do_callback_url(value: Option<&str>) -> AppResult<Option<String>> {
    normalize_optional_linux_do_url(value, "callback url", true)
}

fn normalize_optional_linux_do_url(
    value: Option<&str>,
    label: &str,
    require_clean_callback: bool,
) -> AppResult<Option<String>> {
    let Some(raw) = value.map(str::trim) else {
        return Ok(None);
    };
    if raw.is_empty() {
        return Ok(None);
    }

    let url = Url::parse(raw)
        .map_err(|_| ApiError::validation(format!("linux.do {label} must be a valid url")))?;

    if !url.username().is_empty() || url.password().is_some() {
        return Err(ApiError::validation(format!(
            "linux.do {label} must not include credentials"
        )));
    }

    if url.fragment().is_some() {
        return Err(ApiError::validation(format!(
            "linux.do {label} must not include a fragment"
        )));
    }

    match url.scheme() {
        "https" => {}
        "http" if is_local_url_host(&url) => {}
        "http" => {
            return Err(ApiError::validation(format!(
                "linux.do {label} must use https unless it targets localhost"
            )));
        }
        _ => {
            return Err(ApiError::validation(format!(
                "linux.do {label} must use http or https"
            )));
        }
    }

    if require_clean_callback && url.query().is_some() {
        return Err(ApiError::validation(format!(
            "linux.do {label} must not include a query string"
        )));
    }

    Ok(Some(url.to_string()))
}

fn is_local_url_host(url: &Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    let normalized = host.trim().trim_end_matches('.').to_ascii_lowercase();
    matches!(normalized.as_str(), "localhost" | "127.0.0.1" | "::1")
        || normalized.ends_with(".localhost")
}

fn normalize_txt_prefix_setting(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .map(|value| value.trim_matches('.').to_ascii_lowercase())
        .filter(|value| !value.is_empty() && value != "@")
}

fn normalize_api_key_name(value: Option<&str>, fallback_index: usize) -> String {
    let normalized = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(64).collect::<String>());

    normalized.unwrap_or_else(|| format!("Key {fallback_index}"))
}

fn normalize_invite_code_name(value: Option<&str>, fallback_index: usize) -> String {
    let normalized = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(64).collect::<String>());

    normalized.unwrap_or_else(|| format!("Invite {fallback_index}"))
}

fn normalize_invite_code_max_uses(value: Option<u32>) -> AppResult<Option<u32>> {
    match value {
        Some(0) => Err(ApiError::validation(
            "invite code max uses must be greater than zero",
        )),
        Some(value) => Ok(Some(value)),
        None => Ok(None),
    }
}

fn build_legacy_access_key(
    legacy_hash: Option<String>,
    legacy_plaintext: Option<String>,
    legacy_hint: Option<String>,
    created_at: DateTime<Utc>,
    default_name: &str,
) -> AppResult<Option<PersistedConsoleAccessKey>> {
    let key_hash = if let Some(hash) = legacy_hash.filter(|value| !value.trim().is_empty()) {
        hash
    } else if let Some(plaintext) = legacy_plaintext
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        auth::hash_password(&plaintext)?
    } else {
        return Ok(None);
    };

    let key_hint = legacy_hint
        .filter(|value| !value.trim().is_empty())
        .or_else(|| legacy_plaintext.as_deref().map(mask_api_key))
        .unwrap_or_else(|| "hidden".to_owned());

    Ok(Some(PersistedConsoleAccessKey {
        id: Uuid::new_v4(),
        name: default_name.to_owned(),
        key_hash,
        key_hint,
        created_at,
    }))
}

fn generate_admin_api_key() -> String {
    let mut bytes = [0_u8; 24];
    OsRng.fill_bytes(&mut bytes);
    format!("{ADMIN_API_KEY_PREFIX}{}", hex_encode(&bytes))
}

fn generate_invite_code() -> String {
    let mut bytes = [0_u8; 12];
    OsRng.fill_bytes(&mut bytes);
    format!("{INVITE_CODE_PREFIX}{}", hex_encode(&bytes))
}

fn generate_linux_do_placeholder_password() -> String {
    let mut bytes = [0_u8; 24];
    OsRng.fill_bytes(&mut bytes);
    bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push_str(&format!("{byte:02x}"));
    }
    output
}

fn mask_api_key(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() <= 8 {
        return "hidden".to_owned();
    }

    format!(
        "{}...{}",
        &trimmed[..6],
        &trimmed[trimmed.len().saturating_sub(4)..]
    )
}

fn normalize_invite_code(value: &str) -> AppResult<String> {
    let normalized = value.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return Err(ApiError::validation("invite code is required"));
    }

    Ok(normalized)
}

fn mask_invite_code(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() <= 8 {
        return "hidden".to_owned();
    }

    format!(
        "{}...{}",
        &trimmed[..8],
        &trimmed[trimmed.len().saturating_sub(4)..]
    )
}

fn ensure_invite_code_available(invite_code: &PersistedInviteCode) -> AppResult<()> {
    if invite_code.is_disabled {
        return Err(ApiError::validation("invite code is disabled"));
    }
    if let Some(max_uses) = invite_code.max_uses
        && invite_code.uses_count >= max_uses
    {
        return Err(ApiError::validation("invite code has been exhausted"));
    }

    Ok(())
}

impl PersistedConsoleAccessKey {
    fn to_public(&self) -> AdminAccessKey {
        AdminAccessKey {
            id: self.id.to_string(),
            name: self.name.clone(),
            masked_key: self.key_hint.clone(),
            created_at: self.created_at,
        }
    }
}

impl PersistedInviteCode {
    fn to_public(&self) -> AdminInviteCode {
        AdminInviteCode {
            id: self.id.to_string(),
            name: self.name.clone(),
            masked_code: self.code_hint.clone(),
            max_uses: self.max_uses,
            uses_count: self.uses_count,
            remaining_uses: self.max_uses.map(|max_uses| max_uses.saturating_sub(self.uses_count)),
            is_disabled: self.is_disabled,
            created_at: self.created_at,
            updated_at: self.updated_at,
            last_used_at: self.last_used_at,
        }
    }
}

impl PersistedCloudflareSettings {
    fn to_public(&self) -> ConsoleCloudflareSettings {
        ConsoleCloudflareSettings {
            enabled: self.enabled,
            api_token_configured: self
                .api_token
                .as_deref()
                .map(|value| !value.trim().is_empty())
                .unwrap_or(false),
            auto_sync_enabled: self.auto_sync_enabled,
        }
    }
}

impl PersistedSmtpSettings {
    fn security(&self) -> SmtpSecurity {
        self.security.unwrap_or_else(|| match self.starttls {
            Some(true) => SmtpSecurity::Starttls,
            Some(false) => SmtpSecurity::Plain,
            None => SmtpSecurity::Starttls,
        })
    }

    fn to_public(&self) -> AdminSmtpSettings {
        let mut settings = default_smtp_settings();
        settings.host = self.host.clone();
        settings.security = self.security();
        settings.port = self
            .port
            .unwrap_or_else(|| default_smtp_port_for_security(settings.security));
        settings.username = self.username.clone();
        settings.password_configured = self
            .password
            .as_deref()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false);
        settings.from_address = self.from_address.clone();
        settings.from_name = self.from_name.clone();
        settings
    }
}

impl PersistedConsoleUser {
    fn session_version(&self) -> i64 {
        self.password_updated_at.timestamp_millis()
    }

    fn to_public(&self) -> ConsoleUser {
        ConsoleUser {
            id: self.id.to_string(),
            username: self.username.clone(),
            role: self.role.clone(),
            domain_limit: self.domain_limit,
            is_disabled: self.is_disabled,
            api_key_hint: self
                .api_keys
                .iter()
                .max_by_key(|key| key.created_at)
                .map(|key| key.key_hint.clone()),
            created_at: self.created_at,
            updated_at: self.updated_at,
        }
    }

    fn to_authenticated(&self) -> AuthenticatedConsoleUser {
        AuthenticatedConsoleUser {
            id: self.id,
            username: self.username.clone(),
            role: self.role.clone(),
            domain_limit: self.domain_limit,
        }
    }
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use serde_json::Value;
    use sqlx::{Connection, PgConnection, Row};
    use tokio::runtime::Builder;
    use uuid::Uuid;

    use super::{
        AdminStateStore, PersistedInviteCode, default_registration_settings,
        domain_matches_public_registration_rules, ensure_invite_code_available,
        normalize_invite_code_max_uses,
    };
    use crate::{
        config::Config,
        models::{AdminRegistrationSettings, AdminSmtpSettings, SmtpSecurity},
        test_support::{TestDatabase, attach_test_database},
    };

    fn load_store(label: &str) -> (AdminStateStore, TestDatabase) {
        Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("build runtime")
            .block_on(async {
                let (config, database) = attach_test_database(Config::default(), label).await;
                let store = AdminStateStore::load(&config).await.expect("load state");
                (store, database)
            })
    }

    fn stored_admin_state_json(database: &TestDatabase) -> String {
        Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("build runtime")
            .block_on(async {
                let mut connection = PgConnection::connect(database.url())
                    .await
                    .expect("connect admin state database");
                let row = sqlx::query("SELECT state FROM admin_state_store WHERE id = TRUE")
                    .fetch_one(&mut connection)
                    .await
                    .expect("load stored admin state");
                let state: Value = row.try_get("state").expect("decode stored state");
                serde_json::to_string(&state).expect("serialize stored state")
            })
    }

    fn stored_smtp_password(database: &TestDatabase) -> Option<String> {
        Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("build runtime")
            .block_on(async {
                let mut connection = PgConnection::connect(database.url())
                    .await
                    .expect("connect admin state database");
                let row =
                    sqlx::query("SELECT smtp_password FROM admin_state_store WHERE id = TRUE")
                        .fetch_one(&mut connection)
                        .await
                        .expect("load smtp password");
                row.try_get("smtp_password").expect("decode smtp password")
            })
    }

    #[test]
    fn bootstrap_admin_stores_generated_key_hashed_only() {
        let (mut store, database) = load_store("admin-state");

        let (_, api_key) = store
            .bootstrap_first_admin("admin", "AdminPass123!")
            .expect("bootstrap admin");
        let raw = stored_admin_state_json(&database);

        assert!(!raw.contains(&api_key));
        assert!(store.authenticate_api_key(&api_key).is_some());
    }

    #[test]
    fn recovery_reset_rotates_password_and_key() {
        let (mut store, _database) = load_store("recover-admin-state");
        let (_, old_api_key) = store
            .bootstrap_first_admin("admin", "AdminPass123!")
            .expect("bootstrap admin");

        let (_, new_api_key) = store
            .reset_password_with_recovery("admin", "NewAdminPass123!")
            .expect("reset password");

        assert!(store.authenticate_api_key(&new_api_key).is_some());
        assert!(store.authenticate_api_key(&old_api_key).is_none());
    }

    #[test]
    fn default_state_exposes_public_update_notice() {
        let (store, _database) = load_store("default-update-notice");
        let settings = store.system_settings();
        let notice = settings
            .update_notice
            .expect("default update notice should be present");

        assert!(notice.enabled);
        assert!(notice.auto_open);
        assert_eq!(notice.version, "2026-01-16-storage-upgrade");
        assert_eq!(notice.zh.title, "系统更新通知");
        assert_eq!(notice.en.title, "System Update Notice");
    }

    #[test]
    fn smtp_password_is_redacted_from_state_json_and_restored_separately() {
        let (mut store, database) = load_store("smtp-settings");
        let smtp_password = "smtp-secret-123";

        store
            .update_system_settings(
                None,
                None,
                None,
                None,
                Some(AdminSmtpSettings {
                    host: Some("smtp.example.com".to_owned()),
                    port: 587,
                    username: Some("mailer".to_owned()),
                    password: Some(smtp_password.to_owned()),
                    password_configured: false,
                    from_address: Some("no-reply@example.com".to_owned()),
                    from_name: Some("TmpMail".to_owned()),
                    security: SmtpSecurity::Starttls,
                }),
                None,
                None,
                None,
            )
            .expect("save smtp settings");

        let raw = stored_admin_state_json(&database);
        assert!(!raw.contains(smtp_password));
        assert_eq!(
            stored_smtp_password(&database).as_deref(),
            Some(smtp_password)
        );

        let mut config = Config::default();
        config.database_url = database.url().to_owned();
        let reloaded = Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("build runtime")
            .block_on(async { AdminStateStore::load(&config).await.expect("reload state") });
        reloaded.apply_runtime_overrides(&mut config);

        assert_eq!(config.smtp_host.as_deref(), Some("smtp.example.com"));
        assert_eq!(config.smtp_password.as_deref(), Some(smtp_password));
        assert_eq!(
            reloaded
                .effective_system_settings(&config)
                .smtp
                .password_configured,
            true
        );
    }

    #[test]
    fn public_registration_rules_allow_all_when_unconfigured() {
        let settings = default_registration_settings();

        assert!(domain_matches_public_registration_rules(
            &settings,
            "mail.example.com",
        ));
    }

    #[test]
    fn public_registration_rules_match_exact_public_domains() {
        let settings = AdminRegistrationSettings {
            public_domains: vec!["mail.example.com".to_owned()],
            ..default_registration_settings()
        };

        assert!(domain_matches_public_registration_rules(
            &settings,
            "mail.example.com",
        ));
        assert!(!domain_matches_public_registration_rules(
            &settings,
            "other.example.com",
        ));
    }

    #[test]
    fn public_registration_rules_match_allowed_suffixes() {
        let settings = AdminRegistrationSettings {
            allowed_email_suffixes: vec!["example.com".to_owned()],
            ..default_registration_settings()
        };

        assert!(domain_matches_public_registration_rules(
            &settings,
            "mail.example.com",
        ));
        assert!(domain_matches_public_registration_rules(
            &settings,
            "example.com",
        ));
        assert!(!domain_matches_public_registration_rules(
            &settings,
            "mail.other.example",
        ));
    }

    #[test]
    fn invite_code_availability_rejects_disabled_and_exhausted_codes() {
        let now = Utc::now();
        let disabled = PersistedInviteCode {
            id: Uuid::new_v4(),
            name: "disabled".to_owned(),
            code_hash: "hidden".to_owned(),
            code_hint: "tmpmail_...0000".to_owned(),
            max_uses: Some(2),
            uses_count: 0,
            is_disabled: true,
            created_at: now,
            updated_at: now,
            last_used_at: None,
        };
        let exhausted = PersistedInviteCode {
            id: Uuid::new_v4(),
            name: "exhausted".to_owned(),
            code_hash: "hidden".to_owned(),
            code_hint: "tmpmail_...1111".to_owned(),
            max_uses: Some(1),
            uses_count: 1,
            is_disabled: false,
            created_at: now,
            updated_at: now,
            last_used_at: Some(now),
        };

        assert!(ensure_invite_code_available(&disabled).is_err());
        assert!(ensure_invite_code_available(&exhausted).is_err());
    }

    #[test]
    fn invite_code_public_view_calculates_remaining_uses() {
        let now = Utc::now();
        let code = PersistedInviteCode {
            id: Uuid::new_v4(),
            name: "limited".to_owned(),
            code_hash: "hidden".to_owned(),
            code_hint: "tmpmail_...2222".to_owned(),
            max_uses: Some(5),
            uses_count: 2,
            is_disabled: false,
            created_at: now,
            updated_at: now,
            last_used_at: Some(now),
        };

        let public = code.to_public();
        assert_eq!(public.remaining_uses, Some(3));
        assert_eq!(public.uses_count, 2);
    }

    #[test]
    fn invite_code_max_uses_zero_is_invalid() {
        assert!(normalize_invite_code_max_uses(Some(0)).is_err());
        assert_eq!(normalize_invite_code_max_uses(Some(3)).unwrap(), Some(3));
        assert_eq!(normalize_invite_code_max_uses(None).unwrap(), None);
    }
}

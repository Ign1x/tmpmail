use std::{
    fs,
    net::IpAddr,
    path::{Path, PathBuf},
};

use chrono::{DateTime, Utc};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    auth,
    config::Config,
    error::{ApiError, AppResult},
    models::{
        AdminSystemSettings, ConsoleUser, ConsoleUserRole, LocalizedUpdateNoticeContent,
        PublicNoticeTone, PublicUpdateNotice, PublicUpdateNoticeSection,
    },
    state::AppState,
};

const MIN_PASSWORD_LENGTH: usize = 6;
const MIN_USERNAME_LENGTH: usize = 3;
const MAX_USERNAME_LENGTH: usize = 32;
const ADMIN_API_KEY_PREFIX: &str = "tmpmail_admin_";

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
            update_notice: default_public_update_notice(),
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
    api_key_hash: Option<String>,
    #[serde(default)]
    api_key_hint: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    password_updated_at: DateTime<Utc>,
    #[serde(default)]
    api_key_updated_at: Option<DateTime<Utc>>,
    #[serde(default)]
    last_login_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedAdminState {
    #[serde(default)]
    users: Vec<PersistedConsoleUser>,
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

#[derive(Clone, Debug)]
pub struct AdminStateStore {
    path: PathBuf,
    persisted: PersistedAdminState,
}

impl AdminStateStore {
    pub fn load(path: impl Into<PathBuf>) -> anyhow::Result<Self> {
        let path = path.into();
        let persisted = read_persisted_state(&path)?;
        let mut store = Self { path, persisted };
        store.migrate_legacy_single_admin_if_needed()?;

        Ok(store)
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
        AdminSystemSettings {
            system_enabled: self.persisted.system_settings.system_enabled,
            mail_exchange_host: self.persisted.system_settings.mail_exchange_host.clone(),
            mail_route_target: self.persisted.system_settings.mail_route_target.clone(),
            domain_txt_prefix: self.persisted.system_settings.domain_txt_prefix.clone(),
            update_notice: self.persisted.system_settings.update_notice.clone(),
        }
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
            api_key_hash: Some(auth::hash_password(&api_key)?),
            api_key_hint: Some(mask_api_key(&api_key)),
            created_at: now,
            updated_at: now,
            password_updated_at: now,
            api_key_updated_at: Some(now),
            last_login_at: None,
        };

        self.persisted.users.push(user.clone());
        self.persisted.updated_at = Some(now);
        self.save()?;

        Ok((user.to_public(), api_key))
    }

    pub fn sync_default_admin_from_env(&mut self, password: &str) -> AppResult<()> {
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

        let _ = self.bootstrap_first_admin("admin", password)?;
        Ok(())
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

    pub fn create_user(
        &mut self,
        username: &str,
        password: &str,
        role: ConsoleUserRole,
        domain_limit: u32,
    ) -> AppResult<ConsoleUser> {
        let normalized_username = normalize_username(username)?;
        validate_password(password)?;
        self.ensure_username_available(&normalized_username, None)?;

        let now = Utc::now();
        let user = PersistedConsoleUser {
            id: Uuid::new_v4(),
            username: normalized_username,
            role,
            password_hash: auth::hash_password(password)?,
            domain_limit,
            is_disabled: false,
            api_key_hash: None,
            api_key_hint: None,
            created_at: now,
            updated_at: now,
            password_updated_at: now,
            api_key_updated_at: None,
            last_login_at: None,
        };
        let public = user.to_public();
        self.persisted.users.push(user);
        self.persisted.updated_at = Some(now);
        self.save()?;

        Ok(public)
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
        user.api_key_hash = Some(auth::hash_password(&api_key)?);
        user.api_key_hint = Some(mask_api_key(&api_key));
        user.updated_at = now;
        user.password_updated_at = now;
        user.api_key_updated_at = Some(now);
        user.is_disabled = false;
        let public = user.to_public();
        self.persisted.updated_at = Some(now);
        self.save()?;

        Ok((public, api_key))
    }

    pub fn get_or_create_api_key(&mut self, user_id: Uuid) -> AppResult<String> {
        let user = self
            .persisted
            .users
            .iter()
            .find(|user| user.id == user_id)
            .ok_or_else(|| ApiError::not_found("console user not found"))?;
        if user
            .api_key_hash
            .as_deref()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false)
        {
            return Err(ApiError::forbidden(
                "api key is write-only; rotate it to issue a new key",
            ));
        }

        self.regenerate_api_key(user_id)
    }

    pub fn regenerate_api_key(&mut self, user_id: Uuid) -> AppResult<String> {
        let now = Utc::now();
        let api_key = generate_admin_api_key();
        let user = self
            .persisted
            .users
            .iter_mut()
            .find(|user| user.id == user_id)
            .ok_or_else(|| ApiError::not_found("console user not found"))?;
        user.api_key_hash = Some(auth::hash_password(&api_key)?);
        user.api_key_hint = Some(mask_api_key(&api_key));
        user.updated_at = now;
        user.api_key_updated_at = Some(now);
        self.persisted.updated_at = Some(now);
        self.save()?;

        Ok(api_key)
    }

    pub fn authenticate_api_key(&self, token: &str) -> Option<AuthenticatedConsoleUser> {
        self.persisted
            .users
            .iter()
            .find(|user| {
                !user.is_disabled
                    && user
                        .api_key_hash
                        .as_deref()
                        .map(|hash| auth::verify_password(token, hash).unwrap_or(false))
                        .unwrap_or(false)
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

        Ok(user.to_authenticated())
    }

    pub fn update_system_settings(
        &mut self,
        system_enabled: Option<bool>,
        mail_exchange_host: Option<&str>,
        mail_route_target: Option<&str>,
        domain_txt_prefix: Option<&str>,
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
        if let Some(value) = update_notice {
            self.persisted.system_settings.update_notice = Some(normalize_update_notice(value)?);
        }
        self.persisted.updated_at = Some(now);
        self.save()?;

        Ok(self.system_settings())
    }

    fn save(&self) -> AppResult<()> {
        let parent = self
            .path
            .parent()
            .ok_or_else(|| ApiError::internal("invalid admin state path"))?;

        fs::create_dir_all(parent).map_err(|error| {
            ApiError::internal(format!("failed to prepare admin state directory: {error}"))
        })?;
        let serialized = serde_json::to_string_pretty(&self.persisted).map_err(|error| {
            ApiError::internal(format!("failed to serialize admin state: {error}"))
        })?;
        let temp_path = self.path.with_extension("json.tmp");
        fs::write(&temp_path, serialized)
            .map_err(|error| ApiError::internal(format!("failed to write admin state: {error}")))?;
        fs::rename(&temp_path, &self.path).map_err(|error| {
            ApiError::internal(format!("failed to finalize admin state: {error}"))
        })?;

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
            return Err(ApiError::validation("console username already exists"));
        }

        Ok(())
    }

    fn find_user(&self, user_id: Uuid) -> Option<&PersistedConsoleUser> {
        self.persisted.users.iter().find(|user| user.id == user_id)
    }

    fn migrate_legacy_single_admin_if_needed(&mut self) -> AppResult<()> {
        if !self.persisted.users.is_empty() {
            if self
                .persisted
                .api_key
                .as_deref()
                .map(|value| !value.trim().is_empty())
                .unwrap_or(false)
                && self.persisted.api_key_hash.is_none()
            {
                self.persisted.api_key_hash = self.persisted.api_key.clone();
            }
            self.persisted.api_key = None;
            return self.save();
        }

        let Some(password_hash) = self.persisted.password_hash.clone() else {
            self.persisted.api_key = None;
            return self.save();
        };
        let now = self.persisted.updated_at.unwrap_or_else(Utc::now);
        let api_key_hash = if let Some(hash) = self.persisted.api_key_hash.clone() {
            Some(hash)
        } else if let Some(legacy_plaintext_key) = self.persisted.api_key.clone() {
            Some(auth::hash_password(&legacy_plaintext_key)?)
        } else {
            None
        };
        let api_key_hint = self
            .persisted
            .api_key_hint
            .clone()
            .or_else(|| self.persisted.api_key.as_deref().map(mask_api_key));

        self.persisted.users.push(PersistedConsoleUser {
            id: Uuid::new_v4(),
            username: "admin".to_owned(),
            role: ConsoleUserRole::Admin,
            password_hash,
            domain_limit: u32::MAX,
            is_disabled: false,
            api_key_hash,
            api_key_hint,
            created_at: self.persisted.created_at.unwrap_or(now),
            updated_at: now,
            password_updated_at: self.persisted.password_updated_at.unwrap_or(now),
            api_key_updated_at: self.persisted.api_key_updated_at,
            last_login_at: None,
        });
        self.persisted.password_hash = None;
        self.persisted.api_key = None;
        self.persisted.api_key_hash = None;
        self.persisted.api_key_hint = None;
        self.save()
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

fn read_persisted_state(path: &Path) -> anyhow::Result<PersistedAdminState> {
    if !path.exists() {
        return Ok(PersistedAdminState {
            system_settings: PersistedSystemSettings::default(),
            ..PersistedAdminState::default()
        });
    }

    let raw = fs::read_to_string(path)?;
    if raw.trim().is_empty() {
        return Ok(PersistedAdminState {
            system_settings: PersistedSystemSettings::default(),
            ..PersistedAdminState::default()
        });
    }

    Ok(serde_json::from_str(&raw)?)
}

fn default_true() -> bool {
    true
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

fn validate_password(password: &str) -> AppResult<()> {
    let trimmed = password.trim();
    if trimmed.len() < MIN_PASSWORD_LENGTH {
        return Err(ApiError::validation(format!(
            "console password must be at least {MIN_PASSWORD_LENGTH} characters"
        )));
    }

    Ok(())
}

fn normalize_username(username: &str) -> AppResult<String> {
    let normalized = username.trim().to_ascii_lowercase();
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

    Ok(normalized)
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

fn normalize_txt_prefix_setting(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .map(|value| value.trim_matches('.').to_ascii_lowercase())
        .filter(|value| !value.is_empty() && value != "@")
}

fn generate_admin_api_key() -> String {
    let mut bytes = [0_u8; 24];
    OsRng.fill_bytes(&mut bytes);
    format!("{ADMIN_API_KEY_PREFIX}{}", hex_encode(&bytes))
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

impl PersistedConsoleUser {
    fn to_public(&self) -> ConsoleUser {
        ConsoleUser {
            id: self.id.to_string(),
            username: self.username.clone(),
            role: self.role.clone(),
            domain_limit: self.domain_limit,
            is_disabled: self.is_disabled,
            api_key_hint: self.api_key_hint.clone(),
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
    use std::{env, fs, path::PathBuf};

    use uuid::Uuid;

    use super::AdminStateStore;

    fn temp_state_path(name: &str) -> PathBuf {
        env::temp_dir().join(format!("tmpmail-{name}-{}.json", Uuid::new_v4()))
    }

    #[test]
    fn bootstrap_admin_stores_generated_key_hashed_only() {
        let path = temp_state_path("admin-state");
        let mut store = AdminStateStore::load(&path).expect("load state");

        let (_, api_key) = store
            .bootstrap_first_admin("admin", "AdminPass123!")
            .expect("bootstrap admin");
        let raw = fs::read_to_string(&path).expect("read state file");

        assert!(!raw.contains(&api_key));
        assert!(store.authenticate_api_key(&api_key).is_some());

        let _ = fs::remove_file(path);
    }

    #[test]
    fn recovery_reset_rotates_password_and_key() {
        let path = temp_state_path("recover-admin-state");
        let mut store = AdminStateStore::load(&path).expect("load state");
        let (_, old_api_key) = store
            .bootstrap_first_admin("admin", "AdminPass123!")
            .expect("bootstrap admin");

        let (_, new_api_key) = store
            .reset_password_with_recovery("admin", "NewAdminPass123!")
            .expect("reset password");

        assert!(store.authenticate_api_key(&new_api_key).is_some());
        assert!(store.authenticate_api_key(&old_api_key).is_none());

        let _ = fs::remove_file(path);
    }

    #[test]
    fn default_state_exposes_public_update_notice() {
        let path = temp_state_path("default-update-notice");
        let store = AdminStateStore::load(&path).expect("load state");
        let settings = store.system_settings();
        let notice = settings
            .update_notice
            .expect("default update notice should be present");

        assert!(notice.enabled);
        assert!(notice.auto_open);
        assert_eq!(notice.version, "2026-01-16-storage-upgrade");
        assert_eq!(notice.zh.title, "系统更新通知");
        assert_eq!(notice.en.title, "System Update Notice");

        let _ = fs::remove_file(path);
    }
}

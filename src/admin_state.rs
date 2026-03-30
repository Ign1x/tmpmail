use std::{
    fs,
    path::{Path, PathBuf},
};

use chrono::{DateTime, Utc};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};

use crate::{
    auth,
    error::{ApiError, AppResult},
    state::AppState,
};

const MIN_ADMIN_PASSWORD_LENGTH: usize = 8;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedAdminState {
    password_hash: Option<String>,
    api_key: Option<String>,
    api_key_hash: Option<String>,
    api_key_hint: Option<String>,
    created_at: Option<DateTime<Utc>>,
    updated_at: Option<DateTime<Utc>>,
    password_updated_at: Option<DateTime<Utc>>,
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
        store.migrate_legacy_api_key_if_needed()?;

        Ok(store)
    }

    pub fn is_password_configured(&self) -> bool {
        self.persisted
            .password_hash
            .as_deref()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false)
    }

    pub fn has_generated_api_key(&self) -> bool {
        self
            .persisted
            .api_key_hash
            .as_deref()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false)
            || self
                .persisted
                .api_key
                .as_deref()
                .map(|value| !value.trim().is_empty())
                .unwrap_or(false)
    }

    pub fn verify_password(&self, password: &str) -> AppResult<bool> {
        let password_hash = self
            .persisted
            .password_hash
            .as_deref()
            .ok_or_else(|| ApiError::forbidden("admin password is not configured"))?;

        auth::verify_password(password, password_hash)
    }

    pub fn setup_password(&mut self, password: &str) -> AppResult<String> {
        if self.is_password_configured() {
            return Err(ApiError::forbidden("admin password is already configured"));
        }

        validate_password(password)?;

        let now = Utc::now();
        let api_key = generate_admin_api_key();
        self.persisted.password_hash = Some(auth::hash_password(password)?);
        self.persisted.api_key = None;
        self.persisted.api_key_hash = Some(auth::hash_password(&api_key)?);
        self.persisted.api_key_hint = Some(mask_api_key(&api_key));
        self.persisted.created_at = Some(now);
        self.persisted.updated_at = Some(now);
        self.persisted.password_updated_at = Some(now);
        self.persisted.api_key_updated_at = Some(now);
        self.save()?;

        Ok(api_key)
    }

    pub fn change_password(&mut self, current_password: &str, new_password: &str) -> AppResult<()> {
        if !self.verify_password(current_password)? {
            return Err(ApiError::unauthorized("invalid admin password"));
        }

        validate_password(new_password)?;

        let now = Utc::now();
        self.persisted.password_hash = Some(auth::hash_password(new_password)?);
        self.persisted.updated_at = Some(now);
        self.persisted.password_updated_at = Some(now);
        self.save()
    }

    pub fn get_or_create_api_key(&mut self) -> AppResult<String> {
        if self.has_generated_api_key() {
            return Err(ApiError::forbidden(
                "admin api key is write-only; rotate it to issue a new key",
            ));
        }

        let now = Utc::now();
        let api_key = generate_admin_api_key();
        self.persisted.api_key = None;
        self.persisted.api_key_hash = Some(auth::hash_password(&api_key)?);
        self.persisted.api_key_hint = Some(mask_api_key(&api_key));
        self.persisted.updated_at = Some(now);
        self.persisted.api_key_updated_at = Some(now);
        self.save()?;

        Ok(api_key)
    }

    pub fn regenerate_api_key(&mut self) -> AppResult<String> {
        let now = Utc::now();
        let api_key = generate_admin_api_key();
        self.persisted.api_key = None;
        self.persisted.api_key_hash = Some(auth::hash_password(&api_key)?);
        self.persisted.api_key_hint = Some(mask_api_key(&api_key));
        self.persisted.updated_at = Some(now);
        self.persisted.api_key_updated_at = Some(now);
        self.save()?;

        Ok(api_key)
    }

    pub fn matches_api_key(&self, token: &str) -> bool {
        if let Some(api_key_hash) = self
            .persisted
            .api_key_hash
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            return auth::verify_password(token, api_key_hash).unwrap_or(false);
        }

        self.persisted
            .api_key
            .as_deref()
            .map(|value| value == token)
            .unwrap_or(false)
    }

    fn save(&self) -> AppResult<()> {
        let parent = self
            .path
            .parent()
            .ok_or_else(|| ApiError::internal("invalid admin state path"))?;

        fs::create_dir_all(parent)
            .map_err(|error| ApiError::internal(format!("failed to prepare admin state directory: {error}")))?;
        let serialized = serde_json::to_string_pretty(&self.persisted)
            .map_err(|error| ApiError::internal(format!("failed to serialize admin state: {error}")))?;
        let temp_path = self.path.with_extension("json.tmp");
        fs::write(&temp_path, serialized)
            .map_err(|error| ApiError::internal(format!("failed to write admin state: {error}")))?;
        fs::rename(&temp_path, &self.path)
            .map_err(|error| ApiError::internal(format!("failed to finalize admin state: {error}")))?;

        Ok(())
    }

    fn migrate_legacy_api_key_if_needed(&mut self) -> AppResult<()> {
        let Some(legacy_api_key) = self
            .persisted
            .api_key
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
        else {
            return Ok(());
        };

        if self
            .persisted
            .api_key_hash
            .as_deref()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false)
        {
            self.persisted.api_key = None;
            self.save()?;
            return Ok(());
        }

        let now = Utc::now();
        self.persisted.api_key_hash = Some(auth::hash_password(&legacy_api_key)?);
        self.persisted.api_key_hint = Some(mask_api_key(&legacy_api_key));
        self.persisted.api_key = None;
        self.persisted.updated_at = Some(now);
        self.persisted.api_key_updated_at = Some(now);
        self.save()
    }
}

pub async fn is_admin_access(headers: &axum::http::HeaderMap, state: &AppState) -> bool {
    if auth::require_secure_admin_transport(headers).is_err() {
        return false;
    }

    let Some(token) = auth::optional_bearer_token(headers) else {
        return false;
    };

    if auth::is_valid_admin_session_token(&token, &state.config) {
        return true;
    }

    let admin_state = state.admin_state.read().await;
    admin_state.matches_api_key(&token)
}

pub async fn require_admin_access(
    headers: &axum::http::HeaderMap,
    state: &AppState,
) -> AppResult<()> {
    auth::require_secure_admin_transport(headers)?;
    let token = auth::bearer_token(headers)?;

    if auth::is_valid_admin_session_token(&token, &state.config) {
        return Ok(());
    }

    let admin_state = state.admin_state.read().await;
    if admin_state.matches_api_key(&token) {
        return Ok(());
    }

    Err(ApiError::unauthorized("invalid admin credentials"))
}

fn read_persisted_state(path: &Path) -> anyhow::Result<PersistedAdminState> {
    if !path.exists() {
        return Ok(PersistedAdminState::default());
    }

    let raw = fs::read_to_string(path)?;
    if raw.trim().is_empty() {
        return Ok(PersistedAdminState::default());
    }

    Ok(serde_json::from_str(&raw)?)
}

fn validate_password(password: &str) -> AppResult<()> {
    let trimmed = password.trim();
    if trimmed.len() < MIN_ADMIN_PASSWORD_LENGTH {
        return Err(ApiError::validation(format!(
            "admin password must be at least {MIN_ADMIN_PASSWORD_LENGTH} characters"
        )));
    }

    Ok(())
}

fn generate_admin_api_key() -> String {
    let mut bytes = [0_u8; 24];
    OsRng.fill_bytes(&mut bytes);
    format!("tmpmail_admin_{}", hex_encode(&bytes))
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

    format!("{}...{}", &trimmed[..6], &trimmed[trimmed.len().saturating_sub(4)..])
}

#[cfg(test)]
mod tests {
    use std::{env, fs, path::PathBuf};

    use uuid::Uuid;

    use super::{AdminStateStore, PersistedAdminState};

    fn temp_state_path(name: &str) -> PathBuf {
        env::temp_dir().join(format!("tmpmail-{name}-{}.json", Uuid::new_v4()))
    }

    #[test]
    fn stores_generated_admin_key_hashed_only() {
        let path = temp_state_path("admin-state");
        let mut store = AdminStateStore::load(&path).expect("load state");

        let api_key = store.setup_password("AdminPass123!").expect("setup password");
        let raw = fs::read_to_string(&path).expect("read state file");

        assert!(!raw.contains(&api_key));
        assert!(store.matches_api_key(&api_key));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn migrates_legacy_plaintext_admin_key() {
        let path = temp_state_path("legacy-admin-state");
        let persisted = PersistedAdminState {
            password_hash: Some("hash".to_owned()),
            api_key: Some("tmpmail_admin_plaintext".to_owned()),
            api_key_hash: None,
            api_key_hint: None,
            created_at: None,
            updated_at: None,
            password_updated_at: None,
            api_key_updated_at: None,
        };
        fs::write(
            &path,
            serde_json::to_string_pretty(&persisted).expect("serialize"),
        )
        .expect("write legacy state");

        let store = AdminStateStore::load(&path).expect("load migrated state");
        let raw = fs::read_to_string(&path).expect("read migrated state");

        assert!(store.matches_api_key("tmpmail_admin_plaintext"));
        assert!(!raw.contains("tmpmail_admin_plaintext"));

        let _ = fs::remove_file(path);
    }
}

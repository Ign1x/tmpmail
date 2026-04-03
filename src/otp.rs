use std::{collections::HashMap, time::{Duration, Instant}};

use rand_core::{OsRng, RngCore};

use crate::error::{ApiError, AppResult};

#[derive(Clone, Debug)]
struct OtpEntry {
    code: String,
    expires_at: Instant,
    resend_allowed_at: Instant,
}

#[derive(Default)]
pub struct OtpStore {
    entries: HashMap<String, OtpEntry>,
}

impl OtpStore {
    pub fn issue_code(&mut self, email: &str, ttl_seconds: u32, cooldown_seconds: u32) -> AppResult<String> {
        self.prune_expired();
        let key = normalize_email_key(email)?;
        let now = Instant::now();

        if let Some(entry) = self.entries.get(&key)
            && now < entry.resend_allowed_at
        {
            let wait_seconds = entry
                .resend_allowed_at
                .saturating_duration_since(now)
                .as_secs()
                .max(1);
            return Err(ApiError::validation(format!(
                "please wait {wait_seconds} seconds before requesting another code"
            )));
        }

        let code = generate_code();
        self.entries.insert(
            key,
            OtpEntry {
                code: code.clone(),
                expires_at: now + Duration::from_secs(u64::from(ttl_seconds.max(60))),
                resend_allowed_at: now + Duration::from_secs(u64::from(cooldown_seconds)),
            },
        );

        Ok(code)
    }

    pub fn verify_and_consume(&mut self, email: &str, otp_code: &str) -> AppResult<()> {
        self.prune_expired();
        let key = normalize_email_key(email)?;
        let normalized_code = normalize_otp_code(otp_code)?;
        let now = Instant::now();

        let entry = self
            .entries
            .get(&key)
            .ok_or_else(|| ApiError::validation("verification code is required or expired"))?;

        if now >= entry.expires_at {
            self.entries.remove(&key);
            return Err(ApiError::validation("verification code is required or expired"));
        }

        if entry.code != normalized_code {
            return Err(ApiError::validation("invalid verification code"));
        }

        self.entries.remove(&key);
        Ok(())
    }

    fn prune_expired(&mut self) {
        let now = Instant::now();
        self.entries.retain(|_, entry| now < entry.expires_at);
    }
}

pub fn normalize_email_key(email: &str) -> AppResult<String> {
    let normalized = email.trim().to_ascii_lowercase();
    if normalized.is_empty() || !normalized.contains('@') {
        return Err(ApiError::validation("a valid email address is required"));
    }

    Ok(normalized)
}

pub fn normalize_otp_code(value: &str) -> AppResult<String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(ApiError::validation("verification code is required"));
    }
    if normalized.len() > 16 || !normalized.chars().all(|ch| ch.is_ascii_digit()) {
        return Err(ApiError::validation("verification code format is invalid"));
    }

    Ok(normalized.to_owned())
}

fn generate_code() -> String {
    let mut bytes = [0u8; 6];
    OsRng.fill_bytes(&mut bytes);
    bytes
        .iter()
        .map(|byte| char::from(b'0' + (byte % 10)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{OtpStore, normalize_email_key, normalize_otp_code};

    #[test]
    fn issue_and_verify_code_consumes_entry() {
        let mut store = OtpStore::default();
        let code = store
            .issue_code(" User@Example.com ", 600, 0)
            .expect("code should be issued");

        store
            .verify_and_consume("user@example.com", &code)
            .expect("code should verify");

        let error = store
            .verify_and_consume("user@example.com", &code)
            .expect_err("code should be single-use");
        assert!(
            error.to_string().contains("required or expired"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn issue_code_enforces_resend_cooldown() {
        let mut store = OtpStore::default();
        store
            .issue_code("user@example.com", 600, 60)
            .expect("first code should be issued");

        let error = store
            .issue_code("user@example.com", 600, 60)
            .expect_err("second code should respect cooldown");
        assert!(
            error
                .to_string()
                .contains("before requesting another code"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn verify_rejects_wrong_code() {
        let mut store = OtpStore::default();
        let code = store
            .issue_code("user@example.com", 600, 0)
            .expect("code should be issued");
        assert_eq!(code.len(), 6, "codes should be six digits");

        let error = store
            .verify_and_consume("user@example.com", "000000")
            .expect_err("wrong code should fail");
        assert!(
            error.to_string().contains("invalid verification code"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn normalization_rejects_invalid_inputs() {
        let email_error = normalize_email_key("not-an-email").expect_err("email should fail");
        assert!(
            email_error.to_string().contains("valid email address"),
            "unexpected error: {email_error}"
        );

        let code_error = normalize_otp_code("12ab").expect_err("code should fail");
        assert!(
            code_error.to_string().contains("format is invalid"),
            "unexpected error: {code_error}"
        );
    }
}

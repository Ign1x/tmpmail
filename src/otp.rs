use chrono::{DateTime, Duration, Utc};
use rand_core::{OsRng, RngCore};
use sqlx::{FromRow, PgPool, postgres::PgPoolOptions};

use crate::{
    auth,
    config::Config,
    error::{ApiError, AppResult},
};

const MAX_VERIFICATION_ATTEMPTS: u8 = 5;

#[derive(Debug)]
pub struct OtpStore(PgPool);

#[derive(Debug, FromRow)]
struct PgOtpEntry {
    email: String,
    code_hash: String,
    expires_at: DateTime<Utc>,
    resend_allowed_at: DateTime<Utc>,
    failed_attempts: i16,
}

impl OtpStore {
    pub async fn new(config: &Config) -> AppResult<Self> {
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(
                config
                    .required_database_url()
                    .map_err(|error| ApiError::internal(error.to_string()))?,
            )
            .await
            .map_err(map_sqlx_error)?;

        Ok(Self(pool))
    }

    pub async fn issue_code(
        &self,
        email: &str,
        ttl_seconds: u32,
        cooldown_seconds: u32,
    ) -> AppResult<String> {
        issue_postgres_code(&self.0, email, ttl_seconds, cooldown_seconds).await
    }

    pub async fn verify_and_consume(&self, email: &str, otp_code: &str) -> AppResult<()> {
        verify_postgres_code(&self.0, email, otp_code).await
    }
}

async fn issue_postgres_code(
    pool: &PgPool,
    email: &str,
    ttl_seconds: u32,
    cooldown_seconds: u32,
) -> AppResult<String> {
    let key = normalize_email_key(email)?;
    let now = Utc::now();
    let code = generate_code();
    let expires_at = now + Duration::seconds(i64::from(ttl_seconds.max(60)));
    let resend_allowed_at = now + Duration::seconds(i64::from(cooldown_seconds));
    let code_hash = auth::hash_password(&code)?;

    let inserted = sqlx::query_scalar::<_, String>(
        r#"
        INSERT INTO otp_codes (email, code_hash, expires_at, resend_allowed_at, failed_attempts, updated_at)
        VALUES ($1, $2, $3, $4, 0, NOW())
        ON CONFLICT (email) DO UPDATE
        SET code_hash = EXCLUDED.code_hash,
            expires_at = EXCLUDED.expires_at,
            resend_allowed_at = EXCLUDED.resend_allowed_at,
            failed_attempts = 0,
            updated_at = NOW()
        WHERE otp_codes.expires_at <= $5 OR otp_codes.resend_allowed_at <= $5
        RETURNING email
        "#,
    )
    .bind(&key)
    .bind(&code_hash)
    .bind(expires_at)
    .bind(resend_allowed_at)
    .bind(now)
    .fetch_optional(pool)
    .await
    .map_err(map_sqlx_error)?;

    if inserted.is_some() {
        return Ok(code);
    }

    let existing = sqlx::query_as::<_, PgOtpEntry>(
        r#"
        SELECT email, code_hash, expires_at, resend_allowed_at, failed_attempts
        FROM otp_codes
        WHERE email = $1
        "#,
    )
    .bind(&key)
    .fetch_optional(pool)
    .await
    .map_err(map_sqlx_error)?;

    let wait_seconds = existing
        .map(|entry| (entry.resend_allowed_at - now).num_seconds().max(1))
        .unwrap_or(1);
    Err(ApiError::validation(format!(
        "please wait {wait_seconds} seconds before requesting another code"
    )))
}

async fn verify_postgres_code(pool: &PgPool, email: &str, otp_code: &str) -> AppResult<()> {
    let key = normalize_email_key(email)?;
    let normalized_code = normalize_otp_code(otp_code)?;
    let mut tx = pool.begin().await.map_err(map_sqlx_error)?;
    let now = Utc::now();

    sqlx::query("DELETE FROM otp_codes WHERE expires_at <= NOW()")
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

    let Some(entry) = sqlx::query_as::<_, PgOtpEntry>(
        r#"
        SELECT email, code_hash, expires_at, resend_allowed_at, failed_attempts
        FROM otp_codes
        WHERE email = $1
        FOR UPDATE
        "#,
    )
    .bind(&key)
    .fetch_optional(&mut *tx)
    .await
    .map_err(map_sqlx_error)?
    else {
        tx.commit().await.map_err(map_sqlx_error)?;
        return Err(ApiError::validation(
            "verification code is required or expired",
        ));
    };

    if now >= entry.expires_at {
        sqlx::query("DELETE FROM otp_codes WHERE email = $1")
            .bind(&entry.email)
            .execute(&mut *tx)
            .await
            .map_err(map_sqlx_error)?;
        tx.commit().await.map_err(map_sqlx_error)?;
        return Err(ApiError::validation(
            "verification code is required or expired",
        ));
    }

    if auth::verify_password(&normalized_code, &entry.code_hash)? {
        sqlx::query("DELETE FROM otp_codes WHERE email = $1")
            .bind(&entry.email)
            .execute(&mut *tx)
            .await
            .map_err(map_sqlx_error)?;
        tx.commit().await.map_err(map_sqlx_error)?;
        return Ok(());
    }

    let failed_attempts = i32::from(entry.failed_attempts.max(0) as i16) + 1;
    if failed_attempts >= i32::from(MAX_VERIFICATION_ATTEMPTS) {
        sqlx::query("DELETE FROM otp_codes WHERE email = $1")
            .bind(&entry.email)
            .execute(&mut *tx)
            .await
            .map_err(map_sqlx_error)?;
        tx.commit().await.map_err(map_sqlx_error)?;
        return Err(ApiError::validation(
            "verification code expired after too many attempts; request a new code",
        ));
    }

    sqlx::query("UPDATE otp_codes SET failed_attempts = $2, updated_at = NOW() WHERE email = $1")
        .bind(&entry.email)
        .bind(failed_attempts as i16)
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;
    tx.commit().await.map_err(map_sqlx_error)?;

    Err(ApiError::validation("invalid verification code"))
}

fn map_sqlx_error(error: sqlx::Error) -> ApiError {
    ApiError::internal(error.to_string())
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
    use sqlx::{Connection, PgConnection, Row};

    use super::{MAX_VERIFICATION_ATTEMPTS, OtpStore, normalize_email_key, normalize_otp_code};
    use crate::{
        config::Config,
        test_support::{TestDatabase, attach_test_database},
    };

    async fn build_store(label: &str) -> (OtpStore, TestDatabase) {
        let (config, database) = attach_test_database(Config::default(), label).await;
        let store = OtpStore::new(&config).await.expect("build otp store");
        (store, database)
    }

    #[tokio::test]
    async fn issue_and_verify_code_consumes_entry() {
        let (store, _database) = build_store("otp-consume").await;
        let code = store
            .issue_code(" User@Example.com ", 600, 0)
            .await
            .expect("code should be issued");

        store
            .verify_and_consume("user@example.com", &code)
            .await
            .expect("code should verify");

        let error = store
            .verify_and_consume("user@example.com", &code)
            .await
            .expect_err("code should be single-use");
        assert!(
            error.to_string().contains("required or expired"),
            "unexpected error: {error}"
        );
    }

    #[tokio::test]
    async fn issue_code_enforces_resend_cooldown() {
        let (store, _database) = build_store("otp-cooldown").await;
        store
            .issue_code("user@example.com", 600, 60)
            .await
            .expect("first code should be issued");

        let error = store
            .issue_code("user@example.com", 600, 60)
            .await
            .expect_err("second code should respect cooldown");
        assert!(
            error.to_string().contains("before requesting another code"),
            "unexpected error: {error}"
        );
    }

    #[tokio::test]
    async fn verify_rejects_wrong_code() {
        let (store, _database) = build_store("otp-reject").await;
        let code = store
            .issue_code("user@example.com", 600, 0)
            .await
            .expect("code should be issued");
        assert_eq!(code.len(), 6, "codes should be six digits");

        let error = store
            .verify_and_consume("user@example.com", "000000")
            .await
            .expect_err("wrong code should fail");
        assert!(
            error.to_string().contains("invalid verification code"),
            "unexpected error: {error}"
        );
    }

    #[tokio::test]
    async fn verify_expires_code_after_too_many_attempts() {
        let (store, _database) = build_store("otp-attempts").await;
        store
            .issue_code("user@example.com", 600, 0)
            .await
            .expect("code should be issued");

        for _ in 0..(MAX_VERIFICATION_ATTEMPTS - 1) {
            let error = store
                .verify_and_consume("user@example.com", "000000")
                .await
                .expect_err("wrong code should fail");
            assert!(
                error.to_string().contains("invalid verification code"),
                "unexpected error: {error}"
            );
        }

        let error = store
            .verify_and_consume("user@example.com", "000000")
            .await
            .expect_err("attempt cap should expire code");
        assert!(
            error.to_string().contains("too many attempts"),
            "unexpected error: {error}"
        );
    }

    #[tokio::test]
    async fn postgres_store_survives_restart_without_plaintext_codes() {
        let (config, database) = attach_test_database(Config::default(), "otp-restart").await;
        let store = OtpStore::new(&config).await.expect("build otp store");
        let code = store
            .issue_code("persist@example.com", 600, 0)
            .await
            .expect("issue code");

        let mut connection = PgConnection::connect(database.url())
            .await
            .expect("connect otp database");
        let row = sqlx::query("SELECT code_hash FROM otp_codes WHERE email = $1")
            .bind("persist@example.com")
            .fetch_one(&mut connection)
            .await
            .expect("load otp row");
        let persisted: String = row.try_get("code_hash").expect("decode code hash");
        assert!(
            !persisted.contains(&code),
            "otp storage should not store plaintext codes"
        );

        let reloaded = OtpStore::new(&config).await.expect("reload otp store");
        reloaded
            .verify_and_consume("persist@example.com", &code)
            .await
            .expect("verify reloaded code");
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

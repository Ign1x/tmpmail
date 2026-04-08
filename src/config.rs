use anyhow::{Context, Result, bail};
use std::{env, fs, io::ErrorKind, net::IpAddr};

use reqwest::Url;

use crate::models::{SmtpSecurity, default_smtp_port_for_security};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AdminPasswordMode {
    Disabled,
    Bootstrap,
    Force,
}

#[derive(Clone, Debug)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub jwt_secret: String,
    pub http_request_timeout_seconds: i64,
    pub http_concurrency_limit: usize,
    pub sse_connection_limit: usize,
    pub public_metrics_enabled: bool,
    pub trust_proxy_headers: bool,
    pub database_url: String,
    pub admin_password: Option<String>,
    pub admin_password_mode: AdminPasswordMode,
    pub allow_insecure_dev_secrets: bool,
    pub admin_require_secure_transport: bool,
    pub admin_recovery_token: Option<String>,
    pub admin_session_ttl_seconds: i64,
    pub public_domains: Vec<String>,
    pub token_ttl_seconds: i64,
    pub default_account_ttl_seconds: i64,
    pub background_store_lock_timeout_milliseconds: u64,
    pub ingest_mode: String,
    pub inbucket_base_url: Option<String>,
    pub inbucket_username: Option<String>,
    pub inbucket_password: Option<String>,
    pub inbucket_request_timeout_seconds: i64,
    pub inbucket_request_retries: usize,
    pub inbucket_retry_backoff_milliseconds: u64,
    pub inbucket_poll_interval_seconds: i64,
    pub mail_exchange_host: String,
    pub mail_exchange_priority: u16,
    pub mail_cname_target: String,
    pub domain_txt_prefix: String,
    pub domain_verification_poll_interval_seconds: i64,
    pub cleanup_interval_seconds: i64,
    pub pending_domain_retention_seconds: i64,
    pub smtp_host: Option<String>,
    pub smtp_port: u16,
    pub smtp_username: Option<String>,
    pub smtp_password: Option<String>,
    pub smtp_from_address: Option<String>,
    pub smtp_from_name: Option<String>,
    pub smtp_security: SmtpSecurity,
    pub linux_do_client_secret: Option<String>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            host: "0.0.0.0".to_owned(),
            port: 8080,
            jwt_secret: "tmpmail-dev-secret-change-me".to_owned(),
            http_request_timeout_seconds: 15,
            http_concurrency_limit: 256,
            sse_connection_limit: 128,
            public_metrics_enabled: false,
            trust_proxy_headers: false,
            database_url: String::new(),
            admin_password: None,
            admin_password_mode: AdminPasswordMode::Bootstrap,
            allow_insecure_dev_secrets: false,
            admin_require_secure_transport: true,
            admin_recovery_token: None,
            admin_session_ttl_seconds: 12 * 60 * 60,
            public_domains: Vec::new(),
            token_ttl_seconds: 24 * 60 * 60,
            default_account_ttl_seconds: 24 * 60 * 60,
            background_store_lock_timeout_milliseconds: 250,
            ingest_mode: "disabled".to_owned(),
            inbucket_base_url: None,
            inbucket_username: None,
            inbucket_password: None,
            inbucket_request_timeout_seconds: 15,
            inbucket_request_retries: 2,
            inbucket_retry_backoff_milliseconds: 250,
            inbucket_poll_interval_seconds: 15,
            mail_exchange_host: String::new(),
            mail_exchange_priority: 10,
            mail_cname_target: String::new(),
            domain_txt_prefix: String::new(),
            domain_verification_poll_interval_seconds: 60,
            cleanup_interval_seconds: 300,
            pending_domain_retention_seconds: 24 * 60 * 60,
            smtp_host: None,
            smtp_port: 587,
            smtp_username: None,
            smtp_password: None,
            smtp_from_address: None,
            smtp_from_name: None,
            smtp_security: SmtpSecurity::Starttls,
            linux_do_client_secret: None,
        }
    }
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let defaults = Self::default();

        let host = env::var("TMPMAIL_HOST")
            .map(|value| value.trim().to_owned())
            .unwrap_or(defaults.host);
        let port = env::var("TMPMAIL_PORT")
            .ok()
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(defaults.port);
        let jwt_secret = read_optional_secret("TMPMAIL_JWT_SECRET")?.unwrap_or(defaults.jwt_secret);
        let http_request_timeout_seconds = env::var("TMPMAIL_HTTP_REQUEST_TIMEOUT_SECONDS")
            .ok()
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(defaults.http_request_timeout_seconds)
            .clamp(5, 300);
        let http_concurrency_limit = env::var("TMPMAIL_HTTP_CONCURRENCY_LIMIT")
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(defaults.http_concurrency_limit)
            .clamp(16, 4_096);
        let sse_connection_limit = env::var("TMPMAIL_SSE_CONNECTION_LIMIT")
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(defaults.sse_connection_limit)
            .clamp(1, 4_096);
        let public_metrics_enabled = env::var("TMPMAIL_PUBLIC_METRICS_ENABLED")
            .ok()
            .and_then(|value| parse_bool(&value))
            .unwrap_or(defaults.public_metrics_enabled);
        let trust_proxy_headers = env::var("TMPMAIL_TRUST_PROXY_HEADERS")
            .ok()
            .and_then(|value| parse_bool(&value))
            .unwrap_or(defaults.trust_proxy_headers);
        let database_url = resolve_database_url(
            read_optional_env("TMPMAIL_DATABASE_URL"),
            read_optional_env("TMPMAIL_POSTGRES_USER"),
            read_optional_secret("TMPMAIL_POSTGRES_PASSWORD")?,
            read_optional_env("TMPMAIL_POSTGRES_DB"),
        )?;
        let admin_password = read_optional_secret("TMPMAIL_ADMIN_PASSWORD")?;
        let admin_password_mode = env::var("TMPMAIL_ADMIN_PASSWORD_MODE")
            .ok()
            .map(|value| parse_admin_password_mode(&value))
            .transpose()?
            .unwrap_or(defaults.admin_password_mode);
        validate_required_admin_password(admin_password_mode, admin_password.as_deref())?;
        let allow_insecure_dev_secrets = env::var("TMPMAIL_ALLOW_INSECURE_DEV_SECRETS")
            .ok()
            .and_then(|value| parse_bool(&value))
            .unwrap_or(defaults.allow_insecure_dev_secrets);
        let admin_require_secure_transport = env::var("TMPMAIL_ADMIN_REQUIRE_SECURE_TRANSPORT")
            .ok()
            .and_then(|value| parse_bool(&value))
            .unwrap_or(defaults.admin_require_secure_transport);
        let admin_recovery_token = read_optional_secret("TMPMAIL_ADMIN_RECOVERY_TOKEN")?;
        let admin_session_ttl_seconds = env::var("TMPMAIL_ADMIN_SESSION_TTL_SECONDS")
            .ok()
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(defaults.admin_session_ttl_seconds)
            .clamp(60, 30 * 24 * 60 * 60);
        let public_domains = env::var("TMPMAIL_PUBLIC_DOMAINS")
            .map(|value| parse_csv(&value))
            .unwrap_or(defaults.public_domains);
        let token_ttl_seconds = env::var("TMPMAIL_TOKEN_TTL_SECONDS")
            .ok()
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(defaults.token_ttl_seconds)
            .clamp(60, 30 * 24 * 60 * 60);
        let default_account_ttl_seconds = env::var("TMPMAIL_DEFAULT_ACCOUNT_TTL_SECONDS")
            .ok()
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(defaults.default_account_ttl_seconds)
            .clamp(0, 30 * 24 * 60 * 60);
        let background_store_lock_timeout_milliseconds =
            env::var("TMPMAIL_BACKGROUND_STORE_LOCK_TIMEOUT_MILLISECONDS")
                .ok()
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(defaults.background_store_lock_timeout_milliseconds)
                .clamp(25, 5_000);
        let inbucket_base_url = env::var("TMPMAIL_INBUCKET_BASE_URL")
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        let inbucket_username = env::var("TMPMAIL_INBUCKET_USERNAME")
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        let inbucket_password = read_optional_secret("TMPMAIL_INBUCKET_PASSWORD")?;
        let inbucket_request_timeout_seconds = env::var("TMPMAIL_INBUCKET_REQUEST_TIMEOUT_SECONDS")
            .ok()
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(defaults.inbucket_request_timeout_seconds)
            .clamp(5, 300);
        let inbucket_request_retries = env::var("TMPMAIL_INBUCKET_REQUEST_RETRIES")
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(defaults.inbucket_request_retries)
            .clamp(0, 10);
        let inbucket_retry_backoff_milliseconds =
            env::var("TMPMAIL_INBUCKET_RETRY_BACKOFF_MILLISECONDS")
                .ok()
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(defaults.inbucket_retry_backoff_milliseconds)
                .clamp(50, 10_000);
        let ingest_mode = env::var("TMPMAIL_INGEST_MODE")
            .unwrap_or_else(|_| {
                if inbucket_base_url.is_some() {
                    "remote-inbucket".to_owned()
                } else {
                    defaults.ingest_mode
                }
            })
            .trim()
            .to_ascii_lowercase();
        let inbucket_poll_interval_seconds = env::var("TMPMAIL_INBUCKET_POLL_INTERVAL_SECONDS")
            .ok()
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(defaults.inbucket_poll_interval_seconds)
            .clamp(5, 3_600);
        let mail_exchange_host = env::var("TMPMAIL_MAIL_EXCHANGE_HOST")
            .map(|value| normalize_hostname_like(&value))
            .unwrap_or(defaults.mail_exchange_host);
        let mail_exchange_priority = env::var("TMPMAIL_MAIL_EXCHANGE_PRIORITY")
            .ok()
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(defaults.mail_exchange_priority)
            .clamp(1, 65_535);
        let mail_cname_target = env::var("TMPMAIL_MAIL_CNAME_TARGET")
            .map(|value| normalize_hostname_like(&value))
            .unwrap_or(defaults.mail_cname_target);
        let domain_txt_prefix = env::var("TMPMAIL_DOMAIN_TXT_PREFIX")
            .map(|value| normalize_txt_prefix(&value))
            .unwrap_or(defaults.domain_txt_prefix);
        let domain_verification_poll_interval_seconds =
            env::var("TMPMAIL_DOMAIN_VERIFICATION_POLL_INTERVAL_SECONDS")
                .ok()
                .and_then(|value| value.parse::<i64>().ok())
                .unwrap_or(defaults.domain_verification_poll_interval_seconds)
                .clamp(15, 3_600);
        let cleanup_interval_seconds = env::var("TMPMAIL_CLEANUP_INTERVAL_SECONDS")
            .ok()
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(defaults.cleanup_interval_seconds)
            .clamp(60, 24 * 60 * 60);
        let pending_domain_retention_seconds = env::var("TMPMAIL_PENDING_DOMAIN_RETENTION_SECONDS")
            .ok()
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(defaults.pending_domain_retention_seconds)
            .clamp(60, 30 * 24 * 60 * 60);
        let smtp_host = env::var("TMPMAIL_SMTP_HOST")
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        let smtp_security = env::var("TMPMAIL_SMTP_SECURITY")
            .ok()
            .map(|value| parse_smtp_security(&value))
            .transpose()?
            .or_else(|| {
                env::var("TMPMAIL_SMTP_STARTTLS")
                    .ok()
                    .and_then(|value| parse_bool(&value))
                    .map(|enabled| {
                        if enabled {
                            SmtpSecurity::Starttls
                        } else {
                            SmtpSecurity::Plain
                        }
                    })
            })
            .unwrap_or(defaults.smtp_security);
        let smtp_port = env::var("TMPMAIL_SMTP_PORT")
            .ok()
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or_else(|| default_smtp_port_for_security(smtp_security))
            .clamp(1, u16::MAX);
        let smtp_username = env::var("TMPMAIL_SMTP_USERNAME")
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        let smtp_password = read_optional_secret("TMPMAIL_SMTP_PASSWORD")?;
        let smtp_from_address = env::var("TMPMAIL_SMTP_FROM_ADDRESS")
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        let smtp_from_name = env::var("TMPMAIL_SMTP_FROM_NAME")
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        let linux_do_client_secret = read_optional_secret("TMPMAIL_LINUX_DO_CLIENT_SECRET")?;

        let config = Self {
            host,
            port,
            jwt_secret,
            http_request_timeout_seconds,
            http_concurrency_limit,
            sse_connection_limit,
            public_metrics_enabled,
            trust_proxy_headers,
            database_url,
            admin_password,
            admin_password_mode,
            allow_insecure_dev_secrets,
            admin_require_secure_transport,
            admin_recovery_token,
            admin_session_ttl_seconds,
            public_domains,
            token_ttl_seconds,
            default_account_ttl_seconds,
            background_store_lock_timeout_milliseconds,
            ingest_mode,
            inbucket_base_url,
            inbucket_username,
            inbucket_password,
            inbucket_request_timeout_seconds,
            inbucket_request_retries,
            inbucket_retry_backoff_milliseconds,
            inbucket_poll_interval_seconds,
            mail_exchange_host,
            mail_exchange_priority,
            mail_cname_target,
            domain_txt_prefix,
            domain_verification_poll_interval_seconds,
            cleanup_interval_seconds,
            pending_domain_retention_seconds,
            smtp_host,
            smtp_port,
            smtp_username,
            smtp_password,
            smtp_from_address,
            smtp_from_name,
            smtp_security,
            linux_do_client_secret,
        };
        config.validate_runtime_security()?;

        Ok(config)
    }

    pub fn bind_address(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }

    pub fn required_database_url(&self) -> Result<&str> {
        let database_url = self.database_url.trim();
        if database_url.is_empty() {
            bail!(
                "database configuration is missing; set TMPMAIL_DATABASE_URL or bundled TMPMAIL_POSTGRES_* settings"
            );
        }

        Ok(database_url)
    }

    pub fn effective_mail_exchange_host(&self, domain: &str) -> String {
        self.explicit_mail_exchange_host()
            .unwrap_or_else(|| format!("mail.{domain}"))
    }

    pub fn configured_mail_exchange_host(&self) -> Option<String> {
        self.explicit_mail_exchange_host()
    }

    pub fn effective_mail_route_target(&self) -> Option<String> {
        self.explicit_mail_route_target()
            .or_else(|| self.derived_mail_route_target_from_inbucket())
    }

    fn explicit_mail_exchange_host(&self) -> Option<String> {
        normalize_optional_hostname(&self.mail_exchange_host)
            .filter(|value| !is_legacy_mail_placeholder(value))
    }

    fn explicit_mail_route_target(&self) -> Option<String> {
        normalize_optional_hostname_or_ip(&self.mail_cname_target)
            .filter(|value| !is_legacy_mail_placeholder(value))
    }

    fn derived_mail_route_target_from_inbucket(&self) -> Option<String> {
        let base_url = self.inbucket_base_url.as_deref()?.trim();
        if base_url.is_empty() {
            return None;
        }

        let parsed = Url::parse(base_url).ok()?;
        let host = parsed
            .host_str()?
            .trim()
            .trim_start_matches('[')
            .trim_end_matches(']')
            .trim_end_matches('.');
        if host.is_empty() {
            return None;
        }

        if !is_public_mail_route_host(host) {
            return None;
        }

        Some(host.to_owned())
    }

    fn validate_runtime_security(&self) -> Result<()> {
        if self.allow_insecure_dev_secrets {
            return Ok(());
        }

        if self.jwt_secret.trim().chars().count() < 32
            || looks_like_placeholder_secret(&self.jwt_secret)
        {
            bail!(
                "TMPMAIL_JWT_SECRET must be at least 32 characters and not use a placeholder; set TMPMAIL_ALLOW_INSECURE_DEV_SECRETS=true only for explicit local development"
            );
        }

        Ok(())
    }
}

fn read_optional_env(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn read_optional_secret(name: &str) -> Result<Option<String>> {
    if let Some(path) = read_optional_env(&format!("{name}_FILE")) {
        if let Some(value) = read_optional_secret_file(&path)? {
            return Ok(Some(value));
        }
    }

    Ok(read_optional_env(name))
}

fn read_optional_secret_file(path: &str) -> Result<Option<String>> {
    let trimmed_path = path.trim();
    if trimmed_path.is_empty() {
        return Ok(None);
    }

    match fs::read_to_string(trimmed_path) {
        Ok(content) => {
            let value = content.trim().to_owned();
            Ok((!value.is_empty()).then_some(value))
        }
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => {
            Err(error).with_context(|| format!("failed to read secret file {trimmed_path}"))
        }
    }
}

fn resolve_database_url(
    explicit_database_url: Option<String>,
    postgres_user: Option<String>,
    postgres_password: Option<String>,
    postgres_database: Option<String>,
) -> Result<String> {
    if let Some(database_url) = explicit_database_url {
        return Ok(database_url);
    }

    let postgres_password = postgres_password.ok_or_else(|| {
        anyhow::anyhow!(
            "TMPMAIL_DATABASE_URL must be set, or set TMPMAIL_POSTGRES_PASSWORD / TMPMAIL_POSTGRES_PASSWORD_FILE so the bundled postgres service can be used automatically"
        )
    })?;
    let postgres_user = postgres_user.unwrap_or_else(|| "tmpmail".to_owned());
    let postgres_database = postgres_database.unwrap_or_else(|| "tmpmail".to_owned());

    build_bundled_postgres_url(&postgres_user, &postgres_password, &postgres_database)
}

fn build_bundled_postgres_url(
    postgres_user: &str,
    postgres_password: &str,
    postgres_database: &str,
) -> Result<String> {
    let postgres_user = postgres_user.trim();
    if postgres_user.is_empty() {
        bail!("TMPMAIL_POSTGRES_USER must not be empty when TMPMAIL_DATABASE_URL is unset");
    }

    let postgres_password = postgres_password.trim();
    if postgres_password.is_empty() {
        bail!("TMPMAIL_POSTGRES_PASSWORD must not be empty when TMPMAIL_DATABASE_URL is unset");
    }

    let postgres_database = postgres_database.trim().trim_matches('/');
    if postgres_database.is_empty() {
        bail!("TMPMAIL_POSTGRES_DB must not be empty when TMPMAIL_DATABASE_URL is unset");
    }

    let mut database_url =
        Url::parse("postgres://postgres").context("build bundled postgres database url")?;
    database_url
        .set_host(Some("postgres"))
        .map_err(|_| anyhow::anyhow!("failed to set bundled postgres host"))?;
    database_url
        .set_port(Some(5432))
        .map_err(|_| anyhow::anyhow!("failed to set bundled postgres port"))?;
    database_url
        .set_username(postgres_user)
        .map_err(|_| anyhow::anyhow!("failed to set bundled postgres username"))?;
    database_url
        .set_password(Some(postgres_password))
        .map_err(|_| anyhow::anyhow!("failed to set bundled postgres password"))?;
    database_url.set_path(&format!("/{postgres_database}"));

    Ok(database_url.to_string())
}

fn parse_csv(value: &str) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();

    value
        .split(',')
        .map(str::trim)
        .map(normalize_hostname_like)
        .filter(|item| !item.is_empty())
        .filter(|item| seen.insert(item.clone()))
        .collect()
}

fn parse_bool(value: &str) -> Option<bool> {
    match value.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Some(true),
        "0" | "false" | "no" | "off" => Some(false),
        _ => None,
    }
}

fn parse_smtp_security(value: &str) -> Result<SmtpSecurity> {
    match value.trim().to_ascii_lowercase().as_str() {
        "plain" | "none" | "off" => Ok(SmtpSecurity::Plain),
        "starttls" => Ok(SmtpSecurity::Starttls),
        "tls" | "ssl" | "smtps" | "wrapper" | "implicit" | "implicit-tls" => Ok(SmtpSecurity::Tls),
        other => bail!(
            "invalid TMPMAIL_SMTP_SECURITY value: {other}; expected one of plain, starttls, tls"
        ),
    }
}

fn parse_admin_password_mode(value: &str) -> Result<AdminPasswordMode> {
    match value.trim().to_ascii_lowercase().as_str() {
        "disabled" => Ok(AdminPasswordMode::Disabled),
        "bootstrap" => Ok(AdminPasswordMode::Bootstrap),
        "force" => Ok(AdminPasswordMode::Force),
        _ => bail!("TMPMAIL_ADMIN_PASSWORD_MODE must be one of: disabled, bootstrap, force"),
    }
}

fn validate_required_admin_password(
    admin_password_mode: AdminPasswordMode,
    admin_password: Option<&str>,
) -> Result<()> {
    if matches!(admin_password_mode, AdminPasswordMode::Disabled) || admin_password.is_some() {
        return Ok(());
    }

    bail!(
        "TMPMAIL_ADMIN_PASSWORD must be set for runtime startup; use TMPMAIL_ADMIN_PASSWORD or TMPMAIL_ADMIN_PASSWORD_FILE, or explicitly set TMPMAIL_ADMIN_PASSWORD_MODE=disabled to bypass bootstrap"
    )
}

fn looks_like_placeholder_secret(value: &str) -> bool {
    let normalized = value.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return true;
    }

    matches!(
        normalized.as_str(),
        "change-me"
            | "changeme"
            | "change-me-in-production"
            | "tmpmail"
            | "tmpmail-dev-secret-change-me"
            | "dev-secret"
            | "development-secret"
            | "secret"
            | "jwt-secret"
    ) || normalized.contains("change-me")
}

fn normalize_optional_hostname(value: &str) -> Option<String> {
    let normalized = normalize_hostname_like(value);
    if normalized.is_empty() {
        return None;
    }

    if normalized.parse::<IpAddr>().is_ok() {
        return None;
    }

    Some(normalized)
}

fn normalize_optional_hostname_or_ip(value: &str) -> Option<String> {
    let normalized = normalize_hostname_like(value);
    if normalized.is_empty() {
        return None;
    }

    Some(normalized)
}

fn is_legacy_mail_placeholder(value: &str) -> bool {
    value.eq_ignore_ascii_case("mail.tmpmail.local")
}

fn normalize_hostname_like(value: &str) -> String {
    value.trim().trim_end_matches('.').to_ascii_lowercase()
}

fn is_public_mail_route_host(value: &str) -> bool {
    let normalized = normalize_hostname_like(value);
    if normalized.is_empty() || normalized == "localhost" {
        return false;
    }

    if let Ok(ip) = normalized.parse::<IpAddr>() {
        return match ip {
            IpAddr::V4(ip) => {
                !(ip.is_private()
                    || ip.is_loopback()
                    || ip.is_link_local()
                    || ip.is_broadcast()
                    || ip.is_unspecified()
                    || ip.is_documentation())
            }
            IpAddr::V6(ip) => {
                !(ip.is_loopback()
                    || ip.is_unspecified()
                    || ip.is_unique_local()
                    || ip.is_unicast_link_local())
            }
        };
    }

    normalized.contains('.')
}

fn normalize_txt_prefix(value: &str) -> String {
    let normalized = value.trim().trim_matches('.').to_ascii_lowercase();
    if normalized == "@" {
        String::new()
    } else {
        normalized
    }
}

#[cfg(test)]
mod tests {
    use super::{
        AdminPasswordMode, Config, build_bundled_postgres_url, looks_like_placeholder_secret,
        normalize_txt_prefix, parse_admin_password_mode, parse_bool, parse_csv,
        read_optional_secret_file, resolve_database_url, validate_required_admin_password,
    };
    use reqwest::Url;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn derives_public_mail_route_from_remote_inbucket_hostname() {
        let config = Config {
            mail_exchange_host: "mail.tmpmail.local".to_owned(),
            mail_cname_target: "mail.tmpmail.local".to_owned(),
            inbucket_base_url: Some("http://mx.example.net:9000".to_owned()),
            ..Config::default()
        };

        assert_eq!(
            config.effective_mail_exchange_host("fuckcyh.de"),
            "mail.fuckcyh.de"
        );
        assert_eq!(
            config.effective_mail_route_target().as_deref(),
            Some("mx.example.net")
        );
    }

    #[test]
    fn derives_public_mail_route_from_remote_inbucket_ip() {
        let config = Config {
            mail_exchange_host: "mail.tmpmail.local".to_owned(),
            mail_cname_target: "mail.tmpmail.local".to_owned(),
            inbucket_base_url: Some("http://185.13.148.129:9000".to_owned()),
            ..Config::default()
        };

        assert_eq!(
            config.effective_mail_exchange_host("fuckcyh.de"),
            "mail.fuckcyh.de"
        );
        assert_eq!(
            config.effective_mail_route_target().as_deref(),
            Some("185.13.148.129")
        );
    }

    #[test]
    fn does_not_derive_mail_route_from_internal_compose_service_name() {
        let config = Config {
            mail_exchange_host: "mail.tmpmail.local".to_owned(),
            mail_cname_target: "mail.tmpmail.local".to_owned(),
            inbucket_base_url: Some("http://inbucket:9000".to_owned()),
            ..Config::default()
        };

        assert_eq!(config.effective_mail_route_target().as_deref(), None);
    }

    #[test]
    fn does_not_derive_mail_route_from_loopback_inbucket_host() {
        let config = Config {
            mail_exchange_host: "mail.tmpmail.local".to_owned(),
            mail_cname_target: "mail.tmpmail.local".to_owned(),
            inbucket_base_url: Some("http://127.0.0.1:9000".to_owned()),
            ..Config::default()
        };

        assert_eq!(config.effective_mail_route_target().as_deref(), None);
    }

    #[test]
    fn explicit_public_mail_hosts_override_inbucket_derivation() {
        let config = Config {
            mail_exchange_host: "mx.public-mail.example".to_owned(),
            mail_cname_target: "edge.public-mail.example".to_owned(),
            inbucket_base_url: Some("http://185.13.148.129:9000".to_owned()),
            ..Config::default()
        };

        assert_eq!(
            config.effective_mail_exchange_host("fuckcyh.de"),
            "mx.public-mail.example"
        );
        assert_eq!(
            config.effective_mail_route_target().as_deref(),
            Some("edge.public-mail.example")
        );
    }

    #[test]
    fn explicit_ip_cannot_be_used_as_mx_host() {
        let config = Config {
            mail_exchange_host: "185.13.148.129".to_owned(),
            mail_cname_target: "185.13.148.129".to_owned(),
            inbucket_base_url: Some("http://185.13.148.129:9000".to_owned()),
            ..Config::default()
        };

        assert_eq!(
            config.effective_mail_exchange_host("fuckcyh.de"),
            "mail.fuckcyh.de"
        );
        assert_eq!(
            config.effective_mail_route_target().as_deref(),
            Some("185.13.148.129")
        );
    }

    #[test]
    fn parses_admin_secure_transport_toggle_values() {
        assert_eq!(parse_bool("true"), Some(true));
        assert_eq!(parse_bool("false"), Some(false));
        assert_eq!(parse_bool("0"), Some(false));
        assert_eq!(parse_bool("unexpected"), None);
    }

    #[test]
    fn stability_defaults_cover_background_lock_and_inbucket_retries() {
        let config = Config::default();

        assert!(!config.public_metrics_enabled);
        assert_eq!(config.background_store_lock_timeout_milliseconds, 250);
        assert_eq!(config.inbucket_request_retries, 2);
        assert_eq!(config.inbucket_retry_backoff_milliseconds, 250);
        assert_eq!(config.sse_connection_limit, 128);
    }

    #[test]
    fn explicit_database_url_wins_over_bundled_postgres_defaults() {
        let explicit = "postgres://external-user:secret@db.example.com:5432/tmpmail".to_owned();

        assert_eq!(
            resolve_database_url(
                Some(explicit.clone()),
                Some("tmpmail".to_owned()),
                Some("ignored".to_owned()),
                Some("ignored".to_owned()),
            )
            .expect("resolve explicit database url"),
            explicit
        );
    }

    #[test]
    fn builds_bundled_postgres_url_with_encoded_credentials() {
        let resolved = build_bundled_postgres_url("tmpmail", "pa:ss@wo?rd#[]", "tmpmail")
            .expect("build bundled postgres url");
        let parsed = Url::parse(&resolved).expect("parse bundled postgres url");

        assert_eq!(parsed.scheme(), "postgres");
        assert_eq!(parsed.host_str(), Some("postgres"));
        assert_eq!(parsed.port(), Some(5432));
        assert_eq!(parsed.username(), "tmpmail");
        assert_eq!(parsed.password(), Some("pa%3Ass%40wo%3Frd%23%5B%5D"));
        assert_eq!(parsed.path(), "/tmpmail");
        assert!(resolved.contains("pa%3Ass%40wo%3Frd%23%5B%5D"));
    }

    #[test]
    fn bundled_postgres_password_is_required_when_database_url_is_unset() {
        let error = resolve_database_url(None, None, None, None)
            .expect_err("missing bundled postgres password should fail");

        assert!(
            error
                .to_string()
                .contains("TMPMAIL_DATABASE_URL must be set"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn reads_secret_from_file_and_trims_whitespace() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("tmpmail-secret-{unique}.txt"));

        fs::write(&path, "  secret-from-file \n").expect("write secret file");
        let value = read_optional_secret_file(path.to_str().expect("utf8 temp path"))
            .expect("read secret file");
        fs::remove_file(&path).ok();

        assert_eq!(value.as_deref(), Some("secret-from-file"));
    }

    #[test]
    fn missing_secret_file_is_treated_as_absent() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("tmpmail-secret-missing-{unique}.txt"));
        let value = read_optional_secret_file(path.to_str().expect("utf8 temp path"))
            .expect("missing secret file should be absent");

        assert_eq!(value, None);
    }

    #[test]
    fn parse_csv_normalizes_and_deduplicates_domains() {
        assert_eq!(
            parse_csv(" Foo.EXAMPLE.com.,foo.example.com, bar.example.com "),
            vec!["foo.example.com".to_owned(), "bar.example.com".to_owned()]
        );
    }

    #[test]
    fn normalize_txt_prefix_treats_root_as_empty() {
        assert_eq!(normalize_txt_prefix("@"), "");
        assert_eq!(
            normalize_txt_prefix(" _TmpMail-Verify. "),
            "_tmpmail-verify"
        );
    }

    #[test]
    fn rejects_placeholder_jwt_secret_without_explicit_dev_override() {
        let config = Config::default();
        let error = config
            .validate_runtime_security()
            .expect_err("placeholder secret should fail");

        assert!(
            error
                .to_string()
                .contains("TMPMAIL_JWT_SECRET must be at least 32 characters"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn allows_explicit_dev_override_for_weak_jwt_secret() {
        let config = Config {
            allow_insecure_dev_secrets: true,
            ..Config::default()
        };

        config
            .validate_runtime_security()
            .expect("dev override should bypass weak secret rejection");
    }

    #[test]
    fn parses_admin_password_modes() {
        assert_eq!(
            parse_admin_password_mode("bootstrap").expect("bootstrap mode"),
            AdminPasswordMode::Bootstrap
        );
        assert_eq!(
            parse_admin_password_mode("force").expect("force mode"),
            AdminPasswordMode::Force
        );
        assert_eq!(
            parse_admin_password_mode("disabled").expect("disabled mode"),
            AdminPasswordMode::Disabled
        );
        assert!(parse_admin_password_mode("invalid-mode").is_err());
    }

    #[test]
    fn admin_password_is_required_unless_bootstrap_is_disabled() {
        let error = validate_required_admin_password(AdminPasswordMode::Bootstrap, None)
            .expect_err("missing admin password should fail in bootstrap mode");

        assert!(
            error
                .to_string()
                .contains("TMPMAIL_ADMIN_PASSWORD must be set"),
            "unexpected error: {error}"
        );
        validate_required_admin_password(AdminPasswordMode::Disabled, None)
            .expect("disabled mode may skip admin password");
    }

    #[test]
    fn detects_common_placeholder_secrets() {
        assert!(looks_like_placeholder_secret(
            "tmpmail-dev-secret-change-me"
        ));
        assert!(looks_like_placeholder_secret("change-me-in-production"));
        assert!(!looks_like_placeholder_secret(
            "8f8c38e0e8d34eb8a5d7a6d92a7427a0"
        ));
    }
}

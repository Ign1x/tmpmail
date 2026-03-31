use std::{env, net::IpAddr};

use reqwest::Url;

#[derive(Clone, Debug)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub jwt_secret: String,
    pub http_request_timeout_seconds: i64,
    pub http_concurrency_limit: usize,
    pub database_url: Option<String>,
    pub admin_state_path: String,
    pub store_state_path: String,
    pub admin_password: Option<String>,
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
}

impl Default for Config {
    fn default() -> Self {
        Self {
            host: "0.0.0.0".to_owned(),
            port: 8080,
            jwt_secret: "tmpmail-dev-secret-change-me".to_owned(),
            http_request_timeout_seconds: 15,
            http_concurrency_limit: 256,
            database_url: None,
            admin_state_path: "data/config/admin-state.json".to_owned(),
            store_state_path: "data/storage/store-state.json".to_owned(),
            admin_password: None,
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
        }
    }
}

impl Config {
    pub fn from_env() -> Self {
        let defaults = Self::default();

        let host = env::var("TMPMAIL_HOST")
            .map(|value| value.trim().to_owned())
            .unwrap_or(defaults.host);
        let port = env::var("TMPMAIL_PORT")
            .ok()
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(defaults.port);
        let jwt_secret = env::var("TMPMAIL_JWT_SECRET").unwrap_or(defaults.jwt_secret);
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
        let database_url = env::var("TMPMAIL_DATABASE_URL")
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        let admin_state_path = env::var("TMPMAIL_ADMIN_STATE_PATH")
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
            .unwrap_or(defaults.admin_state_path);
        let store_state_path = env::var("TMPMAIL_STORE_STATE_PATH")
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
            .unwrap_or(defaults.store_state_path);
        let admin_password = env::var("TMPMAIL_ADMIN_PASSWORD")
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        let admin_require_secure_transport = env::var("TMPMAIL_ADMIN_REQUIRE_SECURE_TRANSPORT")
            .ok()
            .and_then(|value| parse_bool(&value))
            .unwrap_or(defaults.admin_require_secure_transport);
        let admin_recovery_token = env::var("TMPMAIL_ADMIN_RECOVERY_TOKEN")
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
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
        let inbucket_password = env::var("TMPMAIL_INBUCKET_PASSWORD")
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
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

        Self {
            host,
            port,
            jwt_secret,
            http_request_timeout_seconds,
            http_concurrency_limit,
            database_url,
            admin_state_path,
            store_state_path,
            admin_password,
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
        }
    }

    pub fn bind_address(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }

    pub fn effective_mail_exchange_host(&self, domain: &str) -> String {
        self.explicit_mail_exchange_host()
            .unwrap_or_else(|| format!("mail.{domain}"))
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

        Some(host.to_owned())
    }
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
    use super::{Config, normalize_txt_prefix, parse_bool, parse_csv};

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

        assert_eq!(config.background_store_lock_timeout_milliseconds, 250);
        assert_eq!(config.inbucket_request_retries, 2);
        assert_eq!(config.inbucket_retry_backoff_milliseconds, 250);
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
}

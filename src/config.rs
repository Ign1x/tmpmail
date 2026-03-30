use std::env;

#[derive(Clone, Debug)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub jwt_secret: String,
    pub admin_state_path: String,
    pub admin_session_ttl_seconds: i64,
    pub public_domains: Vec<String>,
    pub token_ttl_seconds: i64,
    pub default_account_ttl_seconds: i64,
    pub ingest_mode: String,
    pub inbucket_base_url: Option<String>,
    pub inbucket_username: Option<String>,
    pub inbucket_password: Option<String>,
    pub inbucket_poll_interval_seconds: i64,
    pub mail_exchange_host: String,
    pub mail_exchange_priority: u16,
    pub mail_cname_target: String,
    pub domain_txt_prefix: String,
    pub domain_verification_poll_interval_seconds: i64,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            host: "0.0.0.0".to_owned(),
            port: 8080,
            jwt_secret: "tmpmail-dev-secret-change-me".to_owned(),
            admin_state_path: "data/config/admin-state.json".to_owned(),
            admin_session_ttl_seconds: 12 * 60 * 60,
            public_domains: vec!["tmpmail.local".to_owned(), "inbox.tmpmail.local".to_owned()],
            token_ttl_seconds: 24 * 60 * 60,
            default_account_ttl_seconds: 24 * 60 * 60,
            ingest_mode: "disabled".to_owned(),
            inbucket_base_url: None,
            inbucket_username: None,
            inbucket_password: None,
            inbucket_poll_interval_seconds: 15,
            mail_exchange_host: "mail.tmpmail.local".to_owned(),
            mail_exchange_priority: 10,
            mail_cname_target: "mail.tmpmail.local".to_owned(),
            domain_txt_prefix: "_tmpmail-verify".to_owned(),
            domain_verification_poll_interval_seconds: 60,
        }
    }
}

impl Config {
    pub fn from_env() -> Self {
        let defaults = Self::default();

        let host = env::var("TMPMAIL_HOST").unwrap_or(defaults.host);
        let port = env::var("TMPMAIL_PORT")
            .ok()
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(defaults.port);
        let jwt_secret = env::var("TMPMAIL_JWT_SECRET").unwrap_or(defaults.jwt_secret);
        let admin_state_path =
            env::var("TMPMAIL_ADMIN_STATE_PATH").unwrap_or(defaults.admin_state_path);
        let admin_session_ttl_seconds = env::var("TMPMAIL_ADMIN_SESSION_TTL_SECONDS")
            .ok()
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(defaults.admin_session_ttl_seconds);
        let public_domains = env::var("TMPMAIL_PUBLIC_DOMAINS")
            .ok()
            .map(|value| parse_csv(&value))
            .filter(|domains| !domains.is_empty())
            .unwrap_or(defaults.public_domains);
        let token_ttl_seconds = env::var("TMPMAIL_TOKEN_TTL_SECONDS")
            .ok()
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(defaults.token_ttl_seconds);
        let default_account_ttl_seconds = env::var("TMPMAIL_DEFAULT_ACCOUNT_TTL_SECONDS")
            .ok()
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(defaults.default_account_ttl_seconds);
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
        let ingest_mode = env::var("TMPMAIL_INGEST_MODE").unwrap_or_else(|_| {
            if inbucket_base_url.is_some() {
                "remote-inbucket".to_owned()
            } else {
                defaults.ingest_mode
            }
        });
        let inbucket_poll_interval_seconds = env::var("TMPMAIL_INBUCKET_POLL_INTERVAL_SECONDS")
            .ok()
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(defaults.inbucket_poll_interval_seconds);
        let mail_exchange_host =
            env::var("TMPMAIL_MAIL_EXCHANGE_HOST").unwrap_or(defaults.mail_exchange_host);
        let mail_exchange_priority = env::var("TMPMAIL_MAIL_EXCHANGE_PRIORITY")
            .ok()
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(defaults.mail_exchange_priority);
        let mail_cname_target =
            env::var("TMPMAIL_MAIL_CNAME_TARGET").unwrap_or(defaults.mail_cname_target);
        let domain_txt_prefix =
            env::var("TMPMAIL_DOMAIN_TXT_PREFIX").unwrap_or(defaults.domain_txt_prefix);
        let domain_verification_poll_interval_seconds =
            env::var("TMPMAIL_DOMAIN_VERIFICATION_POLL_INTERVAL_SECONDS")
                .ok()
                .and_then(|value| value.parse::<i64>().ok())
                .unwrap_or(defaults.domain_verification_poll_interval_seconds);

        Self {
            host,
            port,
            jwt_secret,
            admin_state_path,
            admin_session_ttl_seconds,
            public_domains,
            token_ttl_seconds,
            default_account_ttl_seconds,
            ingest_mode,
            inbucket_base_url,
            inbucket_username,
            inbucket_password,
            inbucket_poll_interval_seconds,
            mail_exchange_host,
            mail_exchange_priority,
            mail_cname_target,
            domain_txt_prefix,
            domain_verification_poll_interval_seconds,
        }
    }

    pub fn bind_address(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}

fn parse_csv(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_owned)
        .collect()
}

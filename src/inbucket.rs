use std::{collections::HashSet, time::Duration};

use anyhow::{Context, Result, anyhow};
use chrono::{DateTime, Utc};
use reqwest::{Client, StatusCode, Url};
use serde::Deserialize;
use tokio::time::sleep;

use crate::models::{Attachment, ImportedMessage, MessageAddress};

#[derive(Clone)]
pub struct InbucketClient {
    base_url: String,
    username: Option<String>,
    password: Option<String>,
    http: Client,
    request_retries: usize,
    retry_backoff: Duration,
}

pub struct DownloadedAsset {
    pub body: Vec<u8>,
    pub content_type: Option<String>,
    pub content_disposition: Option<String>,
}

impl InbucketClient {
    pub fn new(
        base_url: String,
        username: Option<String>,
        password: Option<String>,
        request_timeout: Duration,
        request_retries: usize,
        retry_backoff: Duration,
    ) -> Result<Self> {
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(request_timeout.as_secs().clamp(2, 10)))
            .timeout(request_timeout)
            .pool_idle_timeout(Duration::from_secs(90))
            .tcp_keepalive(Duration::from_secs(30))
            .build()
            .context("failed to build reqwest client")?;

        Ok(Self {
            base_url: base_url.trim_end_matches('/').to_owned(),
            username,
            password,
            http,
            request_retries,
            retry_backoff: retry_backoff.max(Duration::from_millis(50)),
        })
    }

    pub async fn list_mailbox(&self, mailbox: &str) -> Result<Vec<MailboxMessageSummary>> {
        self.get_json(&format!("/api/v1/mailbox/{mailbox}")).await
    }

    pub async fn get_message(&self, mailbox: &str, message_id: &str) -> Result<ImportedMessage> {
        let detail: MailboxMessageDetail = self
            .get_json(&format!("/api/v1/mailbox/{mailbox}/{message_id}"))
            .await?;

        detail.into_imported_message(&self.base_url, mailbox)
    }

    pub async fn download_asset(&self, url: &str) -> Result<DownloadedAsset> {
        let resolved_url = self.resolve_asset_url(url)?;
        let response = self
            .send_get_with_retry(resolved_url.to_string(), "asset download")
            .await?;
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let content_disposition = response
            .headers()
            .get(reqwest::header::CONTENT_DISPOSITION)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let body = response
            .bytes()
            .await
            .context("failed to read inbucket download body")?
            .to_vec();

        Ok(DownloadedAsset {
            body,
            content_type,
            content_disposition,
        })
    }

    async fn get_json<T>(&self, path: &str) -> Result<T>
    where
        T: for<'de> Deserialize<'de>,
    {
        let url = format!("{}{}", self.base_url, path);
        self.send_get_with_retry(url, "json request")
            .await?
            .json::<T>()
            .await
            .context("failed to decode inbucket response")
    }

    async fn send_get_with_retry(&self, url: String, operation: &str) -> Result<reqwest::Response> {
        for attempt in 0..=self.request_retries {
            let mut request = self.http.get(url.clone());
            if let Some(username) = &self.username {
                request = request.basic_auth(username, self.password.as_deref());
            }

            match request.send().await {
                Ok(response) => {
                    if response.status().is_success() {
                        return Ok(response);
                    }

                    let status = response.status();
                    if attempt < self.request_retries && should_retry_status(status) {
                        let delay = self.retry_delay(attempt);
                        tracing::warn!(
                            operation,
                            %status,
                            attempt = attempt + 1,
                            max_attempts = self.request_retries + 1,
                            backoff_ms = delay.as_millis(),
                            "transient inbucket status; retrying request"
                        );
                        sleep(delay).await;
                        continue;
                    }

                    return Err(anyhow!(
                        "inbucket returned non-success status {} during {}",
                        status,
                        operation
                    ));
                }
                Err(error) => {
                    if attempt < self.request_retries && should_retry_request_error(&error) {
                        let delay = self.retry_delay(attempt);
                        tracing::warn!(
                            operation,
                            error = %error,
                            attempt = attempt + 1,
                            max_attempts = self.request_retries + 1,
                            backoff_ms = delay.as_millis(),
                            "transient inbucket request failure; retrying"
                        );
                        sleep(delay).await;
                        continue;
                    }

                    return Err(error).with_context(|| {
                        format!("failed to send {operation} request to inbucket")
                    });
                }
            }
        }

        Err(anyhow!("exhausted inbucket retries for {operation}"))
    }

    fn retry_delay(&self, attempt: usize) -> Duration {
        let exponent = (attempt as u32).min(6);
        self.retry_backoff.saturating_mul(1_u32 << exponent)
    }

    fn resolve_asset_url(&self, value: &str) -> Result<Url> {
        let base_url =
            Url::parse(&self.base_url).context("failed to parse configured inbucket base url")?;
        let resolved = match Url::parse(value.trim()) {
            Ok(url) => url,
            Err(_) => base_url
                .join(value)
                .with_context(|| format!("invalid inbucket asset path {value}"))?,
        };

        if !matches!(resolved.scheme(), "http" | "https") {
            return Err(anyhow!(
                "inbucket asset download rejected because the URL scheme is unsupported"
            ));
        }

        if resolved.scheme() != base_url.scheme()
            || resolved.host_str() != base_url.host_str()
            || resolved.port_or_known_default() != base_url.port_or_known_default()
        {
            return Err(anyhow!(
                "inbucket asset download rejected because the URL is outside the configured origin"
            ));
        }

        Ok(resolved)
    }
}

fn should_retry_status(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::REQUEST_TIMEOUT
            | StatusCode::TOO_MANY_REQUESTS
            | StatusCode::BAD_GATEWAY
            | StatusCode::SERVICE_UNAVAILABLE
            | StatusCode::GATEWAY_TIMEOUT
    ) || status.is_server_error()
}

fn should_retry_request_error(error: &reqwest::Error) -> bool {
    error.is_timeout() || error.is_connect() || error.is_request() || error.is_body()
}

#[derive(Debug, Deserialize)]
pub struct MailboxMessageSummary {
    pub id: String,
}

#[derive(Debug, Default, Deserialize)]
struct MailboxBody {
    #[serde(default)]
    text: String,
    #[serde(default)]
    html: String,
}

#[derive(Debug, Deserialize)]
struct MailboxAttachment {
    #[serde(default)]
    filename: String,
    #[serde(rename = "content-type", default)]
    content_type: String,
    #[serde(rename = "download-link", default)]
    download_link: String,
}

#[derive(Debug, Deserialize)]
struct MailboxMessageDetail {
    mailbox: String,
    id: String,
    #[serde(default)]
    from: String,
    #[serde(default)]
    to: Vec<String>,
    #[serde(default)]
    subject: String,
    date: String,
    size: u64,
    #[serde(default)]
    body: MailboxBody,
    #[serde(default)]
    header: std::collections::HashMap<String, Vec<String>>,
    #[serde(default)]
    attachments: Vec<MailboxAttachment>,
}

impl MailboxMessageDetail {
    fn into_imported_message(self, base_url: &str, mailbox: &str) -> Result<ImportedMessage> {
        let created_at = DateTime::parse_from_rfc3339(&self.date)
            .with_context(|| format!("invalid inbucket date {}", self.date))?
            .with_timezone(&Utc);

        let from = parse_address(&self.from);
        let to = parse_recipient_list(&self.to, self.header.get("To"));
        let msgid = self
            .header
            .get("Message-Id")
            .or_else(|| self.header.get("Message-ID"))
            .and_then(|values| values.first())
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| format!("<{}@{}>", self.id, self.mailbox));
        let text = self.body.text;
        let html = if self.body.html.trim().is_empty() {
            Vec::new()
        } else {
            vec![self.body.html]
        };
        let intro = build_intro(&text, &self.subject);
        let attachments = self
            .attachments
            .into_iter()
            .enumerate()
            .map(|(index, attachment)| Attachment {
                id: format!("{}-{}", self.id, index),
                filename: attachment.filename,
                content_type: attachment.content_type,
                disposition: "attachment".to_owned(),
                transfer_encoding: String::new(),
                related: false,
                size: 0,
                download_url: absolutize_url(base_url, &attachment.download_link),
            })
            .collect();

        Ok(ImportedMessage {
            source_key: format!("{mailbox}:{}", self.id),
            msgid,
            from,
            to,
            subject: self.subject,
            intro,
            size: self.size,
            download_url: format!("{base_url}/api/v1/mailbox/{mailbox}/{}/source", self.id),
            created_at,
            text,
            html,
            attachments,
        })
    }
}

fn parse_recipient_list(
    to: &[String],
    fallback_header: Option<&Vec<String>>,
) -> Vec<MessageAddress> {
    let mut recipients = Vec::new();
    let mut seen_addresses = HashSet::new();

    for value in to {
        for address in split_addresses(value).into_iter().map(parse_address) {
            push_unique_recipient(&mut recipients, &mut seen_addresses, address);
        }
    }

    if recipients.is_empty()
        && let Some(values) = fallback_header
    {
        for value in values {
            for address in split_addresses(value).into_iter().map(parse_address) {
                push_unique_recipient(&mut recipients, &mut seen_addresses, address);
            }
        }
    }

    recipients
}

fn push_unique_recipient(
    recipients: &mut Vec<MessageAddress>,
    seen_addresses: &mut HashSet<String>,
    address: MessageAddress,
) {
    if address.address.is_empty() || !seen_addresses.insert(address.address.clone()) {
        return;
    }

    recipients.push(address);
}

fn parse_address(value: &str) -> MessageAddress {
    let trimmed = value.trim();

    if let Some((name, address)) = parse_named_address(trimmed) {
        return MessageAddress { name, address };
    }

    MessageAddress {
        name: String::new(),
        address: sanitize_email(trimmed),
    }
}

fn parse_named_address(value: &str) -> Option<(String, String)> {
    let start = value.rfind('<')?;
    let end = value.rfind('>')?;

    if end <= start {
        return None;
    }

    let name = value[..start].trim().trim_matches('"').to_owned();
    let address = sanitize_email(&value[start + 1..end]);

    if address.is_empty() {
        return None;
    }

    Some((name, address))
}

fn sanitize_email(value: &str) -> String {
    value
        .trim()
        .trim_matches('<')
        .trim_matches('>')
        .trim_matches('"')
        .trim_matches('\'')
        .trim_end_matches(',')
        .to_lowercase()
}

fn split_addresses(value: &str) -> Vec<&str> {
    value
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .collect()
}

fn build_intro(text: &str, subject: &str) -> String {
    let compact = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" ");

    if compact.is_empty() {
        return subject.to_owned();
    }

    compact.chars().take(120).collect()
}

fn absolutize_url(base_url: &str, value: &str) -> String {
    if value.starts_with("http://") || value.starts_with("https://") {
        value.to_owned()
    } else if value.starts_with('/') {
        format!("{base_url}{value}")
    } else {
        format!("{base_url}/{value}")
    }
}

pub fn mailbox_name_from_address(address: &str) -> Option<String> {
    address
        .split_once('@')
        .map(|(local_part, _)| local_part.trim().to_lowercase())
        .filter(|mailbox| !mailbox.is_empty())
}

pub fn normalized_recipient_addresses(message: &ImportedMessage) -> Vec<String> {
    message
        .to
        .iter()
        .map(|recipient| recipient.address.trim().to_lowercase())
        .filter(|address| !address.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    use std::time::Duration;

    use axum::{
        Json, Router, extract::State, http::StatusCode, response::IntoResponse, routing::get,
    };

    use super::{InbucketClient, mailbox_name_from_address, parse_address};

    #[test]
    fn parses_named_address() {
        let address = parse_address("TmpMail <noreply@tmpmail.local>");
        assert_eq!(address.name, "TmpMail");
        assert_eq!(address.address, "noreply@tmpmail.local");
    }

    #[test]
    fn mailbox_name_uses_local_part() {
        assert_eq!(
            mailbox_name_from_address("Smoke@tmpmail.local"),
            Some("smoke".to_owned())
        );
    }

    #[test]
    fn resolve_asset_url_accepts_relative_paths_on_same_origin() {
        let client = InbucketClient::new(
            "http://127.0.0.1:9000".to_owned(),
            None,
            None,
            Duration::from_secs(2),
            0,
            Duration::from_millis(50),
        )
        .expect("build inbucket client");

        let resolved = client
            .resolve_asset_url("/api/v1/mailbox/demo/msg-1/source")
            .expect("resolve relative asset url");

        assert_eq!(
            resolved.as_str(),
            "http://127.0.0.1:9000/api/v1/mailbox/demo/msg-1/source"
        );
    }

    #[test]
    fn resolve_asset_url_rejects_foreign_origins() {
        let client = InbucketClient::new(
            "http://127.0.0.1:9000".to_owned(),
            None,
            None,
            Duration::from_secs(2),
            0,
            Duration::from_millis(50),
        )
        .expect("build inbucket client");

        let error = client
            .resolve_asset_url("https://example.com/asset")
            .expect_err("foreign origin should be rejected");

        assert!(
            error.to_string().contains("outside the configured origin"),
            "unexpected error: {error}"
        );
    }

    #[tokio::test]
    async fn list_mailbox_retries_transient_statuses() {
        #[derive(Clone)]
        struct TestState {
            attempts: Arc<AtomicUsize>,
        }

        async fn handler(State(state): State<TestState>) -> impl IntoResponse {
            let attempt = state.attempts.fetch_add(1, Ordering::SeqCst);
            if attempt < 2 {
                return StatusCode::SERVICE_UNAVAILABLE.into_response();
            }

            Json(vec![serde_json::json!({ "id": "msg-1" })]).into_response()
        }

        let state = TestState {
            attempts: Arc::new(AtomicUsize::new(0)),
        };
        let app = Router::new()
            .route("/api/v1/mailbox/smoke", get(handler))
            .with_state(state.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind retry test listener");
        let address = listener.local_addr().expect("retry test listener addr");
        let server = tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("run retry test server");
        });

        let client = InbucketClient::new(
            format!("http://{address}"),
            None,
            None,
            Duration::from_secs(2),
            2,
            Duration::from_millis(10),
        )
        .expect("build inbucket client");

        let messages = client.list_mailbox("smoke").await.expect("list mailbox");

        assert_eq!(messages.len(), 1);
        assert_eq!(state.attempts.load(Ordering::SeqCst), 3);

        server.abort();
    }

    #[tokio::test]
    async fn list_mailbox_does_not_retry_non_transient_statuses() {
        #[derive(Clone)]
        struct TestState {
            attempts: Arc<AtomicUsize>,
        }

        async fn handler(State(state): State<TestState>) -> impl IntoResponse {
            state.attempts.fetch_add(1, Ordering::SeqCst);
            StatusCode::NOT_FOUND
        }

        let state = TestState {
            attempts: Arc::new(AtomicUsize::new(0)),
        };
        let app = Router::new()
            .route("/api/v1/mailbox/smoke", get(handler))
            .with_state(state.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind non-retry test listener");
        let address = listener.local_addr().expect("non-retry test listener addr");
        let server = tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("run non-retry test server");
        });

        let client = InbucketClient::new(
            format!("http://{address}"),
            None,
            None,
            Duration::from_secs(2),
            3,
            Duration::from_millis(10),
        )
        .expect("build inbucket client");

        let error = client
            .list_mailbox("smoke")
            .await
            .expect_err("404 should not be retried to success");

        assert!(error.to_string().contains("non-success status 404"));
        assert_eq!(state.attempts.load(Ordering::SeqCst), 1);

        server.abort();
    }
}

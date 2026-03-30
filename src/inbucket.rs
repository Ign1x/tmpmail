use std::collections::HashSet;

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use reqwest::Client;
use serde::Deserialize;

use crate::models::{Attachment, ImportedMessage, MessageAddress};

#[derive(Clone)]
pub struct InbucketClient {
    base_url: String,
    username: Option<String>,
    password: Option<String>,
    http: Client,
}

impl InbucketClient {
    pub fn new(
        base_url: String,
        username: Option<String>,
        password: Option<String>,
    ) -> Result<Self> {
        let http = Client::builder()
            .build()
            .context("failed to build reqwest client")?;

        Ok(Self {
            base_url: base_url.trim_end_matches('/').to_owned(),
            username,
            password,
            http,
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

    async fn get_json<T>(&self, path: &str) -> Result<T>
    where
        T: for<'de> Deserialize<'de>,
    {
        let url = format!("{}{}", self.base_url, path);
        let mut request = self.http.get(url);

        if let Some(username) = &self.username {
            request = request.basic_auth(username, self.password.as_deref());
        }

        request
            .send()
            .await
            .context("failed to send request to inbucket")?
            .error_for_status()
            .context("inbucket returned non-success status")?
            .json::<T>()
            .await
            .context("failed to decode inbucket response")
    }
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
    use super::{mailbox_name_from_address, parse_address};

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
}

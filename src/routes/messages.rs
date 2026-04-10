use axum::{
    Json,
    body::Body,
    extract::{Path, Query, State},
    http::{
        HeaderMap, HeaderValue, StatusCode,
        header::{
            CACHE_CONTROL, CONTENT_DISPOSITION, CONTENT_TYPE, PRAGMA, X_CONTENT_TYPE_OPTIONS,
        },
    },
    response::Response,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    auth,
    error::{ApiError, AppResult},
    inbucket::DownloadedAsset,
    models::{
        HydraCollection, MessageDetail, MessageSeenResponse, MessageSummary, UpdateMessageRequest,
    },
    state::AppState,
};

#[derive(Debug, Deserialize)]
pub struct MessageListQuery {
    pub page: Option<usize>,
}

pub async fn list_messages(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<MessageListQuery>,
) -> AppResult<Json<HydraCollection<MessageSummary>>> {
    let account_id = auth::account_id_from_headers(&headers, &state.config)?;
    let page = query.page.unwrap_or(1);
    let (mut messages, total) = state.store.list_messages(account_id, page).await?;
    for message in &mut messages {
        normalize_message_summary_asset_urls(message);
    }

    Ok(Json(HydraCollection::new(messages, total)))
}

pub async fn get_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> AppResult<Json<MessageDetail>> {
    let account_id = auth::account_id_from_headers(&headers, &state.config)?;
    let message_id =
        Uuid::parse_str(&id).map_err(|_| ApiError::validation("invalid message id"))?;
    let mut message = state.store.get_message(account_id, message_id).await?;
    normalize_message_detail_asset_urls(&mut message);

    Ok(Json(message))
}

pub async fn download_message_raw(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> AppResult<Response> {
    let account_id = auth::account_id_from_headers(&headers, &state.config)?;
    let message_id =
        Uuid::parse_str(&id).map_err(|_| ApiError::validation("invalid message id"))?;
    let message = state.store.get_message(account_id, message_id).await?;

    if is_upstream_download_url(&message.summary.download_url) {
        return download_upstream_asset(
            &state,
            &message.summary.download_url,
            &format!("tmpmail-{}.eml", message.summary.id),
        )
        .await;
    }

    Ok(build_eml_response(&message))
}

pub async fn download_attachment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((id, attachment_id)): Path<(String, String)>,
) -> AppResult<Response> {
    let account_id = auth::account_id_from_headers(&headers, &state.config)?;
    let message_id =
        Uuid::parse_str(&id).map_err(|_| ApiError::validation("invalid message id"))?;
    let message = state.store.get_message(account_id, message_id).await?;

    let attachment = message
        .attachments
        .iter()
        .find(|attachment| attachment.id == attachment_id)
        .cloned()
        .ok_or_else(|| ApiError::not_found("attachment not found"))?;

    if !is_upstream_download_url(&attachment.download_url) {
        return Err(ApiError::not_found("attachment download is unavailable"));
    }

    download_upstream_asset(&state, &attachment.download_url, &attachment.filename).await
}

pub async fn patch_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<UpdateMessageRequest>,
) -> AppResult<Json<MessageSeenResponse>> {
    let account_id = auth::account_id_from_headers(&headers, &state.config)?;
    let message_id =
        Uuid::parse_str(&id).map_err(|_| ApiError::validation("invalid message id"))?;
    let seen = payload.seen.unwrap_or(true);
    let response = state
        .store
        .mark_message_seen(account_id, message_id, seen)
        .await?;
    state.realtime.publish(
        &state.metrics,
        "message.updated",
        account_id,
        Some(message_id),
    );

    Ok(Json(response))
}

pub async fn delete_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> AppResult<StatusCode> {
    let account_id = auth::account_id_from_headers(&headers, &state.config)?;
    let message_id =
        Uuid::parse_str(&id).map_err(|_| ApiError::validation("invalid message id"))?;
    state.store.delete_message(account_id, message_id).await?;
    state.realtime.publish(
        &state.metrics,
        "message.deleted",
        account_id,
        Some(message_id),
    );

    Ok(StatusCode::NO_CONTENT)
}

fn normalize_message_summary_asset_urls(message: &mut MessageSummary) {
    message.download_url = format!("/messages/{}/raw", message.id);
}

fn normalize_message_detail_asset_urls(message: &mut MessageDetail) {
    normalize_message_summary_asset_urls(&mut message.summary);
    let message_id = message.summary.id.clone();
    for attachment in &mut message.attachments {
        attachment.download_url = format!("/messages/{message_id}/attachments/{}", attachment.id);
    }
}

fn is_upstream_download_url(url: &str) -> bool {
    let trimmed = url.trim();
    !trimmed.is_empty() && !trimmed.starts_with("/messages/")
}

async fn download_upstream_asset(
    state: &AppState,
    source_url: &str,
    fallback_filename: &str,
) -> AppResult<Response> {
    let client = state
        .inbucket_client
        .as_ref()
        .ok_or_else(|| ApiError::internal("upstream asset proxy is unavailable"))?;
    let asset = client.download_asset(source_url).await.map_err(|error| {
        ApiError::internal(format!("failed to download upstream asset: {error}"))
    })?;

    Ok(build_binary_response(asset, fallback_filename))
}

fn build_eml_response(message: &MessageDetail) -> Response {
    let body = render_eml(message).into_bytes();
    let filename = format!("tmpmail-{}.eml", message.summary.id);
    build_response(
        body,
        "message/rfc822; charset=utf-8",
        Some(format!(
            "attachment; filename=\"{}\"",
            sanitize_filename(&filename)
        )),
    )
}

fn build_binary_response(asset: DownloadedAsset, fallback_filename: &str) -> Response {
    let content_type = asset
        .content_type
        .unwrap_or_else(|| "application/octet-stream".to_owned());
    let _ = asset.content_disposition;
    let content_disposition = format!(
        "attachment; filename=\"{}\"",
        sanitize_filename(fallback_filename)
    );

    build_response(asset.body, &content_type, Some(content_disposition))
}

fn build_response(
    body: Vec<u8>,
    content_type: &str,
    content_disposition: Option<String>,
) -> Response {
    let mut response = Response::new(Body::from(body));
    *response.status_mut() = StatusCode::OK;
    let headers = response.headers_mut();
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-store, private"));
    headers.insert(PRAGMA, HeaderValue::from_static("no-cache"));
    headers.insert(X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    headers.insert(
        CONTENT_TYPE,
        HeaderValue::from_str(content_type)
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    if let Some(disposition) = content_disposition
        && let Ok(value) = HeaderValue::from_str(&disposition)
    {
        headers.insert(CONTENT_DISPOSITION, value);
    }

    response
}

fn render_eml(message: &MessageDetail) -> String {
    let mut lines = vec![
        format!(
            "Message-ID: {}",
            sanitize_header_value(&message.summary.msgid)
        ),
        format!("Date: {}", message.summary.created_at.to_rfc2822()),
        format!("From: {}", format_address(&message.summary.from)),
        format!("To: {}", format_recipients(&message.summary.to)),
        format!(
            "Subject: {}",
            sanitize_header_value(&message.summary.subject)
        ),
        "MIME-Version: 1.0".to_owned(),
    ];

    if message.html.is_empty() {
        lines.push("Content-Type: text/plain; charset=UTF-8".to_owned());
        lines.push("Content-Transfer-Encoding: 8bit".to_owned());
        lines.push(String::new());
        lines.push(message.text.clone());
        return lines.join("\r\n");
    }

    let boundary = format!(
        "tmpmail-boundary-{}",
        sanitize_boundary(&message.summary.id)
    );
    lines.push(format!(
        "Content-Type: multipart/alternative; boundary=\"{boundary}\""
    ));
    lines.push(String::new());
    lines.push(format!("--{boundary}"));
    lines.push("Content-Type: text/plain; charset=UTF-8".to_owned());
    lines.push("Content-Transfer-Encoding: 8bit".to_owned());
    lines.push(String::new());
    lines.push(message.text.clone());

    for html_part in &message.html {
        lines.push(format!("--{boundary}"));
        lines.push("Content-Type: text/html; charset=UTF-8".to_owned());
        lines.push("Content-Transfer-Encoding: 8bit".to_owned());
        lines.push(String::new());
        lines.push(html_part.clone());
    }

    lines.push(format!("--{boundary}--"));
    lines.join("\r\n")
}

fn format_recipients(recipients: &[crate::models::MessageAddress]) -> String {
    recipients
        .iter()
        .map(format_address)
        .collect::<Vec<_>>()
        .join(", ")
}

fn format_address(address: &crate::models::MessageAddress) -> String {
    if address.name.trim().is_empty() {
        sanitize_header_value(&address.address)
    } else {
        format!(
            "{} <{}>",
            sanitize_header_value(&address.name),
            sanitize_header_value(&address.address)
        )
    }
}

fn sanitize_header_value(value: &str) -> String {
    value
        .replace(['\r', '\n'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn sanitize_filename(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | '"' | '\r' | '\n' => '_',
            _ => ch,
        })
        .collect::<String>();

    if sanitized.trim().is_empty() {
        "download.bin".to_owned()
    } else {
        sanitized
    }
}

fn sanitize_boundary(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
        .collect()
}

#[cfg(test)]
mod tests {
    use axum::{
        Router,
        body::{Body, to_bytes},
        http::{
            Request, StatusCode,
            header::{
                AUTHORIZATION, CACHE_CONTROL, CONTENT_DISPOSITION, CONTENT_TYPE, PRAGMA,
                X_CONTENT_TYPE_OPTIONS,
            },
        },
        routing::get,
    };
    use chrono::Utc;
    use tower::ServiceExt;
    use uuid::Uuid;

    use super::{build_binary_response, render_eml};
    use crate::{
        app::build_router,
        auth,
        config::Config,
        inbucket::DownloadedAsset,
        models::{Attachment, ImportedMessage, MessageAddress, MessageDetail, MessageSummary},
        state::AppState,
    };

    #[tokio::test]
    async fn raw_download_returns_generated_eml_for_local_messages() {
        let state = test_state(test_config()).await;
        let (account_id, address, token) =
            create_account_and_token(&state, "demo@configured.example.com").await;
        let message_id = first_message_id(&state, account_id).await;
        let app = build_router(state);

        let response = app
            .oneshot(
                Request::builder()
                    .uri(format!("/messages/{message_id}/raw"))
                    .header(AUTHORIZATION, format!("Bearer {token}"))
                    .body(Body::empty())
                    .expect("build raw request"),
            )
            .await
            .expect("raw response");

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(CONTENT_TYPE)
                .and_then(|value| value.to_str().ok()),
            Some("message/rfc822; charset=utf-8")
        );
        assert_eq!(
            response
                .headers()
                .get(CACHE_CONTROL)
                .and_then(|value| value.to_str().ok()),
            Some("no-store, private")
        );
        assert_eq!(
            response
                .headers()
                .get(PRAGMA)
                .and_then(|value| value.to_str().ok()),
            Some("no-cache")
        );
        assert_eq!(
            response
                .headers()
                .get(X_CONTENT_TYPE_OPTIONS)
                .and_then(|value| value.to_str().ok()),
            Some("nosniff")
        );
        assert_eq!(
            response
                .headers()
                .get(CONTENT_DISPOSITION)
                .and_then(|value| value.to_str().ok()),
            Some(format!("attachment; filename=\"tmpmail-{message_id}.eml\"").as_str())
        );

        let body = String::from_utf8(
            to_bytes(response.into_body(), usize::MAX)
                .await
                .expect("read raw body")
                .to_vec(),
        )
        .expect("decode raw body");
        assert!(body.contains("Subject: Welcome to TmpMail"));
        assert!(body.contains("Content-Type: multipart/alternative; boundary="));
        assert!(body.contains(&format!("Mailbox {address} is ready.")));
    }

    #[tokio::test]
    async fn attachment_download_proxies_upstream_asset() {
        let (base_url, server) = spawn_upstream_asset_server().await;
        let state = test_state(Config {
            ingest_mode: "remote-inbucket".to_owned(),
            inbucket_base_url: Some(base_url.clone()),
            ..test_config()
        })
        .await;
        let (_account_id, address, token) =
            create_account_and_token(&state, "alice@configured.example.com").await;
        let message_id = import_message_with_attachment(&state, &address, &base_url).await;
        let app = build_router(state);

        let response = app
            .oneshot(
                Request::builder()
                    .uri(format!("/messages/{message_id}/attachments/attachment-1"))
                    .header(AUTHORIZATION, format!("Bearer {token}"))
                    .body(Body::empty())
                    .expect("build attachment request"),
            )
            .await
            .expect("attachment response");

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(CONTENT_TYPE)
                .and_then(|value| value.to_str().ok()),
            Some("application/pdf")
        );
        assert_eq!(
            response
                .headers()
                .get(CONTENT_DISPOSITION)
                .and_then(|value| value.to_str().ok()),
            Some("attachment; filename=\"report.pdf\"")
        );
        assert_eq!(
            response
                .headers()
                .get(X_CONTENT_TYPE_OPTIONS)
                .and_then(|value| value.to_str().ok()),
            Some("nosniff")
        );
        assert_eq!(
            to_bytes(response.into_body(), usize::MAX)
                .await
                .expect("read attachment body")
                .as_ref(),
            b"attachment-body"
        );

        server.abort();
    }

    #[test]
    fn binary_download_ignores_inline_content_disposition_from_upstream() {
        let response = build_binary_response(
            DownloadedAsset {
                body: b"attachment-body".to_vec(),
                content_type: Some("text/html; charset=utf-8".to_owned()),
                content_disposition: Some("inline".to_owned()),
            },
            "report.html",
        );

        assert_eq!(
            response
                .headers()
                .get(CONTENT_DISPOSITION)
                .and_then(|value| value.to_str().ok()),
            Some("attachment; filename=\"report.html\"")
        );
        assert_eq!(
            response
                .headers()
                .get(X_CONTENT_TYPE_OPTIONS)
                .and_then(|value| value.to_str().ok()),
            Some("nosniff")
        );
    }

    #[test]
    fn render_eml_sanitizes_headers_and_creates_multipart_body() {
        let message = MessageDetail {
            summary: MessageSummary {
                id: "bad\r\nboundary".to_owned(),
                account_id: Uuid::new_v4().to_string(),
                msgid: "<abc\r\n123@example.com>".to_owned(),
                from: MessageAddress {
                    name: "Sender\r\nInjected".to_owned(),
                    address: "sender@example.com".to_owned(),
                },
                to: vec![MessageAddress {
                    name: String::new(),
                    address: "target@example.com".to_owned(),
                }],
                subject: "Hello\r\nWorld".to_owned(),
                intro: "intro".to_owned(),
                seen: false,
                is_deleted: false,
                has_attachments: false,
                size: 12,
                download_url: "/messages/raw".to_owned(),
                created_at: Utc::now(),
                updated_at: Utc::now(),
            },
            cc: Vec::new(),
            bcc: Vec::new(),
            text: "plain body".to_owned(),
            html: vec!["<p>html body</p>".to_owned()],
            attachments: Vec::new(),
        };

        let eml = render_eml(&message);

        assert!(eml.contains("Message-ID: <abc 123@example.com>"));
        assert!(eml.contains("From: Sender Injected <sender@example.com>"));
        assert!(eml.contains("Subject: Hello World"));
        assert!(eml.contains(
            "Content-Type: multipart/alternative; boundary=\"tmpmail-boundary-badboundary\""
        ));
        assert!(eml.contains("plain body"));
        assert!(eml.contains("<p>html body</p>"));
        assert!(!eml.contains("Injected\r\n"));
    }

    fn test_config() -> Config {
        Config {
            cleanup_interval_seconds: 0,
            domain_verification_poll_interval_seconds: 0,
            ..Config::default()
        }
    }

    async fn test_state(config: Config) -> AppState {
        crate::test_support::build_test_state(config, "routes-messages").await
    }

    async fn create_account_and_token(state: &AppState, address: &str) -> (Uuid, String, String) {
        let account = state
            .store
            .create_account(address, "secret1234", None)
            .await
            .expect("create account");
        let account_id = Uuid::parse_str(&account.id).expect("account uuid");
        let token = auth::issue_token(account_id, &account.address, state.config.as_ref())
            .expect("issue token");

        (account_id, account.address, token)
    }

    async fn first_message_id(state: &AppState, account_id: Uuid) -> String {
        let (messages, total) = state
            .store
            .list_messages(account_id, 1)
            .await
            .expect("list messages");
        assert_eq!(total, 1);

        messages.first().expect("seed message").id.clone()
    }

    async fn import_message_with_attachment(
        state: &AppState,
        recipient: &str,
        base_url: &str,
    ) -> String {
        let attachment = Attachment {
            id: "attachment-1".to_owned(),
            filename: "report.pdf".to_owned(),
            content_type: "application/pdf".to_owned(),
            disposition: "attachment".to_owned(),
            transfer_encoding: "binary".to_owned(),
            related: false,
            size: 15,
            download_url: format!("{base_url}/asset/report.pdf"),
        };
        let imported = ImportedMessage {
            source_key: format!("attachment-source-{}", Uuid::new_v4()),
            msgid: format!("<{}@example.com>", Uuid::new_v4()),
            from: MessageAddress {
                name: "Reports".to_owned(),
                address: "reports@example.com".to_owned(),
            },
            to: vec![MessageAddress {
                name: recipient.to_owned(),
                address: recipient.to_owned(),
            }],
            subject: "Monthly report".to_owned(),
            intro: "attachment available".to_owned(),
            size: 15,
            download_url: "/messages/raw".to_owned(),
            created_at: Utc::now(),
            text: "attachment body".to_owned(),
            html: Vec::new(),
            attachments: vec![attachment],
        };

        state
            .store
            .import_message_for_recipients(&[recipient.to_owned()], imported)
            .await
            .expect("import message")
            .first()
            .expect("import receipt")
            .message_id
            .to_string()
    }

    async fn spawn_upstream_asset_server() -> (String, tokio::task::JoinHandle<()>) {
        let app = Router::new().route(
            "/asset/report.pdf",
            get(|| async {
                (
                    [
                        (CONTENT_TYPE, "application/pdf"),
                        (CONTENT_DISPOSITION, "attachment; filename=\"report.pdf\""),
                    ],
                    "attachment-body",
                )
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind upstream asset listener");
        let address = listener.local_addr().expect("asset listener address");
        let handle = tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("run upstream asset server");
        });

        (format!("http://{address}"), handle)
    }
}

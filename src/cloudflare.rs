use std::time::Duration;

use reqwest::{
    Client, Url,
    header::{AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderValue},
};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{
    error::{ApiError, AppResult},
    models::{CloudflareDnsSyncResponse, CloudflareTokenValidationResponse, DomainDnsRecord},
};

const CLOUDFLARE_API_BASE: &str = "https://api.cloudflare.com/client/v4";

#[derive(Clone, Debug)]
pub struct CloudflareDnsDeleteReport {
    pub zone_name: String,
    pub deleted_records: usize,
    pub missing_records: usize,
}

#[derive(Debug, Deserialize)]
struct CloudflareEnvelope<T> {
    success: bool,
    #[serde(default)]
    errors: Vec<CloudflareApiError>,
    result: Option<T>,
    #[serde(default)]
    result_info: Option<CloudflareResultInfo>,
}

#[derive(Debug, Deserialize)]
struct CloudflareApiError {
    #[allow(dead_code)]
    code: u64,
    message: String,
}

#[derive(Debug, Deserialize)]
struct CloudflareResultInfo {
    #[serde(default)]
    total_pages: u32,
}

#[derive(Debug, Deserialize)]
struct CloudflareZone {
    id: String,
    name: String,
}

#[derive(Debug, Deserialize)]
struct CloudflareDnsRecord {
    id: String,
    #[serde(rename = "type")]
    kind: String,
    name: String,
    content: String,
    #[serde(default)]
    priority: Option<u16>,
}

pub async fn sync_domain_records(
    api_token: &str,
    domain: &str,
    records: &[DomainDnsRecord],
    timeout: Duration,
) -> AppResult<CloudflareDnsSyncResponse> {
    let client = build_client(api_token, timeout)?;
    let zones = list_zones(&client).await?;
    let zone = match find_best_zone(domain, &zones) {
        Some(zone) => zone,
        None => {
            return Err(ApiError::validation(format!(
                "no Cloudflare zone available for {domain}"
            )));
        }
    };

    let mut created_records = 0usize;
    let mut updated_records = 0usize;
    let mut unchanged_records = 0usize;

    for record in records {
        match upsert_dns_record(&client, &zone.id, record).await? {
            RecordAction::Created => created_records += 1,
            RecordAction::Updated => updated_records += 1,
            RecordAction::Unchanged => unchanged_records += 1,
        }
    }

    Ok(CloudflareDnsSyncResponse {
        zone_name: zone.name.clone(),
        created_records,
        updated_records,
        unchanged_records,
        domain: None,
    })
}

pub async fn validate_api_token(
    api_token: &str,
    timeout: Duration,
) -> AppResult<CloudflareTokenValidationResponse> {
    let client = build_client(api_token, timeout)?;
    let mut zones = list_zones(&client)
        .await?
        .into_iter()
        .map(|zone| zone.name)
        .collect::<Vec<_>>();
    zones.sort();

    Ok(CloudflareTokenValidationResponse {
        zone_count: zones.len(),
        zones,
    })
}

pub async fn delete_domain_records(
    api_token: &str,
    domain: &str,
    records: &[DomainDnsRecord],
    timeout: Duration,
) -> AppResult<CloudflareDnsDeleteReport> {
    let client = build_client(api_token, timeout)?;
    let zones = list_zones(&client).await?;
    let zone = match find_best_zone(domain, &zones) {
        Some(zone) => zone,
        None => {
            return Err(ApiError::validation(format!(
                "no Cloudflare zone available for {domain}"
            )));
        }
    };

    let mut deleted_records = 0usize;
    let mut missing_records = 0usize;

    for record in records {
        let existing_records = list_dns_records(&client, &zone.id, record).await?;
        let matching_ids = matching_record_ids(&existing_records, record)?;
        if matching_ids.is_empty() {
            missing_records += 1;
            continue;
        }

        for record_id in matching_ids {
            delete_record(&client, &zone.id, &record_id).await?;
            deleted_records += 1;
        }
    }

    Ok(CloudflareDnsDeleteReport {
        zone_name: zone.name.clone(),
        deleted_records,
        missing_records,
    })
}

fn build_client(api_token: &str, timeout: Duration) -> AppResult<Client> {
    let trimmed_token = api_token.trim();
    if trimmed_token.is_empty() {
        return Err(ApiError::validation("cloudflare api token is required"));
    }

    let mut headers = HeaderMap::new();
    let auth_value = format!("Bearer {trimmed_token}");
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&auth_value)
            .map_err(|error| ApiError::validation(format!("invalid cloudflare token: {error}")))?,
    );
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

    Client::builder()
        .default_headers(headers)
        .timeout(timeout)
        .build()
        .map_err(|error| ApiError::internal(format!("failed to build Cloudflare client: {error}")))
}

async fn list_zones(client: &Client) -> AppResult<Vec<CloudflareZone>> {
    let mut page = 1u32;
    let mut zones = Vec::new();

    loop {
        let envelope = send_cloudflare_request::<Vec<CloudflareZone>>(
            client,
            reqwest::Method::GET,
            &format!("{CLOUDFLARE_API_BASE}/zones?per_page=100&page={page}"),
            None,
        )
        .await?;
        let total_pages = envelope
            .result_info
            .as_ref()
            .map(|info| info.total_pages.max(1))
            .unwrap_or(1);
        zones.extend(envelope.result.unwrap_or_default());

        if page >= total_pages {
            break;
        }

        page += 1;
    }

    Ok(zones)
}

fn find_best_zone<'a>(domain: &str, zones: &'a [CloudflareZone]) -> Option<&'a CloudflareZone> {
    let normalized_domain = normalize_dns_name(domain);

    zones
        .iter()
        .filter(|zone| {
            let normalized_zone = normalize_dns_name(&zone.name);
            normalized_domain == normalized_zone
                || normalized_domain.ends_with(&format!(".{normalized_zone}"))
        })
        .max_by_key(|zone| zone.name.len())
}

#[derive(Clone, Copy)]
enum RecordAction {
    Created,
    Updated,
    Unchanged,
}

async fn upsert_dns_record(
    client: &Client,
    zone_id: &str,
    record: &DomainDnsRecord,
) -> AppResult<RecordAction> {
    let existing_records = list_dns_records(client, zone_id, record).await?;

    match record.kind.as_str() {
        "TXT" => upsert_txt_record(client, zone_id, record, existing_records).await,
        "MX" => upsert_mx_record(client, zone_id, record, existing_records).await,
        "A" | "AAAA" | "CNAME" => {
            upsert_standard_record(client, zone_id, record, existing_records).await
        }
        kind => Err(ApiError::validation(format!(
            "Cloudflare sync does not support DNS record type {kind}"
        ))),
    }
}

async fn list_dns_records(
    client: &Client,
    zone_id: &str,
    record: &DomainDnsRecord,
) -> AppResult<Vec<CloudflareDnsRecord>> {
    let mut url = Url::parse(&format!(
        "{CLOUDFLARE_API_BASE}/zones/{zone_id}/dns_records"
    ))
    .map_err(|error| ApiError::internal(format!("invalid Cloudflare record url: {error}")))?;
    url.query_pairs_mut()
        .append_pair("name", &record.name)
        .append_pair("type", &record.kind)
        .append_pair("per_page", "100");
    let envelope = send_cloudflare_request::<Vec<CloudflareDnsRecord>>(
        client,
        reqwest::Method::GET,
        url.as_str(),
        None,
    )
    .await?;

    Ok(envelope.result.unwrap_or_default())
}

async fn upsert_txt_record(
    client: &Client,
    zone_id: &str,
    record: &DomainDnsRecord,
    existing_records: Vec<CloudflareDnsRecord>,
) -> AppResult<RecordAction> {
    let desired_content = record.value.trim();
    if existing_records.iter().any(|existing| {
        normalize_dns_text(&existing.content) == normalize_dns_text(desired_content)
    }) {
        return Ok(RecordAction::Unchanged);
    }

    create_record(
        client,
        zone_id,
        json!({
            "type": "TXT",
            "name": record.name,
            "content": desired_content,
            "ttl": record.ttl,
        }),
    )
    .await?;

    Ok(RecordAction::Created)
}

async fn upsert_mx_record(
    client: &Client,
    zone_id: &str,
    record: &DomainDnsRecord,
    existing_records: Vec<CloudflareDnsRecord>,
) -> AppResult<RecordAction> {
    let (priority, content) = parse_mx_value(&record.value)?;
    if existing_records.iter().any(|existing| {
        normalize_dns_name(&existing.name) == normalize_dns_name(&record.name)
            && existing.priority == Some(priority)
            && normalize_dns_name(&existing.content) == normalize_dns_name(&content)
    }) {
        return Ok(RecordAction::Unchanged);
    }

    if let Some(existing) = existing_records
        .into_iter()
        .find(|existing| existing.priority == Some(priority))
    {
        update_record(
            client,
            zone_id,
            &existing.id,
            json!({
                "type": "MX",
                "name": record.name,
                "content": content,
                "priority": priority,
                "ttl": record.ttl,
            }),
        )
        .await?;
        return Ok(RecordAction::Updated);
    }

    create_record(
        client,
        zone_id,
        json!({
            "type": "MX",
            "name": record.name,
            "content": content,
            "priority": priority,
            "ttl": record.ttl,
        }),
    )
    .await?;
    Ok(RecordAction::Created)
}

async fn upsert_standard_record(
    client: &Client,
    zone_id: &str,
    record: &DomainDnsRecord,
    existing_records: Vec<CloudflareDnsRecord>,
) -> AppResult<RecordAction> {
    let desired_content = match record.kind.as_str() {
        "CNAME" => normalize_dns_name(&record.value),
        _ => record.value.trim().to_owned(),
    };

    if existing_records.iter().any(|existing| {
        normalize_dns_name(&existing.name) == normalize_dns_name(&record.name)
            && existing.kind == record.kind
            && normalize_dns_name(&existing.content) == normalize_dns_name(&desired_content)
    }) {
        return Ok(RecordAction::Unchanged);
    }

    let body = json!({
        "type": record.kind,
        "name": record.name,
        "content": desired_content,
        "ttl": record.ttl,
        "proxied": false,
    });

    if let Some(existing) = existing_records.into_iter().next() {
        update_record(client, zone_id, &existing.id, body).await?;
        return Ok(RecordAction::Updated);
    }

    create_record(client, zone_id, body).await?;
    Ok(RecordAction::Created)
}

fn matching_record_ids(
    existing_records: &[CloudflareDnsRecord],
    record: &DomainDnsRecord,
) -> AppResult<Vec<String>> {
    let matching_ids = match record.kind.as_str() {
        "TXT" => {
            let desired_content = normalize_dns_text(&record.value);
            existing_records
                .iter()
                .filter(|existing| {
                    normalize_dns_name(&existing.name) == normalize_dns_name(&record.name)
                        && existing.kind == record.kind
                        && normalize_dns_text(&existing.content) == desired_content
                })
                .map(|existing| existing.id.clone())
                .collect()
        }
        "MX" => {
            let (priority, content) = parse_mx_value(&record.value)?;
            existing_records
                .iter()
                .filter(|existing| {
                    normalize_dns_name(&existing.name) == normalize_dns_name(&record.name)
                        && existing.kind == record.kind
                        && existing.priority == Some(priority)
                        && normalize_dns_name(&existing.content) == content
                })
                .map(|existing| existing.id.clone())
                .collect()
        }
        "A" | "AAAA" | "CNAME" => {
            let desired_content = match record.kind.as_str() {
                "CNAME" => normalize_dns_name(&record.value),
                _ => record.value.trim().to_owned(),
            };
            existing_records
                .iter()
                .filter(|existing| {
                    normalize_dns_name(&existing.name) == normalize_dns_name(&record.name)
                        && existing.kind == record.kind
                        && normalize_dns_name(&existing.content)
                            == normalize_dns_name(&desired_content)
                })
                .map(|existing| existing.id.clone())
                .collect()
        }
        kind => {
            return Err(ApiError::validation(format!(
                "Cloudflare sync does not support DNS record type {kind}"
            )));
        }
    };

    Ok(matching_ids)
}

async fn create_record(client: &Client, zone_id: &str, body: Value) -> AppResult<()> {
    send_cloudflare_request::<Value>(
        client,
        reqwest::Method::POST,
        &format!("{CLOUDFLARE_API_BASE}/zones/{zone_id}/dns_records"),
        Some(body),
    )
    .await?;
    Ok(())
}

async fn delete_record(client: &Client, zone_id: &str, record_id: &str) -> AppResult<()> {
    send_cloudflare_request::<Value>(
        client,
        reqwest::Method::DELETE,
        &format!("{CLOUDFLARE_API_BASE}/zones/{zone_id}/dns_records/{record_id}"),
        None,
    )
    .await?;
    Ok(())
}

async fn update_record(
    client: &Client,
    zone_id: &str,
    record_id: &str,
    body: Value,
) -> AppResult<()> {
    send_cloudflare_request::<Value>(
        client,
        reqwest::Method::PUT,
        &format!("{CLOUDFLARE_API_BASE}/zones/{zone_id}/dns_records/{record_id}"),
        Some(body),
    )
    .await?;
    Ok(())
}

async fn send_cloudflare_request<T: for<'de> Deserialize<'de>>(
    client: &Client,
    method: reqwest::Method,
    url: &str,
    body: Option<Value>,
) -> AppResult<CloudflareEnvelope<T>> {
    let mut request = client.request(method, url);
    if let Some(body) = body {
        request = request.json(&body);
    }

    let response = request
        .send()
        .await
        .map_err(|error| ApiError::internal(format!("Cloudflare request failed: {error}")))?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    let envelope = serde_json::from_str::<CloudflareEnvelope<T>>(&text).map_err(|error| {
        ApiError::internal(format!(
            "invalid Cloudflare response (status {status}): {error}"
        ))
    })?;

    if status.is_success() && envelope.success {
        return Ok(envelope);
    }

    Err(ApiError::validation(render_cloudflare_errors(
        &envelope.errors,
    )))
}

fn render_cloudflare_errors(errors: &[CloudflareApiError]) -> String {
    let detail = errors
        .iter()
        .map(|error| error.message.trim())
        .filter(|message| !message.is_empty())
        .collect::<Vec<_>>();

    if detail.is_empty() {
        "Cloudflare rejected the request".to_owned()
    } else {
        detail.join("; ")
    }
}

fn parse_mx_value(value: &str) -> AppResult<(u16, String)> {
    let mut parts = value.split_whitespace();
    let priority = parts
        .next()
        .ok_or_else(|| ApiError::validation("invalid MX record value"))?
        .parse::<u16>()
        .map_err(|_| ApiError::validation("invalid MX priority"))?;
    let content = parts
        .next()
        .map(normalize_dns_name)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::validation("invalid MX content"))?;

    Ok((priority, content))
}

fn normalize_dns_name(value: &str) -> String {
    value.trim().trim_end_matches('.').to_lowercase()
}

fn normalize_dns_text(value: &str) -> String {
    value.trim().trim_matches('"').to_owned()
}

#[cfg(test)]
mod tests {
    use super::{CloudflareDnsRecord, matching_record_ids};
    use crate::models::DomainDnsRecord;

    fn record(
        id: &str,
        kind: &str,
        name: &str,
        content: &str,
        priority: Option<u16>,
    ) -> CloudflareDnsRecord {
        CloudflareDnsRecord {
            id: id.to_owned(),
            kind: kind.to_owned(),
            name: name.to_owned(),
            content: content.to_owned(),
            priority,
        }
    }

    #[test]
    fn matches_txt_records_by_name_and_content() {
        let existing = vec![
            record(
                "txt-match",
                "TXT",
                "_tmpmail-verify.demo.example",
                "\"token-1\"",
                None,
            ),
            record(
                "txt-other",
                "TXT",
                "_tmpmail-verify.demo.example",
                "\"token-2\"",
                None,
            ),
        ];
        let desired = DomainDnsRecord {
            kind: "TXT".to_owned(),
            name: "_tmpmail-verify.demo.example".to_owned(),
            value: "token-1".to_owned(),
            ttl: 300,
        };

        let matching = matching_record_ids(&existing, &desired).expect("txt matching should work");

        assert_eq!(matching, vec!["txt-match".to_owned()]);
    }

    #[test]
    fn matches_mx_records_by_priority_and_target() {
        let existing = vec![
            record("mx-match", "MX", "demo.example", "mail.example", Some(10)),
            record(
                "mx-other-priority",
                "MX",
                "demo.example",
                "mail.example",
                Some(20),
            ),
        ];
        let desired = DomainDnsRecord {
            kind: "MX".to_owned(),
            name: "demo.example".to_owned(),
            value: "10 mail.example".to_owned(),
            ttl: 300,
        };

        let matching = matching_record_ids(&existing, &desired).expect("mx matching should work");

        assert_eq!(matching, vec!["mx-match".to_owned()]);
    }

    #[test]
    fn matches_cname_records_case_insensitively() {
        let existing = vec![
            record(
                "cname-match",
                "CNAME",
                "mail.demo.example",
                "MAIL.EXAMPLE.COM.",
                None,
            ),
            record(
                "cname-other",
                "CNAME",
                "mail.demo.example",
                "smtp.example.com",
                None,
            ),
        ];
        let desired = DomainDnsRecord {
            kind: "CNAME".to_owned(),
            name: "mail.demo.example".to_owned(),
            value: "mail.example.com".to_owned(),
            ttl: 300,
        };

        let matching =
            matching_record_ids(&existing, &desired).expect("cname matching should work");

        assert_eq!(matching, vec!["cname-match".to_owned()]);
    }
}

use std::net::IpAddr;

use anyhow::{Context, Result};
use hickory_resolver::{
    TokioAsyncResolver,
    proto::rr::{RData, RecordType},
};

use crate::{config::Config, models::DomainDnsRecord};

pub fn build_dns_records(
    domain: &str,
    verification_token: &str,
    config: &Config,
) -> Vec<DomainDnsRecord> {
    let exchange_host = config.effective_mail_exchange_host(domain);
    let mut records = Vec::new();

    if let Some(route_record) = build_mail_route_record(
        domain,
        &exchange_host,
        config.effective_mail_route_target().as_deref(),
    ) {
        records.push(route_record);
    }

    records.push(DomainDnsRecord {
        kind: "MX".to_owned(),
        name: domain.to_owned(),
        value: format!("{} {}", config.mail_exchange_priority, exchange_host),
        ttl: 300,
    });
    records.push(DomainDnsRecord {
        kind: "TXT".to_owned(),
        name: verification_txt_name(domain, config),
        value: verification_token.to_owned(),
        ttl: 300,
    });

    records
}

pub async fn verify_domain_dns(
    domain: &str,
    verification_token: &str,
    config: &Config,
) -> Result<(), String> {
    verify_domain_dns_inner(domain, verification_token, config)
        .await
        .map_err(|error| format_error_chain(&error))
}

async fn verify_domain_dns_inner(
    domain: &str,
    verification_token: &str,
    config: &Config,
) -> Result<()> {
    let resolver = TokioAsyncResolver::tokio_from_system_conf()
        .context("failed to initialize DNS resolver")?;
    verify_txt_token(&resolver, domain, verification_token, config).await?;

    let expected_mx = normalize_dns_name(&config.effective_mail_exchange_host(domain));
    let mx_lookup = resolver
        .mx_lookup(domain)
        .await
        .with_context(|| format!("failed to query MX for {domain}"))?;
    let mx_ok = mx_lookup.iter().any(|record| {
        record.preference() == config.mail_exchange_priority
            && normalize_dns_name(&record.exchange().to_utf8()) == expected_mx
    });

    if !mx_ok {
        anyhow::bail!(
            "MX for {domain} does not point to {} with priority {}",
            expected_mx,
            config.mail_exchange_priority
        );
    }

    if let Some(route_record) = build_mail_route_record(
        domain,
        &expected_mx,
        config.effective_mail_route_target().as_deref(),
    ) {
        if let Err(error) = verify_mail_route_record(&resolver, &route_record).await {
            tracing::debug!(
                domain,
                record_kind = route_record.kind,
                record_name = route_record.name,
                record_value = route_record.value,
                error = ?error,
                "managed domain route record missing or mismatched; allowing verification because MX/TXT are valid"
            );
        }
    }

    Ok(())
}

fn build_mail_route_record(
    domain: &str,
    exchange_host: &str,
    route_target: Option<&str>,
) -> Option<DomainDnsRecord> {
    let alias = format!("mail.{domain}");
    let normalized_exchange_host = normalize_dns_name(exchange_host);

    if normalized_exchange_host != alias {
        return Some(DomainDnsRecord {
            kind: "CNAME".to_owned(),
            name: alias,
            value: normalized_exchange_host,
            ttl: 300,
        });
    }

    let value = normalize_dns_name(route_target?.trim());
    if value.is_empty() {
        return None;
    }

    Some(DomainDnsRecord {
        kind: route_record_kind(&value).to_owned(),
        name: alias,
        value,
        ttl: 300,
    })
}

fn route_record_kind(route_target: &str) -> &'static str {
    match route_target.parse::<IpAddr>() {
        Ok(IpAddr::V4(_)) => "A",
        Ok(IpAddr::V6(_)) => "AAAA",
        Err(_) => "CNAME",
    }
}

fn normalize_dns_name(value: &str) -> String {
    value.trim().trim_end_matches('.').to_lowercase()
}

fn verification_txt_name(domain: &str, config: &Config) -> String {
    let prefix = config.domain_txt_prefix.trim().trim_end_matches('.');

    if prefix.is_empty() || prefix == "@" {
        domain.to_owned()
    } else {
        format!("{prefix}.{domain}")
    }
}

fn verification_txt_candidates(domain: &str, config: &Config) -> Vec<String> {
    let mut names = Vec::new();

    for candidate in [
        verification_txt_name(domain, config),
        domain.to_owned(),
        format!("_tmpmail-verify.{domain}"),
    ] {
        let normalized = normalize_dns_name(&candidate);
        if !normalized.is_empty() && !names.contains(&normalized) {
            names.push(normalized);
        }
    }

    names
}

fn format_error_chain(error: &anyhow::Error) -> String {
    error
        .chain()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join(": ")
}

async fn verify_txt_token(
    resolver: &TokioAsyncResolver,
    domain: &str,
    verification_token: &str,
    config: &Config,
) -> Result<()> {
    let mut checked = Vec::new();

    for txt_name in verification_txt_candidates(domain, config) {
        match resolver.txt_lookup(txt_name.clone()).await {
            Ok(lookup) => {
                let matched = lookup.iter().any(|record| {
                    record
                        .txt_data()
                        .iter()
                        .any(|value| String::from_utf8_lossy(value).trim() == verification_token)
                });

                if matched {
                    return Ok(());
                }

                checked.push(format!("{txt_name} (record found but token did not match)"));
            }
            Err(error) => {
                checked.push(format!("{txt_name} ({error})"));
            }
        }
    }

    if checked.len() == 1 {
        anyhow::bail!("failed to verify TXT record: {}", checked[0]);
    }

    anyhow::bail!(
        "failed to verify TXT record; checked: {}",
        checked.join(", ")
    );
}

async fn verify_mail_route_record(
    resolver: &TokioAsyncResolver,
    route_record: &DomainDnsRecord,
) -> Result<()> {
    match route_record.kind.as_str() {
        "A" | "AAAA" => {
            let expected_ip = route_record
                .value
                .parse::<IpAddr>()
                .with_context(|| format!("invalid IP target {}", route_record.value))?;
            let lookup = resolver
                .lookup_ip(route_record.name.clone())
                .await
                .with_context(|| {
                    format!(
                        "failed to query {} record for {}",
                        route_record.kind, route_record.name
                    )
                })?;
            let route_ok = lookup.iter().any(|ip| ip == expected_ip);

            if !route_ok {
                anyhow::bail!(
                    "{} for {} does not point to {}",
                    route_record.kind,
                    route_record.name,
                    route_record.value
                );
            }
        }
        "CNAME" => {
            let lookup = resolver
                .lookup(route_record.name.clone(), RecordType::CNAME)
                .await
                .with_context(|| format!("failed to query CNAME for {}", route_record.name))?;
            let route_ok = lookup.iter().any(|record| match record {
                RData::CNAME(target) => normalize_dns_name(&target.to_utf8()) == route_record.value,
                _ => false,
            });

            if !route_ok {
                anyhow::bail!(
                    "CNAME for {} does not point to {}",
                    route_record.name,
                    route_record.value
                );
            }
        }
        kind => anyhow::bail!("unsupported DNS route record kind {kind}"),
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{build_dns_records, format_error_chain, verification_txt_candidates};
    use crate::config::Config;

    #[test]
    fn builds_a_record_when_remote_target_is_ipv4() {
        let config = Config {
            mail_exchange_host: "mail.tmpmail.local".to_owned(),
            mail_cname_target: "mail.tmpmail.local".to_owned(),
            inbucket_base_url: Some("http://185.13.148.129:9000".to_owned()),
            ..Config::default()
        };

        let records = build_dns_records("fuckcyh.de", "token", &config);

        assert_eq!(records.len(), 3);
        assert_eq!(records[0].kind, "A");
        assert_eq!(records[0].name, "mail.fuckcyh.de");
        assert_eq!(records[0].value, "185.13.148.129");
        assert_eq!(records[1].value, "10 mail.fuckcyh.de");
        assert_eq!(records[2].kind, "TXT");
        assert_eq!(records[2].name, "fuckcyh.de");
    }

    #[test]
    fn builds_aaaa_record_when_remote_target_is_ipv6() {
        let config = Config {
            mail_exchange_host: "mail.tmpmail.local".to_owned(),
            mail_cname_target: "mail.tmpmail.local".to_owned(),
            inbucket_base_url: Some("http://[2001:db8::25]:9000".to_owned()),
            ..Config::default()
        };

        let records = build_dns_records("fuckcyh.de", "token", &config);

        assert_eq!(records[0].kind, "AAAA");
        assert_eq!(records[0].value, "2001:db8::25");
    }

    #[test]
    fn builds_cname_record_when_remote_target_is_hostname() {
        let config = Config {
            mail_exchange_host: "mail.tmpmail.local".to_owned(),
            mail_cname_target: "mail.tmpmail.local".to_owned(),
            inbucket_base_url: Some("https://mx.example.net:9000".to_owned()),
            ..Config::default()
        };

        let records = build_dns_records("fuckcyh.de", "token", &config);

        assert_eq!(records[0].kind, "CNAME");
        assert_eq!(records[0].value, "mx.example.net");
    }

    #[test]
    fn builds_mail_subdomain_cname_when_mx_host_is_shared() {
        let config = Config {
            mail_exchange_host: "mx.public-mail.example".to_owned(),
            mail_cname_target: "185.13.148.129".to_owned(),
            inbucket_base_url: Some("http://185.13.148.129:9000".to_owned()),
            ..Config::default()
        };

        let records = build_dns_records("fuckcyh.de", "token", &config);

        assert_eq!(records.len(), 3);
        assert_eq!(records[0].kind, "CNAME");
        assert_eq!(records[0].name, "mail.fuckcyh.de");
        assert_eq!(records[0].value, "mx.public-mail.example");
        assert_eq!(records[1].value, "10 mx.public-mail.example");
        assert_eq!(records[2].name, "fuckcyh.de");
    }

    #[test]
    fn uses_custom_txt_prefix_when_configured() {
        let config = Config {
            domain_txt_prefix: "_tmpmail-verify".to_owned(),
            ..Config::default()
        };

        let records = build_dns_records("fuckcyh.de", "token", &config);
        let txt_record = records.last().expect("txt record");

        assert_eq!(txt_record.kind, "TXT");
        assert_eq!(txt_record.name, "_tmpmail-verify.fuckcyh.de");
    }

    #[test]
    fn txt_candidates_include_root_and_legacy_prefix_for_compatibility() {
        let config = Config::default();
        let candidates = verification_txt_candidates("fuckcyh.de", &config);

        assert_eq!(
            candidates,
            vec![
                "fuckcyh.de".to_owned(),
                "_tmpmail-verify.fuckcyh.de".to_owned()
            ]
        );
    }

    #[test]
    fn formats_error_chain_with_root_cause() {
        let error = anyhow::anyhow!("resolver returned nxdomain")
            .context("failed to query TXT for example.com");

        assert_eq!(
            format_error_chain(&error),
            "failed to query TXT for example.com: resolver returned nxdomain"
        );
    }
}

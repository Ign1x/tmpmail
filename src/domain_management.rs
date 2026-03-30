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
    let mut records = vec![
        DomainDnsRecord {
            kind: "TXT".to_owned(),
            name: format!(
                "{}.{}",
                config.domain_txt_prefix.trim_end_matches('.'),
                domain
            ),
            value: verification_token.to_owned(),
            ttl: 300,
        },
        DomainDnsRecord {
            kind: "MX".to_owned(),
            name: domain.to_owned(),
            value: format!("{} {}", config.mail_exchange_priority, exchange_host),
            ttl: 300,
        },
    ];

    if let Some(route_record) = build_mail_route_record(
        domain,
        &exchange_host,
        config.effective_mail_route_target().as_deref(),
    ) {
        records.push(route_record);
    }

    records
}

pub async fn verify_domain_dns(
    domain: &str,
    verification_token: &str,
    config: &Config,
) -> Result<(), String> {
    verify_domain_dns_inner(domain, verification_token, config)
        .await
        .map_err(|error| error.to_string())
}

async fn verify_domain_dns_inner(
    domain: &str,
    verification_token: &str,
    config: &Config,
) -> Result<()> {
    let resolver = TokioAsyncResolver::tokio_from_system_conf()
        .context("failed to initialize DNS resolver")?;
    let txt_name = format!(
        "{}.{}",
        config.domain_txt_prefix.trim_end_matches('.'),
        domain
    );

    let txt_lookup = resolver
        .txt_lookup(txt_name.clone())
        .await
        .with_context(|| format!("failed to query TXT for {txt_name}"))?;
    let txt_ok = txt_lookup.iter().any(|record| {
        record
            .txt_data()
            .iter()
            .any(|value| String::from_utf8_lossy(value).trim() == verification_token)
    });

    if !txt_ok {
        anyhow::bail!(
            "TXT record {} does not contain {}",
            txt_name,
            verification_token
        );
    }

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
        verify_mail_route_record(&resolver, &route_record).await?;
    }

    Ok(())
}

fn build_mail_route_record(
    domain: &str,
    exchange_host: &str,
    route_target: Option<&str>,
) -> Option<DomainDnsRecord> {
    let alias = format!("mail.{domain}");
    if normalize_dns_name(exchange_host) != alias {
        return None;
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
    use super::build_dns_records;
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
        assert_eq!(records[1].value, "10 mail.fuckcyh.de");
        assert_eq!(records[2].kind, "A");
        assert_eq!(records[2].name, "mail.fuckcyh.de");
        assert_eq!(records[2].value, "185.13.148.129");
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

        assert_eq!(records[2].kind, "AAAA");
        assert_eq!(records[2].value, "2001:db8::25");
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

        assert_eq!(records[2].kind, "CNAME");
        assert_eq!(records[2].value, "mx.example.net");
    }

    #[test]
    fn skips_route_record_when_mx_host_is_custom() {
        let config = Config {
            mail_exchange_host: "mx.public-mail.example".to_owned(),
            mail_cname_target: "185.13.148.129".to_owned(),
            inbucket_base_url: Some("http://185.13.148.129:9000".to_owned()),
            ..Config::default()
        };

        let records = build_dns_records("fuckcyh.de", "token", &config);

        assert_eq!(records.len(), 2);
        assert_eq!(records[1].value, "10 mx.public-mail.example");
    }
}

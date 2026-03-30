use anyhow::{Context, Result};
use hickory_resolver::TokioAsyncResolver;

use crate::{config::Config, models::DomainDnsRecord};

pub fn build_dns_records(
    domain: &str,
    verification_token: &str,
    config: &Config,
) -> Vec<DomainDnsRecord> {
    vec![
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
            value: format!(
                "{} {}",
                config.mail_exchange_priority, config.mail_exchange_host
            ),
            ttl: 300,
        },
        DomainDnsRecord {
            kind: "CNAME".to_owned(),
            name: format!("mail.{domain}"),
            value: config.mail_cname_target.clone(),
            ttl: 300,
        },
    ]
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

    let expected_mx = config
        .mail_exchange_host
        .trim_end_matches('.')
        .to_lowercase();
    let mx_lookup = resolver
        .mx_lookup(domain)
        .await
        .with_context(|| format!("failed to query MX for {domain}"))?;
    let mx_ok = mx_lookup.iter().any(|record| {
        record
            .exchange()
            .to_utf8()
            .trim_end_matches('.')
            .to_lowercase()
            == expected_mx
    });

    if !mx_ok {
        anyhow::bail!(
            "MX for {domain} does not point to {}",
            config.mail_exchange_host
        );
    }

    Ok(())
}

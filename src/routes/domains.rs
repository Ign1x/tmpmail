use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use uuid::Uuid;

use crate::{
    admin_state, cloudflare,
    domain_management::verify_domain_dns,
    error::ApiError,
    error::AppResult,
    models::{
        CloudflareDnsSyncResponse, CreateDomainRequest, Domain, DomainDnsRecord, HydraCollection,
    },
    state::AppState,
};

pub async fn list_domains(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<HydraCollection<Domain>>> {
    let domains = if let Some(user) = admin_state::optional_console_user(&headers, &state).await {
        if user.is_admin() {
            state.store.list_all_domains().await?
        } else {
            state.store.list_domains_for_owner(user.id).await?
        }
    } else {
        let (registration_enabled, allowed_suffixes) = {
            let admin_state = state.admin_state.read().await;
            (
                admin_state.is_public_registration_enabled(),
                admin_state.registration_settings().allowed_email_suffixes,
            )
        };
        if !registration_enabled {
            Vec::new()
        } else {
            let domains = state.store.list_domains().await?;
            if allowed_suffixes.is_empty() {
                domains
            } else {
                domains
                    .into_iter()
                    .filter(|domain| {
                        allowed_suffixes.iter().any(|suffix| {
                            domain.domain == *suffix
                                || domain.domain.ends_with(&format!(".{suffix}"))
                        })
                    })
                    .collect()
            }
        }
    };
    let total = domains.len();

    Ok(Json(HydraCollection::new(domains, total)))
}

pub async fn create_domain(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateDomainRequest>,
) -> AppResult<(StatusCode, Json<Domain>)> {
    let user = admin_state::require_console_access(&headers, &state).await?;
    let system_enabled = {
        let admin_state = state.admin_state.read().await;
        admin_state.is_system_enabled()
    };
    if !system_enabled && !user.is_admin() {
        return Err(ApiError::forbidden("system is disabled by administrator"));
    }

    let owner_user_id = if user.is_admin() { None } else { Some(user.id) };
    if !user.is_admin() {
        let owned = state.store.count_domains_owned_by(user.id).await?;
        if owned >= user.domain_limit as usize {
            return Err(ApiError::validation("managed domain limit reached"));
        }
    }
    let domain = state
        .store
        .create_domain(&payload.domain, owner_user_id)
        .await?;

    Ok((StatusCode::CREATED, Json(domain)))
}

pub async fn get_domain_records(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> AppResult<Json<Vec<DomainDnsRecord>>> {
    let user = admin_state::require_console_access(&headers, &state).await?;
    let domain_id = Uuid::parse_str(&id).map_err(|_| ApiError::validation("invalid domain id"))?;
    ensure_domain_access(&state, user, domain_id).await?;
    let config = state.effective_runtime_config().await;
    let records = state.store.domain_dns_records(domain_id, &config).await?;

    Ok(Json(records))
}

pub async fn verify_domain(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> AppResult<Json<Domain>> {
    let user = admin_state::require_console_access(&headers, &state).await?;
    let domain_id = Uuid::parse_str(&id).map_err(|_| ApiError::validation("invalid domain id"))?;
    ensure_domain_access(&state, user, domain_id).await?;
    let config = state.effective_runtime_config().await;
    let (domain_name, token) = state.store.domain_verification_context(domain_id).await?;
    let result = verify_domain_dns(&domain_name, &token, &config).await;
    let domain = state
        .store
        .update_domain_verification_status(domain_id, result.is_ok(), result.err())
        .await?;

    Ok(Json(domain))
}

pub async fn delete_domain(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> AppResult<StatusCode> {
    let user = admin_state::require_console_access(&headers, &state).await?;
    let domain_id = Uuid::parse_str(&id).map_err(|_| ApiError::validation("invalid domain id"))?;
    ensure_domain_access(&state, user.clone(), domain_id).await?;
    let config = state.effective_runtime_config().await;
    let owner_user_id = state.store.domain_owner_user_id(domain_id).await?;
    let cloudflare_user_id = owner_user_id.unwrap_or(user.id);
    let maybe_api_token = {
        let admin_state = state.admin_state.read().await;
        let settings = admin_state.cloudflare_settings(cloudflare_user_id)?;
        if !settings.enabled || !settings.api_token_configured {
            None
        } else {
            Some(
                admin_state
                    .cloudflare_api_token(cloudflare_user_id)?
                    .ok_or_else(|| {
                        ApiError::validation("cloudflare api token is not configured")
                    })?,
            )
        }
    };
    let maybe_cleanup_report = if let Some(api_token) = maybe_api_token {
        let (domain_name, _) = state.store.domain_verification_context(domain_id).await?;
        let records = state.store.domain_dns_records(domain_id, &config).await?;
        Some(
            cloudflare::delete_domain_records(
                &api_token,
                &domain_name,
                &records,
                std::time::Duration::from_secs(
                    state.config.http_request_timeout_seconds.max(5) as u64
                ),
            )
            .await?,
        )
    } else {
        None
    };
    state.store.delete_domain(domain_id).await?;
    if let Some(report) = maybe_cleanup_report {
        state
            .store
            .append_audit_log(
                "domain.cloudflare.delete",
                "domain",
                domain_id.to_string(),
                Some(user.id.to_string()),
                format!(
                    "zone_name={} deleted_records={} missing_records={}",
                    report.zone_name, report.deleted_records, report.missing_records,
                ),
            )
            .await?;
    }

    Ok(StatusCode::NO_CONTENT)
}

pub async fn sync_domain_cloudflare(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> AppResult<Json<CloudflareDnsSyncResponse>> {
    let user = admin_state::require_console_access(&headers, &state).await?;
    let domain_id = Uuid::parse_str(&id).map_err(|_| ApiError::validation("invalid domain id"))?;
    ensure_domain_access(&state, user.clone(), domain_id).await?;
    let config = state.effective_runtime_config().await;
    let api_token = {
        let admin_state = state.admin_state.read().await;
        let settings = admin_state.cloudflare_settings(user.id)?;
        if !settings.enabled {
            return Err(ApiError::validation(
                "cloudflare dns automation is disabled for this user",
            ));
        }

        admin_state
            .cloudflare_api_token(user.id)?
            .ok_or_else(|| ApiError::validation("cloudflare api token is not configured"))?
    };
    let domain = state.store.domain_verification_context(domain_id).await?;
    let records = state.store.domain_dns_records(domain_id, &config).await?;
    let domain_name = domain.0;

    let response = cloudflare::sync_domain_records(
        &api_token,
        &domain_name,
        &records,
        std::time::Duration::from_secs(state.config.http_request_timeout_seconds.max(5) as u64),
    )
    .await?;

    state
        .store
        .append_audit_log(
            "domain.cloudflare.sync",
            "domain",
            domain_id.to_string(),
            Some(user.id.to_string()),
            format!(
                "zone_name={} created_records={} updated_records={} unchanged_records={}",
                response.zone_name,
                response.created_records,
                response.updated_records,
                response.unchanged_records,
            ),
        )
        .await?;

    Ok(Json(response))
}

async fn ensure_domain_access(
    state: &AppState,
    user: admin_state::AuthenticatedConsoleUser,
    domain_id: Uuid,
) -> AppResult<()> {
    if user.is_admin() {
        return Ok(());
    }

    let owner_user_id = state.store.domain_owner_user_id(domain_id).await?;
    if owner_user_id != Some(user.id) {
        return Err(ApiError::forbidden(
            "you do not have access to this managed domain",
        ));
    }

    Ok(())
}

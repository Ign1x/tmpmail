use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use uuid::Uuid;

use crate::{
    admin_state,
    domain_management::verify_domain_dns,
    error::ApiError,
    error::AppResult,
    models::{CreateDomainRequest, Domain, DomainDnsRecord, HydraCollection},
    state::AppState,
};

pub async fn list_domains(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<HydraCollection<Domain>>> {
    let mut store = state.store.lock().await;
    let domains = if admin_state::is_admin_access(&headers, &state).await {
        store.list_all_domains().await?
    } else {
        store.list_domains().await?
    };
    let total = domains.len();

    Ok(Json(HydraCollection::new(domains, total)))
}

pub async fn create_domain(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateDomainRequest>,
) -> AppResult<(StatusCode, Json<Domain>)> {
    admin_state::require_admin_access(&headers, &state).await?;
    let mut store = state.store.lock().await;
    let domain = store.create_domain(&payload.domain).await?;

    Ok((StatusCode::CREATED, Json(domain)))
}

pub async fn get_domain_records(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> AppResult<Json<Vec<DomainDnsRecord>>> {
    admin_state::require_admin_access(&headers, &state).await?;
    let domain_id = Uuid::parse_str(&id).map_err(|_| ApiError::validation("invalid domain id"))?;
    let mut store = state.store.lock().await;
    let records = store.domain_dns_records(domain_id, &state.config).await?;

    Ok(Json(records))
}

pub async fn verify_domain(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> AppResult<Json<Domain>> {
    admin_state::require_admin_access(&headers, &state).await?;
    let domain_id = Uuid::parse_str(&id).map_err(|_| ApiError::validation("invalid domain id"))?;
    let (domain_name, token) = {
        let mut store = state.store.lock().await;
        store.domain_verification_context(domain_id).await?
    };
    let result = verify_domain_dns(&domain_name, &token, &state.config).await;
    let mut store = state.store.lock().await;
    let domain =
        store
            .update_domain_verification_status(domain_id, result.is_ok(), result.err())
            .await?;

    Ok(Json(domain))
}

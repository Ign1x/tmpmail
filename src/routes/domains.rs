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
    let domains = if let Some(user) = admin_state::optional_console_user(&headers, &state).await {
        if user.is_admin() {
            store.list_all_domains().await?
        } else {
            store.list_domains_for_owner(user.id).await?
        }
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
    let user = admin_state::require_console_access(&headers, &state).await?;
    let system_enabled = {
        let admin_state = state.admin_state.read().await;
        admin_state.is_system_enabled()
    };
    if !system_enabled && !user.is_admin() {
        return Err(ApiError::forbidden("system is disabled by administrator"));
    }

    let owner_user_id = if user.is_admin() { None } else { Some(user.id) };
    let mut store = state.store.lock().await;
    if !user.is_admin() {
        let owned = store.count_domains_owned_by(user.id).await?;
        if owned >= user.domain_limit as usize {
            return Err(ApiError::validation("managed domain limit reached"));
        }
    }
    let domain = store.create_domain(&payload.domain, owner_user_id).await?;

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
    let mut store = state.store.lock().await;
    let records = store.domain_dns_records(domain_id, &config).await?;

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
    let (domain_name, token) = {
        let mut store = state.store.lock().await;
        store.domain_verification_context(domain_id).await?
    };
    let result = verify_domain_dns(&domain_name, &token, &config).await;
    let mut store = state.store.lock().await;
    let domain = store
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
    ensure_domain_access(&state, user, domain_id).await?;
    let mut store = state.store.lock().await;
    store.delete_domain(domain_id).await?;

    Ok(StatusCode::NO_CONTENT)
}

async fn ensure_domain_access(
    state: &AppState,
    user: admin_state::AuthenticatedConsoleUser,
    domain_id: Uuid,
) -> AppResult<()> {
    if user.is_admin() {
        return Ok(());
    }

    let mut store = state.store.lock().await;
    let owner_user_id = store.domain_owner_user_id(domain_id).await?;
    if owner_user_id != Some(user.id) {
        return Err(ApiError::forbidden(
            "you do not have access to this managed domain",
        ));
    }

    Ok(())
}

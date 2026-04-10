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
        UpdateDomainRequest,
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
            state.store.list_domains_visible_to_owner(user.id).await?
        }
    } else {
        let registration_enabled = {
            let admin_state = state.admin_state.read().await;
            admin_state.is_public_registration_enabled()
        };
        if !registration_enabled {
            Vec::new()
        } else {
            let domains = state.store.list_domains().await?;
            let admin_state = state.admin_state.read().await;
            domains
                .into_iter()
                .filter(|domain| {
                    admin_state.is_domain_allowed_for_public_registration(&domain.domain)
                })
                .collect()
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

pub async fn update_domain(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<UpdateDomainRequest>,
) -> AppResult<Json<Domain>> {
    let user = admin_state::require_console_access(&headers, &state).await?;
    let domain_id = Uuid::parse_str(&id).map_err(|_| ApiError::validation("invalid domain id"))?;
    ensure_domain_access(&state, user, domain_id).await?;

    let is_shared = payload
        .is_shared
        .ok_or_else(|| ApiError::validation("domain sharing state is required"))?;
    let domain = state
        .store
        .update_domain_sharing(domain_id, is_shared)
        .await?;

    Ok(Json(domain))
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
    if let Err(error) = ensure_domain_access(&state, user.clone(), domain_id).await {
        if matches!(error, ApiError::NotFound(_)) {
            return Ok(StatusCode::NO_CONTENT);
        }
        return Err(error);
    }
    let config = state.effective_runtime_config().await;
    let owner_user_id = match state.store.domain_owner_user_id(domain_id).await {
        Ok(owner_user_id) => owner_user_id,
        Err(ApiError::NotFound(_)) => return Ok(StatusCode::NO_CONTENT),
        Err(error) => return Err(error),
    };
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
        let (domain_name, _) = match state.store.domain_verification_context(domain_id).await {
            Ok(context) => context,
            Err(ApiError::NotFound(_)) => return Ok(StatusCode::NO_CONTENT),
            Err(error) => return Err(error),
        };
        let records = match state.store.domain_dns_records(domain_id, &config).await {
            Ok(records) => records,
            Err(ApiError::NotFound(_)) => return Ok(StatusCode::NO_CONTENT),
            Err(error) => return Err(error),
        };
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
    match state.store.delete_domain(domain_id).await {
        Ok(()) => {}
        Err(ApiError::NotFound(_)) => return Ok(StatusCode::NO_CONTENT),
        Err(error) => return Err(error),
    }
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
    let current_domain = state.store.get_domain(domain_id).await?;
    let (domain_name, verification_token) =
        state.store.domain_verification_context(domain_id).await?;
    let records = state.store.domain_dns_records(domain_id, &config).await?;

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

    let domain = if current_domain.is_verified {
        current_domain
    } else {
        let verification_result =
            verify_domain_dns(&domain_name, &verification_token, &config).await;
        state
            .store
            .update_domain_verification_status(
                domain_id,
                verification_result.is_ok(),
                verification_result.err(),
            )
            .await?
    };

    Ok(Json(CloudflareDnsSyncResponse {
        domain: Some(domain),
        ..response
    }))
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

#[cfg(test)]
mod tests {
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use serde_json::{Value, json};
    use tower::ServiceExt;

    use super::*;
    use crate::{
        app::build_router,
        auth,
        config::Config,
        models::{ConsoleUser, ConsoleUserRole},
        state::AppState,
    };

    #[tokio::test]
    async fn admin_created_domains_are_not_shared_by_default() {
        let state = test_state(Config::default()).await;
        let admin = bootstrap_admin(&state, "correct12345").await;
        let session_token = issue_session_token(&state, &admin).await;

        let response = build_router(state)
            .oneshot(json_request(
                "/domains",
                json!({
                    "domain": "not-shared-by-default.example.com"
                }),
                &session_token,
            ))
            .await
            .expect("create domain response");

        assert_eq!(response.status(), StatusCode::CREATED);
        let body = response_body_json(response).await;
        assert_eq!(body.get("isShared").and_then(Value::as_bool), Some(false));
    }

    #[tokio::test]
    async fn deleting_missing_domain_is_idempotent() {
        let state = test_state(Config::default()).await;
        let admin = bootstrap_admin(&state, "correct12345").await;
        let session_token = issue_session_token(&state, &admin).await;
        let missing_domain_id = Uuid::new_v4();

        let response = build_router(state)
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/domains/{missing_domain_id}"))
                    .header("host", "localhost")
                    .header("authorization", format!("Bearer {session_token}"))
                    .body(Body::empty())
                    .expect("build delete request"),
            )
            .await
            .expect("delete domain response");

        assert_eq!(response.status(), StatusCode::NO_CONTENT);
    }

    async fn test_state(config: Config) -> AppState {
        let config = Config {
            cleanup_interval_seconds: 0,
            domain_verification_poll_interval_seconds: 0,
            ..config
        };

        crate::test_support::build_test_state(config, "routes-domains").await
    }

    async fn bootstrap_admin(state: &AppState, password: &str) -> ConsoleUser {
        let mut admin_state = state.admin_state.write().await;
        admin_state
            .bootstrap_first_admin("admin", password)
            .expect("bootstrap admin")
            .0
    }

    async fn issue_session_token(state: &AppState, user: &ConsoleUser) -> String {
        let user_id = Uuid::parse_str(&user.id).expect("parse admin user id");
        let admin_state = state.admin_state.read().await;
        let session_version = admin_state
            .current_session_version(user_id)
            .expect("load session version");
        auth::issue_console_session_token(
            user_id,
            &user.username,
            &ConsoleUserRole::Admin,
            session_version,
            &state.config,
        )
        .expect("issue console session token")
    }

    fn json_request(path: &str, payload: serde_json::Value, session_token: &str) -> Request<Body> {
        Request::builder()
            .method("POST")
            .uri(path)
            .header("host", "localhost")
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {session_token}"))
            .body(Body::from(payload.to_string()))
            .expect("build json request")
    }

    async fn response_body_json(response: axum::response::Response) -> Value {
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read response body");
        serde_json::from_slice(&body).expect("parse response body as json")
    }
}

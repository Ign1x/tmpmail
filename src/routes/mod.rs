pub mod accounts;
pub mod admin;
pub mod domains;
pub mod events;
pub mod health;
pub mod messages;
pub mod ops;

use axum::{
    Router,
    routing::{delete, get, patch, post},
};

use crate::state::AppState;

pub fn api_router() -> Router<AppState> {
    Router::new()
        .route("/healthz", get(health::health))
        .route("/readyz", get(health::ready))
        .route("/metrics", get(ops::metrics))
        .route("/site/update-notice", get(ops::public_update_notice))
        .route("/admin/status", get(admin::status))
        .route("/admin/setup", post(admin::setup))
        .route("/admin/login", post(admin::login))
        .route("/admin/session", get(admin::session))
        .route("/admin/recover", post(admin::recover))
        .route("/admin/access-key", get(admin::access_key))
        .route(
            "/admin/access-key/regenerate",
            post(admin::regenerate_access_key),
        )
        .route("/admin/password", post(admin::change_password))
        .route(
            "/admin/users",
            get(admin::list_users).post(admin::create_user),
        )
        .route(
            "/admin/users/{id}",
            patch(admin::update_user).delete(admin::delete_user),
        )
        .route(
            "/admin/users/{id}/password",
            post(admin::reset_user_password),
        )
        .route(
            "/admin/settings",
            get(admin::get_settings).post(admin::update_settings),
        )
        .route("/admin/metrics", get(ops::admin_metrics))
        .route("/admin/audit-logs", get(ops::admin_audit_logs))
        .route("/admin/cleanup", post(ops::trigger_cleanup))
        .route(
            "/domains",
            get(domains::list_domains).post(domains::create_domain),
        )
        .route("/domains/{id}", delete(domains::delete_domain))
        .route("/domains/{id}/records", get(domains::get_domain_records))
        .route("/domains/{id}/verify", post(domains::verify_domain))
        .route("/accounts", post(accounts::create_account))
        .route("/accounts/{id}", delete(accounts::delete_account))
        .route("/token", post(accounts::issue_token))
        .route("/me", get(accounts::me))
        .route("/messages", get(messages::list_messages))
        .route(
            "/messages/{id}",
            get(messages::get_message)
                .patch(messages::patch_message)
                .delete(messages::delete_message),
        )
        .route("/messages/{id}/raw", get(messages::download_message_raw))
        .route(
            "/messages/{id}/attachments/{attachment_id}",
            get(messages::download_attachment),
        )
}

pub fn stream_router() -> Router<AppState> {
    Router::new().route("/events", get(events::stream_events))
}

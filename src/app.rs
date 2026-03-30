use axum::Router;
use tower_http::trace::TraceLayer;

use crate::{routes, state::AppState};

pub fn build_router(state: AppState) -> Router {
    routes::router()
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

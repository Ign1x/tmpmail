# BACKEND CORE NOTES

## Scope
- Applies to `src/`.
- `src/routes/AGENTS.md` overrides route-layer rules.
- Root `AGENTS.md` still owns repo-wide workflow, verification, and ignore rules.

## Overview
Backend core modules own config, state, storage, workers, auth, and domain logic. Route-specific HTTP contracts live in `src/routes/`.

## High-signal entry points
- `main.rs` — load `Config`, build `AppState`, spawn ingest/domain/cleanup workers, serve Axum
- `app.rs` — apply timeout/load-shed/concurrency protection to `api_router()`, then merge `stream_router()`
- `state.rs` — `AppState` holds config, `admin_state`, `store`, metrics, realtime, optional Inbucket client
- `config.rs` — env parsing, normalization, defaults, clamps, bind-address derivation

## Filesets
- Storage — `app_store.rs`, `store.rs`, `pg_store.rs`
- Admin/auth — `admin_state.rs`, `auth.rs`
- Domain lifecycle — `domain_management.rs`, `domain_worker.rs`
- Workers/integrations — `ingest.rs`, `cleanup_worker.rs`, `inbucket.rs`, `realtime.rs`, `metrics.rs`
- Shared shapes — `models.rs`, `error.rs`

## Invariants
- Preserve behavior parity between `MemoryStore` and `PgStore`; `AppStore` is the abstraction seam.
- Business data lives in `AppStore`; console users/settings/API keys live in `AdminStateStore`.
- Domain code should use `effective_runtime_config()` when admin-managed overrides can affect DNS or routing behavior.
- `PgStore` owns startup migrations, readiness, and one-time snapshot import into empty databases.
- Background jobs should favor `try_lock_store_for_background()` semantics over long blocking store locks.
- Keep legacy placeholder behavior out of active config flow; `mail.tmpmail.local` is treated as stale.
- Worker toggles and poll intervals are config-driven; zero or disabled values intentionally prevent spawning.

## Quick commands
```bash
cargo test
cargo build --release
docker compose --profile postgres up -d postgres
```

## Verification
- Storage/schema changes — test happy path plus migration/restore behavior.
- Config/auth changes — verify `/readyz`, secure-admin transport expectations, and relevant smoke flows.
- Ingest/domain/cleanup changes — confirm background-worker behavior from `main.rs` startup gates.

## Read next
- `src/routes/AGENTS.md` — auth matrix, route groups, SSE rules, audit/realtime side effects

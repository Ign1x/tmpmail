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
- Storage — `app_store.rs`, `pg_store.rs`
- Admin/auth — `admin_state.rs`, `auth.rs`
- Domain lifecycle — `domain_management.rs`, `domain_worker.rs`
- Workers/integrations — `ingest.rs`, `cleanup_worker.rs`, `inbucket.rs`, `realtime.rs`, `metrics.rs`
- Shared shapes — `models.rs`, `error.rs`

## Invariants
- `AppStore` is a PostgreSQL facade; do not reintroduce an in-memory or file-backed fallback.
- `AppStore` owns its backend-specific concurrency; do not reintroduce a global outer mutex around it.
- Business data lives in `AppStore`; console users/settings/API keys/Cloudflare credentials live in `AdminStateStore`.
- OTP state lives in `otp.rs` and persists through the `otp_codes` table.
- Linux Do client secrets can be seeded from `TMPMAIL_LINUX_DO_CLIENT_SECRET`; `AdminStateStore` persists the secret separately in PostgreSQL.
- Domain code should use `effective_runtime_config()` when admin-managed overrides can affect DNS or routing behavior.
- PostgreSQL startup applies repo migrations once; there is no legacy JSON import path anymore.
- `Config::from_env()` should accept either an explicit `TMPMAIL_DATABASE_URL` or the bundled compose `TMPMAIL_POSTGRES_*` settings; keep the default same-host compose path zero-friction.
- Background jobs should favor `try_lock_store_for_background()` semantics over long blocking work; the helper is now a background scheduling gate, not a user-request mutex.
- Keep legacy placeholder behavior out of active config flow; `mail.tmpmail.local` is treated as stale.
- Worker toggles and poll intervals are config-driven; zero or disabled values intentionally prevent spawning.
- SSE capacity is config-driven; `TMPMAIL_SSE_CONNECTION_LIMIT` protects the stream router because `/events` does not inherit the normal API concurrency layer.
- Console session JWTs are versioned against the user's current password state; password changes and recovery resets must invalidate older session tokens immediately.
- Runtime startup should reject weak placeholder JWT secrets unless `TMPMAIL_ALLOW_INSECURE_DEV_SECRETS=true` is explicitly set, and `TMPMAIL_ADMIN_PASSWORD` must respect `TMPMAIL_ADMIN_PASSWORD_MODE`.
- Forwarded proxy headers are untrusted by default; only let auth, rate limits, or callback-origin checks honor `X-Forwarded-*` / `Forwarded` when `TMPMAIL_TRUST_PROXY_HEADERS=true`.

## Quick commands
```bash
cargo test
cargo build --release
docker compose up -d --build
```

## Verification
- Storage/schema changes — test happy path plus migration/restore behavior.
- Config/auth changes — verify `/readyz`, secure-admin transport expectations, and relevant smoke flows.
- Ingest/domain/cleanup changes — confirm background-worker behavior from `main.rs` startup gates.

## Read next
- `src/routes/AGENTS.md` — auth matrix, route groups, SSE rules, audit/realtime side effects

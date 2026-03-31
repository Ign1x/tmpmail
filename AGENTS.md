# PROJECT KNOWLEDGE BASE

**Generated:** 2026-03-31 21:38:42 CST  
**Commit:** 3afb500  
**Branch:** main

## Scope
- Applies repo-wide.
- Nearest child `AGENTS.md` overrides local work.
- Read next: `src/AGENTS.md`, `src/routes/AGENTS.md`, `frontend/AGENTS.md`, `frontend/app/AGENTS.md`, `frontend/lib/AGENTS.md`.

## Overview
TmpMail is a Rust Axum API plus a Next.js App Router frontend. Default persistence is in-memory state plus JSON snapshots under `data/`; setting `TMPMAIL_DATABASE_URL` switches the backend to PostgreSQL and startup runs migrations plus one-time snapshot import when the database is empty.

## Structure
```text
.
├── src/                 # Rust backend core, workers, auth, storage, routes
├── migrations/          # PostgreSQL schema
├── frontend/            # Next.js app, proxies, UI, i18n
├── scripts/             # Preferred local dev + smoke + Inbucket generator
├── Dockerfile           # API image
├── frontend/Dockerfile  # Frontend image
├── compose.yaml         # Local orchestration + health checks
├── .env.example         # Canonical env template
├── README.md            # Operational behavior and deployment notes
└── data/                # Runtime state only; ignored
```

## Where to look
| Task | Location | Notes |
|---|---|---|
| Bring the stack up/down | `scripts/dev-up.sh`, `scripts/dev-down.sh`, `compose.yaml` | Docker-first local workflow |
| Backend startup | `src/main.rs`, `src/app.rs` | Config, worker spawning, router assembly |
| HTTP route map | `src/routes/mod.rs` | `api_router()` vs `stream_router()` |
| Storage backend switch | `src/app_store.rs`, `src/store.rs`, `src/pg_store.rs` | Memory snapshot vs PostgreSQL |
| Runtime overrides | `src/config.rs`, `src/admin_state.rs` | Env parsing plus persisted admin overrides |
| Frontend shell | `frontend/app/[locale]/layout.tsx`, `frontend/app/[locale]/page.tsx` | Locale shell, providers, inbox/guest flow |
| Frontend proxy edges | `frontend/app/api/mail/route.ts`, `frontend/app/api/sse/route.ts` | REST proxy vs SSE proxy |
| Configurable admin path | `frontend/proxy.ts`, `frontend/lib/admin-entry.ts` | Never assume `/admin` is fixed |
| Frontend transport/helpers | `frontend/lib/api.ts` | Central fetch, errors, session-adjacent helpers |
| Minimal end-to-end validation | `scripts/smoke.sh` | Health, auth, inbox, raw message, frontend `/en` |

## Code map
| Symbol | Type | Location | Refs | Role |
|---|---|---|---:|---|
| `build_router` | fn | `src/app.rs` | 6 | Merges protected API routes with the separate stream router |
| `api_router` | fn | `src/routes/mod.rs` | 2 | Canonical REST route table |
| `AppStore` | enum | `src/app_store.rs` | 67 | Memory/PostgreSQL facade used across routes and workers |
| `AuthProvider` | component | `frontend/contexts/auth-context.tsx` | 4 | Frontend auth state boundary mounted from locale layout |

## Shared verification
- Backend changes: `cargo test` and `cargo build --release`
- Frontend changes: `cd frontend && npm run lint`
- Frontend route/env/proxy changes: also run `cd frontend && npm run build`
- Repo-level sanity: `./scripts/smoke.sh`
- Storage or schema changes: verify happy path plus migration/restore behavior

## Conventions
- Prefer `./scripts/dev-up.sh` and `./scripts/dev-down.sh`; `dev-up` auto-creates `.env` from `.env.example`.
- `.env.example` is the source of truth for new settings. Update `README.md` when admin, JWT, transport, or deployment knobs change.
- Env namespaces are deliberate: `TMPMAIL_*` backend/runtime, `NEXT_PUBLIC_TMPMAIL_*` browser-visible frontend, `INBUCKET_*` deploy-script inputs.
- Localized frontend entrypoints are `/zh` and `/en`; the default locale is `zh`.
- Frontend page files stay thin. Heavy UI lives in `frontend/components/`; shared fetch/session/config logic lives in `frontend/lib/`.
- There is no dedicated frontend test harness; lint/build/smoke are the expected safety net.

## Collaboration
- Commit subjects follow the existing repo style: short, imperative Chinese.
- PRs should call out user-visible impact, config or migration changes, and manual verification steps.
- Include screenshots for UI/admin changes.
- When config surfaces change, mention `.env.example`, `compose.yaml`, `README.md`, and `migrations/` updates explicitly.

## Anti-patterns
- Do not edit `DuckMail/` as if it were live code. The active frontend is `frontend/`.
- Do not commit `.env`, `data/`, `inbucket.compose.yml`, `inbucket.env`, or `inbucket-data/`.
- Do not assume `cargo run` reads `.env`; the Rust binary reads process env directly.
- Do not assume `docker compose --profile postgres up -d postgres` alone enables PostgreSQL mode; `TMPMAIL_DATABASE_URL` controls backend selection.
- Do not assume env always wins over persisted admin-state overrides for mail/DNS behavior.
- Do not hardcode `/admin`; `TMPMAIL_ADMIN_ENTRY_PATH` and `frontend/proxy.ts` can rewrite public admin paths.

## Commands
```bash
cp .env.example .env
./scripts/dev-up.sh
./scripts/dev-down.sh
./scripts/smoke.sh
cargo test
cargo build --release
cd frontend && npm ci && npm run lint
cd frontend && npm run build
docker compose --profile postgres up -d postgres
```

## Notes
- `frontend/Dockerfile` uses `npm ci --legacy-peer-deps`; local docs still use plain `npm ci`.
- If PostgreSQL starts with an empty database and snapshot state exists, backend startup may import JSON state automatically.
- `scripts/dev-up.sh` always prints `/admin` even if `TMPMAIL_ADMIN_ENTRY_PATH` changes.
- `deploy/inbucket/` and root-level generated `inbucket*` files are not the source of truth; `scripts/inbucket-deploy.sh` is.

## Update policy
If boundaries, commands, env knobs, routing, or verification rules change, update the nearest `AGENTS.md` in the same PR.

# ROUTE LAYER NOTES

## Scope
- Applies to `src/routes/`.
- Root `AGENTS.md` owns repo-wide workflow; `src/AGENTS.md` owns backend-core invariants outside the HTTP edge.

## Overview
This directory is the HTTP edge. Keep handlers thin; storage, domain, auth, and worker policy belong in sibling backend modules unless the concern is explicitly route-only.

## Entry points
- `mod.rs` — canonical route registry
- `api_router()` — health, metrics, admin, domains, accounts, messages
- `stream_router()` — `/events` only

## Route groups
| Surface | File | Notes |
|---|---|---|
| Health/readiness | `health.rs` | Public liveness and backend-aware readiness |
| Ops/public notice | `ops.rs` | Public `/metrics`, public update notice, admin metrics/audit/cleanup |
| Admin console | `admin.rs` | Bootstrap, login, session, recovery, users, settings, access keys |
| Managed domains | `domains.rs` | Public listing plus console-scoped create/verify/delete |
| Accounts | `accounts.rs` | Create mailbox, issue token, self lookup, self delete |
| Messages | `messages.rs` | List/get/patch/delete plus raw/attachment download |
| Events | `events.rs` | Account-scoped SSE stream |

## Auth matrix
- `admin/status` is public.
- `admin/setup`, `admin/login`, and `admin/recover` require secure admin transport.
- Admin session, user, settings, metrics, audit-log, and cleanup flows use console credentials and admin guards where required.
- `GET /domains` is public when unauthenticated; console auth scopes results by owner/admin.
- Domain mutations require console access.
- Accounts, tokens, `/me`, and `messages/*` use mailbox bearer tokens.
- `/events` uses mailbox bearer tokens and rejects `accountId` mismatches.

## Conventions
- Update `mod.rs` whenever you add or move a route.
- Validate UUID/path/query inputs early and keep `ApiError` response patterns consistent.
- Admin mutations usually append audit logs.
- Message patch/delete must preserve realtime publish behavior.
- Keep streaming endpoints in `stream_router()`; SSE intentionally sits outside the protected API middleware path.
- Public `/metrics` and `/site/update-notice` live beside admin-only ops endpoints in `ops.rs`; do not merge their auth behavior.

## Verification
- `cargo test` for route-adjacent modules; `messages.rs` already carries route-focused tests.
- `./scripts/smoke.sh` for account, token, message-list, and raw-download flow.
- When auth rules change, manually verify the intended public vs console vs mailbox-token boundary.

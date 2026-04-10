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
| Ops/public notice | `ops.rs` | Public `/metrics`, `/site/branding`, public update notice, admin metrics/audit/cleanup |
| Admin console | `admin.rs` | Bootstrap, login, session, recovery, Linux Do auth, users, settings, access keys, invite codes |
| Managed domains | `domains.rs` | Public listing plus console-scoped create/verify/delete/share-state updates |
| Accounts | `accounts.rs` | Console-owned mailbox listing/create/token issuance plus legacy mailbox token login/self delete |
| Messages | `messages.rs` | List/get/patch/delete plus raw/attachment download |
| Events | `events.rs` | Account-scoped SSE stream |

## Auth matrix
- `admin/status` is public.
- `admin/linux-do/authorize` and `admin/linux-do/complete` are public-facing registration helpers, but still require secure admin transport and the Linux Do registration feature to be enabled.
- Linux Do redirect URIs must either match the configured callback allowlist exactly or stay same-origin with the current admin request; keep `state` validation strict.
- `admin/setup`, `admin/login`, and `admin/recover` require secure admin transport.
- `admin/register`, `admin/register/otp`, and first-time `admin/linux-do/complete` must honor invite-code requirements when public member signup is configured as invite-only. `admin/linux-do/authorize` should stay invite-agnostic so existing Linux Do users can complete the OAuth round trip before new-user invite gating kicks in.
- `admin/login`, `admin/recover`, and public `POST /token` also enforce fixed-window brute-force throttling.
- `admin/register/otp` and `accounts/otp` enforce IP-scoped OTP send throttling; OTP verification also expires codes after too many wrong attempts.
- Session-only console endpoints must reject stale JWTs after password or recovery changes; do not treat console session TTL as the only revocation mechanism.
- Admin session, user, settings, metrics, audit-log, and cleanup flows use console credentials and admin guards where required.
- `GET /domains` is public when unauthenticated; console auth returns all managed domains for admins, and for regular users it returns both domains they own plus active shared domains from other users.
- Domain mutations require console access; `PATCH /domains/{id}` toggles the owner/admin-managed sharing state exposed to other console users.
- `DELETE /domains/{id}` should stay idempotent: missing managed domains collapse to `204 No Content`, while real authorization failures still return `403`.
- `GET /accounts`, console-auth `POST /accounts`, `POST /accounts/{id}/token`, and console-auth `DELETE /accounts/{id}` use console session and mailbox ownership checks.
- Public `POST /accounts`, `/token`, `/accounts/me`, mailbox-token `DELETE /accounts/{id}`, and `messages/*` remain available for legacy mailbox-token flows.
- `/events` uses mailbox bearer tokens, rejects `accountId` mismatches, and enforces the config-driven `TMPMAIL_SSE_CONNECTION_LIMIT`.

## Conventions
- Update `mod.rs` whenever you add or move a route.
- Validate UUID/path/query inputs early and keep `ApiError` response patterns consistent.
- Admin mutations usually append audit logs.
- Managed-domain deletion now also attempts Cloudflare DNS cleanup when the owning console user still has Cloudflare enabled with a saved token; keep that behavior in the route edge so non-frontend clients get the same cleanup.
- `GET /admin/access-key` is read-only metadata now; only explicit create/regenerate endpoints may mint a new plaintext API key.
- Invite-code plaintext must only be returned from the explicit create endpoint; list/update/delete flows stay metadata-only.
- Message patch/delete must preserve realtime publish behavior.
- Sensitive auth surfaces should keep abuse controls close to the route edge; current fixed-window throttling covers `/admin/login`, `/admin/recover`, and `/token`.
- OTP abuse controls are split intentionally: send throttling stays at the route edge, while wrong-code attempt caps live in `otp.rs` so both registration flows share the same rules.
- Keep streaming endpoints in `stream_router()`; SSE intentionally sits outside the protected API middleware path, so abuse protection belongs in the route or shared metrics layer.
- Public `/metrics`, `/site/branding`, and `/site/update-notice` live beside admin-only ops endpoints in `ops.rs`; `/metrics` may be config-disabled, but do not merge its auth behavior with admin ops.

## Verification
- `cargo test` for route-adjacent modules; `messages.rs` already carries route-focused tests.
- `./scripts/smoke.sh` for account, token, message-list, and raw-download flow.
- When auth rules change, manually verify the intended public vs console vs mailbox-token boundary.

# FRONTEND LIB NOTES

## Scope
- Applies to `frontend/lib/`.
- Root and `frontend/AGENTS.md` still own broader frontend defaults.

## Overview
This directory owns cross-cutting runtime helpers: transport, session, config, storage, and path generation. `api.ts` is the highest-signal file here.

## High-signal files
- `api.ts` — central client transport surface, request helpers, error shaping, retry/timeout behavior, and admin/API wrappers
- `provider-config.ts` — default provider, branding, and API-base env helpers
- `site-branding.ts`, `site-branding-server.ts` — runtime site-name/logo resolution plus public-branding server fetch
- `admin-entry.ts` — configurable admin path helpers; source of truth for public/admin route generation
- `admin-session.ts` — client-side admin session presence and ephemeral revealed-key helpers
- `admin-session-server.ts` — Next route-handler cookie helpers for the HttpOnly admin session
- `admin-server-session.ts` — server-side admin-session cookie presence helper for workspace SSR

## Rules
- Put shared fetch/auth/error/proxy helpers here, not in page components.
- Reuse the existing `api.ts` request wrappers before adding new ad hoc fetch code.
- Keep browser storage parsing defensive; clear invalid or expired session state instead of trusting it.
- Prefer env helper functions (`provider-config.ts`, `admin-entry.ts`) over scattered direct `process.env` reads.
- If you add a new frontend env knob here, update `.env.example`, `compose.yaml`, and `README.md` instead of leaving it code-only.
- Server-side validation helpers must only trust forwarded proto/host when `TMPMAIL_TRUST_PROXY_HEADERS=true`; direct browser requests must not be able to spoof proxy metadata.
- Console JWTs must stay inside the Next HttpOnly cookie path; browser code may only track non-sensitive session presence or one-time revealed secrets.
- Treat `package.json` as pinned operational input, not a place for new `latest` drift; keep access-key wrappers aligned with the backend contract where `GET /admin/access-key` no longer returns a plaintext secret.

## Verification
```bash
cd frontend && npm run lint
cd frontend && npm run build
```

If these files change, also verify the affected login/admin/proxy flow manually or through `./scripts/smoke.sh` when applicable.

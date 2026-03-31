# FRONTEND LIB NOTES

## Scope
- Applies to `frontend/lib/`.
- Root and `frontend/AGENTS.md` still own broader frontend defaults.

## Overview
This directory owns cross-cutting runtime helpers: transport, session, config, storage, and path generation. `api.ts` is the highest-signal file here.

## High-signal files
- `api.ts` — central client transport surface, request helpers, error shaping, retry/timeout behavior, and admin/API wrappers
- `provider-config.ts` — default provider, branding, and API-base env helpers
- `admin-entry.ts` — configurable admin path helpers; source of truth for public/admin route generation
- `admin-session.ts` — client session, cookie, and sessionStorage helpers
- `admin-server-session.ts` — server-side session validation against `/admin/session`

## Rules
- Put shared fetch/auth/error/proxy helpers here, not in page components.
- Reuse the existing `api.ts` request wrappers before adding new ad hoc fetch code.
- Keep browser storage parsing defensive; clear invalid or expired session state instead of trusting it.
- Prefer env helper functions (`provider-config.ts`, `admin-entry.ts`) over scattered direct `process.env` reads.
- If you add a new frontend env knob here, update `.env.example`, `compose.yaml`, and `README.md` instead of leaving it code-only.
- Server-side validation helpers must preserve forwarded proto/host when calling the backend.
- Admin session state is intentionally split between cookie and sessionStorage; keep both paths in sync.

## Verification
```bash
cd frontend && npm run lint
cd frontend && npm run build
```

If these files change, also verify the affected login/admin/proxy flow manually or through `./scripts/smoke.sh` when applicable.

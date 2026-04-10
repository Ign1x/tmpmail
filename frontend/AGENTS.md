# FRONTEND LAYER NOTES

## Scope
- Applies to `frontend/`.
- `frontend/app/AGENTS.md` overrides App Router and route-handler rules.
- `frontend/lib/AGENTS.md` overrides helper/API/session/config rules.

## Overview
This directory holds the live Next.js frontend. Treat `frontend/` as authoritative.

## Entry points
- `app/[locale]/layout.tsx` — locale validation plus provider stack
- `app/[locale]/page.tsx` — app-shell mount and inbox/guest flow
- `proxy.ts` — locale middleware and configurable admin-path rewrites
- `package.json` — Node `>=20.9.0`, `eslint .`, no frontend test script

## Layering
- `app/` — route wrappers, server entrypoints, Next route handlers
- `components/` — app UI surfaces; keep domain-heavy screens here, not in route files
- `lib/` — API, session, config, and storage helpers
- `contexts/` — auth and mail-status state boundaries
- `hooks/` — canonical `use-*` hooks; prefer `frontend/hooks/use-mobile.tsx` over the duplicate UI copy
- `messages/` — translation catalogs only; large files here are content, not code complexity

## Conventions
- Supported locales are `zh` and `en`; default locale is `zh`.
- Do not hardcode `/admin`; use `admin-entry` helpers because `TMPMAIL_ADMIN_ENTRY_PATH` can rewrite public paths.
- Browser-visible envs use `NEXT_PUBLIC_TMPMAIL_*`; server-only frontend envs use `TMPMAIL_*`.
- `AppShell` uses `components/sidebar.tsx`; `components/ui/sidebar.tsx` is generic primitive code, not the app navigation source of truth.
- Legacy multi-provider browser storage is being cleaned up; prefer the current single-provider defaults/helpers.

## Verification
```bash
cd frontend && npm run lint
cd frontend && npm run build
./scripts/smoke.sh
```

## Avoid
- Putting business logic into `components/ui/*`
- Splitting active frontend code across multiple parallel app trees
- Treating `messages/*.json` size as frontend architecture

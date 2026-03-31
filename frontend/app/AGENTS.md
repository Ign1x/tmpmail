# APP ROUTER NOTES

## Scope
- Applies to `frontend/app/`.
- Root and `frontend/AGENTS.md` still own repo-wide and frontend-wide defaults.

## Overview
This directory owns localized page routes and Next server route handlers. Keep page files thin and treat proxy handlers as backend-edge code running inside Next.

## Entry points
- `[locale]/layout.tsx` — locale validation, metadata, `NextIntlClientProvider`, `AuthProvider`, `MailStatusProvider`
- `[locale]/page.tsx` — `AppShell` mount plus inbox/guest overview flow
- `[locale]/admin/page.tsx` and `[locale]/admin/console/page.tsx` — thin server wrappers with redirect/session gating
- `api/mail/route.ts` — REST-style backend proxy
- `api/sse/route.ts` — SSE proxy
- `../proxy.ts` — rewrites configurable admin entry paths into localized routes

## Route rules
- Use `generateStaticParams`, `setRequestLocale`, and shared `routing.locales`; do not invent ad hoc locale plumbing.
- Keep leaf pages thin; move heavy UI/workflow logic into `components/` and shared helpers into `lib/`.
- Do not hardcode `/admin` or `/admin/console`; use `getAdminEntryPath()` and related helpers.
- Admin route wrappers should stay redirect/session focused; shared admin UI lives outside `app/`.
- `/domains` is a compatibility redirect surface, not a second domain-management UI.

## API proxy rules
- `/api/mail` only forwards safe relative `?endpoint=/...` values: no scheme, no `//`, no whitespace.
- Preserve `Authorization`, `X-Forwarded-Proto`, and `X-Forwarded-Host` when proxying to backend.
- Keep `cache: "no-store"` behavior and strip hop-by-hop response headers.
- `/api/sse` is `force-dynamic`, requires auth plus `accountId`, and proxies backend `/events`.

## Verification
```bash
cd frontend && npm run lint
cd frontend && npm run build
./scripts/smoke.sh
```

Manual checks matter here: `/en` should render, admin redirects should respect the configured entry path, and proxy routes should still reach the backend with forwarded headers intact.

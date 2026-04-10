# APP ROUTER NOTES

## Scope
- Applies to `frontend/app/`.
- Root and `frontend/AGENTS.md` still own repo-wide and frontend-wide defaults.

## Overview
This directory owns localized page routes and Next server route handlers. Keep page files thin and treat proxy handlers as backend-edge code running inside Next.

## Entry points
- `[locale]/layout.tsx` — locale validation, metadata, `NextIntlClientProvider`, `AuthProvider`, `MailStatusProvider`
- `[locale]/page.tsx` — canonical unified workspace route; renders the TmpMail unified sign-in/setup entry when logged out and the workspace when a console session is present
- `[locale]/auth/linux-do/page.tsx` — localized Linux Do OAuth callback wrapper; keep it thin and push callback logic into `components/`
- `auth/linux-do/route.ts` — locale-free Linux Do OAuth callback compatibility entry; redirect into the localized callback route while preserving query params
- `[locale]/admin/page.tsx` — legacy compatibility redirect to the localized home route
- `[locale]/admin/console/page.tsx` — legacy compatibility redirect to the localized home route
- `api/mail/route.ts` — REST-style backend proxy
- `api/sse/route.ts` — SSE proxy
- `../proxy.ts` — rewrites configurable admin entry paths into localized routes

## Route rules
- Use `generateStaticParams`, `setRequestLocale`, and shared `routing.locales`; do not invent ad hoc locale plumbing.
- Keep leaf pages thin; move heavy UI/workflow logic into `components/` and shared helpers into `lib/`.
- Treat `/${locale}` as the canonical workspace URL. `/admin`, `/admin/console`, and configurable admin-entry aliases are compatibility redirects only.
- Keep Linux Do callback handling on a localized route under `/${locale}/auth/*`; the locale-free `/auth/linux-do` entry exists only as an OAuth compatibility redirect into that localized route.
- Root and legacy compatibility route wrappers should stay redirect/session focused; shared unified console UI lives outside `app/`.
- `/domains` is a compatibility redirect surface, not a second domain-management UI.

## API proxy rules
- `/api/mail` only forwards safe relative `?endpoint=/...` values: no scheme, no `//`, no whitespace.
- Preserve `Authorization` when proxying to backend. Only forward `X-Forwarded-*` values when `TMPMAIL_TRUST_PROXY_HEADERS=true`; direct browser requests must not be able to spoof secure transport or origin metadata.
- Console-auth browser requests should use the shared admin-session header path so `/api/mail` can inject the HttpOnly cookie server-side and redact returned `sessionToken` fields before they reach JavaScript.
- Keep `cache: "no-store"` behavior and strip hop-by-hop response headers.
- `/api/admin/session` is the dedicated logout surface for clearing the HttpOnly console-session cookie.
- `/api/sse` is `force-dynamic`, requires auth plus `accountId`, and proxies backend `/events`.

## Verification
```bash
cd frontend && npm run lint
cd frontend && npm run build
./scripts/smoke.sh
```

Manual checks matter here: `/en` should render the unified workspace entry directly, Linux Do auth should round-trip back to `/${locale}/auth/linux-do` and then land on `/${locale}` for existing users while first-time invite-only signups can finish by entering the invite code on the callback page, legacy admin paths should collapse back to the localized home route, and proxy routes should still reach the backend with forwarded headers intact.

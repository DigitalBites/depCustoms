# Customs Dashboard Service

Scope: `services/dashboard`

## Overview

The dashboard service is the Customs browser UI. It provides tenant and project
management, policy and security workflows, proxy registration, events,
performance views, account and session flows, and the browser-facing auth and
same-origin proxy behaviors used in local and selected deployment modes.

## Quick Start

For the overall OSS stack and bundled deployment, start at the
[root README](../../README.md).

For local dashboard-only development:

```bash
npm install
npm run dev
```

The dashboard depends on the API and auth services for meaningful local use.

## Tech Stack

- TypeScript / Node.js
- Next.js App Router
- Tailwind CSS
- Vitest
- ESLint

## What This Service Does

- renders the authenticated Customs dashboard UI with Next.js App Router
- handles login, OAuth callback, tenant selection, and dashboard shell routing
- calls the Customs API through shared browser helpers
- proxies browser-facing SSE requests through server routes under `src/app`
- optionally proxies `/v1/*` and `/auth/v1/*` same-origin when enabled
- centralizes dashboard auth and session loading, role checks, redirect safety,
  and URL safety
- uses feature-owned `api.ts`, `hooks.ts`, `types.ts`, and components for the
  major dashboard domains

## Runtime Surfaces

### User-Facing Routes

Current dashboard route groups include:

- `/login`
- `/auth/callback`
- `/auth/select-tenant`
- `/projects`
- `/events`
- `/performance`
- `/policy-engine/*`
- `/security`
- `/proxies`
- `/settings`
- `/users/*`
- `/violations/*`
- `/mcp`

### Server-Side Route Handlers

The dashboard also owns several server-side route handlers:

- `src/app/auth/callback/route.ts`
  - exchanges OAuth and PKCE auth codes for sessions and redirects multi-tenant
    users to `/auth/select-tenant`
- `src/app/v1/events/stream/route.ts`
  - same-origin SSE proxy for tenant-wide event streams
- `src/app/v1/projects/[project_id]/events/stream/route.ts`
  - same-origin SSE proxy for project-scoped event streams

When `DASHBOARD_API_PROXY_ENABLED=true` and `API_INTERNAL_URL` is configured,
`next.config.ts` rewrites browser API and auth traffic to same-origin runtime
paths. The SSE routes remain intentionally proxied through the dashboard even
when those flags are disabled, because the browser `EventSource` path cannot
attach the API bearer token directly.

## Authentication Model

- browser auth uses Supabase and GoTrue through the configured auth URL
- server auth and session loading are centralized in `src/lib/dashboard-auth.ts`
- JWT app metadata parsing is centralized in `src/lib/jwt-metadata.ts`
- multi-tenant users select their active tenant through `/auth/select-tenant`
- preferred-tenant switching is shared through `src/lib/tenant-switch.ts`
- SSE proxy routes use the narrower server-side
  `requireDashboardAccessToken()` helper instead of leaking raw access tokens
  through generic auth context
- the dashboard UI is **capability-gated, not role-gated**: navigation
  items, action buttons, and entire feature surfaces are conditionally
  rendered based on the capabilities the API attaches to the active
  session. Adding a new gated surface should reference a capability key
  rather than checking the role string directly, so changes to the
  role-to-capability mapping in the API stay authoritative

For the canonical role hierarchy, the full capability list, and how
capabilities are evaluated server-side, see the
[API service README](../../services/api/README.md#authentication--authorization-model).

## Development

### Install

```bash
npm install
```

### Run Locally

```bash
npm run dev
```

Default port: `3001`

### Build

```bash
npm run build
```

### Tests

```bash
npm test
```

## Configuration

The dashboard reads configuration from `src/config.ts`, `next.config.ts`, and
the runtime public-config injection path.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3001` | Dashboard listen port used by `next dev` and the standalone runtime. |
| `NODE_ENV` | Next.js-managed | Standard Next.js runtime mode. Controls production vs. report-only CSP behavior in `next.config.ts`. |
| `NEXT_PUBLIC_AUTH_URL` | empty | Browser-visible auth base URL used by the client runtime unless same-origin auth proxying is enabled. |
| `NEXT_PUBLIC_GOTRUE_ANON_KEY` | empty | Browser-visible GoTrue and Supabase anon key used by the dashboard auth client. |
| `AUTH_INTERNAL_URL` | falls back to `AUTH_URL`, then `NEXT_PUBLIC_AUTH_URL`, then empty | Preferred server-only auth URL for middleware, SSR auth checks, and server-side session refresh. |
| `AUTH_URL` | empty | Legacy server-side auth URL fallback when `AUTH_INTERNAL_URL` is not set. |
| `NEXT_PUBLIC_API_URL` | empty | Browser-visible Customs API base URL used by the client runtime unless same-origin API proxying is enabled. |
| `API_INTERNAL_URL` | empty | Server-only internal API URL used for Next.js rewrites and dashboard SSE proxy fetches. |
| `PUBLIC_ORIGIN` | empty | Explicit dashboard public origin used by same-origin validation helpers for cookie-setting and consent routes. |
| `AUTH_PROXY_ENABLED` | `false` unless set to `true` | When enabled, public runtime config resolves browser auth traffic to the dashboard’s own origin instead of `NEXT_PUBLIC_AUTH_URL`. |
| `DASHBOARD_API_PROXY_ENABLED` | `false` unless set to `true` | When enabled, Next.js rewrites `/v1/*`, `/internal/*`, `/auth/v1/*`, `/oauth/*`, and related discovery routes to `API_INTERNAL_URL`, and public runtime config resolves browser API traffic to the dashboard’s own origin. |

## Important Operational Notes

- `NEXT_PUBLIC_*` values are public values; server-only variables are only
  available on the server
- the dashboard uses a runtime public-config injection script for browser code,
  but `next.config.ts` still influences CSP and rewrite behavior at build and
  startup time
- server-side auth should prefer `AUTH_INTERNAL_URL` when the dashboard can
  reach auth through an internal network path
- changing `NEXT_PUBLIC_*` values may require a rebuild depending on which
  paths still rely on `next.config.ts`
- production and development security header behavior is defined in
  `next.config.ts` via `src/lib/csp.ts`
- SSE browser traffic should go through the dashboard’s own `/v1/.../stream`
  routes, not directly to the API

## Code Organization

- `src/app/`
  - route entrypoints, layouts, auth callback, tenant selection, and SSE proxy
    routes
- `src/features/`
  - feature-owned `api.ts`, `hooks.ts`, `types.ts`, and feature components
- `src/components/`
  - shared UI, layout, feedback, and cross-feature components
- `src/lib/`
  - shared auth, API, redirect and URL safety, nav and authorization, CSP, and
    Supabase helpers
- `src/hooks/`
  - intentionally shared cross-feature hooks

## Further Reading

- [Root README](../../README.md)
- [OSS Architecture](../../docs/architecture.md)
- [AGENTS.md](AGENTS.md)

## Technical Debt

- The dashboard still has a mixed runtime-config story: some public values are
  injected at request time, while some deployment behavior still depends on
  `next.config.ts`. This should be reviewed before broadly distributing
  prebuilt dashboard containers.

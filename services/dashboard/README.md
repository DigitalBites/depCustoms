# Customs Dashboard Service

Scope: `services/dashboard`

This service is the Next.js dashboard for Customs. It provides the browser UI for tenant/project management, policy and security workflows, proxy registration, events, performance views, and account/session flows. It also owns the browser-facing auth integration and the same-origin API/SSE proxy behavior used in local and selected deployment modes.

## What This Service Does

- renders the authenticated Customs dashboard UI with Next.js App Router
- handles login, OAuth callback, tenant selection, and dashboard shell routing
- calls the Customs API through shared browser helpers
- proxies `/v1/*` and `/auth/v1/*` same-origin in local/dev when enabled
- proxies browser-facing SSE requests through server routes under `src/app/v1/...`
- centralizes dashboard auth/session loading, role checks, redirect safety, and URL safety
- uses feature-owned `api.ts`, `hooks.ts`, `types.ts`, and components for the major dashboard domains

## Main User-Facing Areas

Current dashboard route groups include:

- `/login`
  - sign-in flow
- `/auth/callback`
  - OAuth/PKCE callback handling
- `/auth/select-tenant`
  - multi-tenant selection flow
- `/projects`
  - project list and project-scoped views
- `/events`
  - event views
- `/performance`
  - performance/metrics view
- `/policy-engine/*`
  - policies, policy detail, rule editing, connectors
- `/security`
  - tenant-level security views
- `/proxies`
  - proxy registration/management
- `/settings`
  - tenant settings / entitlements
- `/users/*`
  - members and invite flows
- `/violations/*`
  - violation list and detail views

## Server-Side Routes and Proxy Behavior

The dashboard also owns several server-side route handlers:

- `src/app/auth/callback/route.ts`
  - exchanges OAuth/PKCE auth codes for sessions
  - redirects multi-tenant users to `/auth/select-tenant`
- `src/app/v1/events/stream/route.ts`
  - same-origin SSE proxy for tenant-wide event streams
- `src/app/v1/projects/[project_id]/events/stream/route.ts`
  - same-origin SSE proxy for project-scoped event streams

When `DASHBOARD_API_PROXY_ENABLED=true` and `API_INTERNAL_URL` is configured, `next.config.ts` rewrites:

- `/v1/:path*` -> `${API_INTERNAL_URL}/v1/:path*`
- `/auth/v1/:path*` -> `${API_INTERNAL_URL}/auth/v1/:path*`

This keeps browser requests same-origin in local development and avoids cross-origin localhost/Safari issues.

## Auth Model

- browser auth uses Supabase/GoTrue through the configured auth URL
- server auth/session loading is centralized in `src/lib/dashboard-auth.ts`
- JWT app metadata parsing is centralized in `src/lib/jwt-metadata.ts`
- multi-tenant users select their active tenant through `/auth/select-tenant`
- preferred-tenant switching is shared through `src/lib/tenant-switch.ts`
- SSE proxy routes use the narrower server-side `requireDashboardAccessToken()` helper instead of leaking raw access tokens through generic auth context

## API and Error-Handling Model

- browser API calls should go through `src/lib/api.ts`
- `apiFetch()` only accepts relative Customs API paths
- user-facing API/auth error text should go through the shared error mapping helper in `src/lib/api-error.ts`
- route params and redirect targets should use the shared validation helpers in `src/lib/route-params.ts` and `src/lib/redirect.ts`
- externally rendered URLs should stay on the shared safe URL/link path

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

## Environment Variables

The dashboard reads configuration from `src/config.ts` and `next.config.ts`.

### Core Runtime

| Variable      | Default       | Required | Purpose                                                            |
| ------------- | ------------- | -------- | ------------------------------------------------------------------ |
| `PORT`        | `3001`        | no       | Dashboard listen port                                              |
| `ENVIRONMENT` | `development` | no       | Runtime environment label used in startup logging/config snapshots |

### Browser Auth

| Variable                      | Default | Required | Purpose                                  |
| ----------------------------- | ------- | -------- | ---------------------------------------- |
| `NEXT_PUBLIC_AUTH_URL`        | none    | yes      | Browser/server auth base URL             |
| `NEXT_PUBLIC_GOTRUE_ANON_KEY` | none    | yes      | Public anon key for Supabase/GoTrue auth |

### Browser API

| Variable              | Default | Required | Purpose                                                                                                                 |
| --------------------- | ------- | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL` | none    | yes      | Browser-visible Customs API URL; local/dev commonly points at the dashboard origin when same-origin proxying is enabled |

### Same-Origin Dashboard Proxy

| Variable                      | Default                      | Required                                         | Purpose                                                                    |
| ----------------------------- | ---------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------- |
| `DASHBOARD_API_PROXY_ENABLED` | `false` unless set to `true` | no                                               | Enables Next.js rewrites for same-origin `/v1/*` and `/auth/v1/*` proxying |
| `API_INTERNAL_URL`            | none                         | required when proxying/SSE proxy routes are used | Server-only internal API URL for rewrites and SSE proxy fetches            |

## Important Operational Notes

- `NEXT_PUBLIC_*` values are build-time/public values; server-only variables are available only on the server
- changing `NEXT_PUBLIC_*` values requires a rebuild, not just a restart
- the production/development security header behavior is defined in `next.config.ts` via `src/lib/csp.ts`
- development uses report-only CSP; production uses enforced CSP
- the same-origin API proxy is opt-in and intended mainly for local/dev or controlled deployments
- SSE browser traffic should go through the dashboard’s own `/v1/.../stream` routes, not directly to the API

## Code Organization

Current package ownership:

- `src/app/`
  - route entrypoints, layouts, auth callback, tenant selection, and SSE proxy routes
- `src/features/`
  - feature-owned `api.ts`, `hooks.ts`, `types.ts`, and feature components
  - current feature domains include `connectors`, `packages`, `performance`, `policies`, `projects`, `proxies`, `security`, `settings`, `tokens`, `users`, and shared `findings` / `violations` types
- `src/components/`
  - shared UI, layout, feedback, and a small set of cross-feature components
- `src/lib/`
  - shared auth, API, redirect/URL safety, nav/authorization, CSP, and Supabase helpers
- `src/hooks/`
  - cross-feature hooks that remain intentionally shared

## Boundary Rules

- keep route files in `src/app/` thin and mostly declarative
- move feature-specific API/state/orchestration into `src/features/<feature>/`
- keep auth/session/JWT parsing centralized in `src/lib/`
- keep same-origin SSE proxy logic centralized in the dedicated `/src/app/v1/.../route.ts` handlers plus `src/lib/sse-proxy.ts`
- keep route visibility and role access driven from the shared dashboard route config
- keep shared UI shells under `src/components/layout`, `src/components/feedback`, and `src/components/ui`
- avoid reintroducing page-local duplicated loading/error/fetch patterns when a feature hook or shared primitive already exists

## Cleanup Direction

Recent dashboard cleanup work established these expectations:

- route-owned screens should continue moving toward feature ownership instead of growing inside `src/app/(dashboard)`
- navigation and authorization metadata should stay centralized
- safe URL handling, safe redirects, and user-facing error mapping should stay on the shared helpers
- follow-up cleanup should be incremental, not a rewrite

For agent workflow and service-local guardrails, see [AGENTS.md](/workspace/services/dashboard/AGENTS.md).

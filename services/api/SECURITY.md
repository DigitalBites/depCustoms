# `services/api` Security Review

Last updated: 2026-04-17

## Executive Summary

`services/api` has a solid security foundation:

- Dashboard-to-API authentication is centralized in [`authMiddleware`](/workspace/services/api/src/middleware/auth.ts:29), which verifies JWTs against the configured JWKS and stamps `tenantId`, `userId`, `role`, and tenant memberships into Hono context.
- Route-level tenant and project isolation is centralized in [`src/http/guards.ts`](/workspace/services/api/src/http/guards.ts:35), especially [`requireTenantParamAccess()`](/workspace/services/api/src/http/guards.ts:35), [`requireTenantCapabilityAccess()`](/workspace/services/api/src/http/guards.ts:75), and [`requireProjectAccess()`](/workspace/services/api/src/http/guards.ts:106).
- Proxy-to-API authentication is split cleanly into a bootstrap secret exchange and a short-lived runtime JWT:
  - bootstrap secret validation in [`src/connect/proxy-auth.ts`](/workspace/services/api/src/connect/proxy-auth.ts:35)
  - runtime token issuance in [`src/features/internal-proxy-auth/token-exchange-service.ts`](/workspace/services/api/src/features/internal-proxy-auth/token-exchange-service.ts:8)
  - runtime JWT issuance/verification in [`src/auth/proxy-jwt.ts`](/workspace/services/api/src/auth/proxy-jwt.ts:20)
- The data plane protects tenant boundaries explicitly in Connect handlers:
  - project token tenant must match proxy tenant in [`handleCheck()`](/workspace/services/api/src/connect/check-service.ts:97)
  - `RecordUsage` drops rows whose tenant does not match the authenticated proxy tenant in [`handleRecordUsage()`](/workspace/services/api/src/connect/record-usage-service.ts:50)
- The GoTrue token hook is protected with HMAC signature verification, timestamp skew validation, and replay suppression in [`src/features/internal-auth-hook/verification.ts`](/workspace/services/api/src/features/internal-auth-hook/verification.ts:20).

This static review did not find an obvious cross-tenant bypass in the proxy/API trust boundary. The current API surface is materially more consistent about separating authentication, tenant/project scope checks, and capability-based authorization.

## Security Model

### Dashboard -> API

Flow:

1. The browser sends a Supabase/GoTrue access token.
2. [`authMiddleware`](/workspace/services/api/src/middleware/auth.ts:29) verifies the token with [`verifyAccessToken()`](/workspace/services/api/src/auth/jwt-verifier.ts:79).
3. The middleware parses tenant-scoped claims from `app_metadata` and stores them in request context.
4. Route handlers enforce:
   - tenant match with [`requireTenantParamAccess()`](/workspace/services/api/src/http/guards.ts:35)
   - project membership / implicit project access with [`requireProjectAccess()`](/workspace/services/api/src/http/guards.ts:106)
   - capability checks with [`requireTenantCapability()`](/workspace/services/api/src/http/guards.ts:92) or [`requireTenantCapabilityAccess()`](/workspace/services/api/src/http/guards.ts:75)

Security characteristics:

- JWT verification is centralized and consistent.
- Query-string bearer tokens are only accepted for SSE endpoints because `EventSource` cannot send custom headers, and other routes reject them explicitly in [`authMiddleware`](/workspace/services/api/src/middleware/auth.ts:22).
- Inbound path, query, body, and key header-based inputs have explicit validation boundaries through Zod schemas and shared helpers.

### Proxy -> API

Flow:

1. A registered proxy sends `x-proxy-id` and `x-proxy-secret` to [`POST /internal/v1/proxy/token`](/workspace/services/api/src/routes/internal.ts:115).
2. The API hashes the provided secret and compares it against the stored current or previous secret with timing-safe comparison in [`requireBootstrapAuthenticatedProxy()`](/workspace/services/api/src/connect/proxy-auth.ts:35).
3. The API issues a short-lived runtime JWT carrying `proxy_id` and `tenant_id` in [`issueProxyRuntimeToken()`](/workspace/services/api/src/auth/proxy-jwt.ts:20).
4. ConnectRPC requests then authenticate with that runtime token through [`proxyJwtAuthInterceptor()`](/workspace/services/api/src/connect/proxy-auth.ts:91).

Security characteristics:

- Long-lived proxy secrets are not reused as steady-state RPC bearer tokens.
- Runtime JWTs are audience-bound (`customs-proxy-rpc`) and short-lived.
- `handleCheck()` rejects project tokens whose tenant does not match the authenticated proxy tenant in [`src/connect/check-service.ts:119`](/workspace/services/api/src/connect/check-service.ts:119).
- `handleRecordUsage()` resolves token hashes server-side and drops mismatched-tenant rows in [`src/connect/record-usage-service.ts:81`](/workspace/services/api/src/connect/record-usage-service.ts:81).

### GoTrue -> API Internal Hook

`/internal/auth/token-hook` is intentionally unauthenticated at the HTTP layer, but it is protected by signed webhook verification:

- HMAC signature check in [`verifyTokenHookRequest()`](/workspace/services/api/src/features/internal-auth-hook/verification.ts:20)
- timestamp skew enforcement in [`verification.ts:57`](/workspace/services/api/src/features/internal-auth-hook/verification.ts:57)
- in-process replay suppression in [`verification.ts:76`](/workspace/services/api/src/features/internal-auth-hook/verification.ts:76)

### MCP -> API

MCP uses a stricter audience than the normal dashboard API:

- [`resolveMcpPrincipalFromAuthorizationHeader()`](/workspace/services/api/src/features/mcp/auth/service.ts:45) verifies the token for audience `mcp`
- confirms the JWT carries the `mcp` audience in claims
- confirms the caller role can perform `mcp.read`
- tool-level project or tenant access is then enforced in MCP service code, for example:
  - project-scoped access in [`src/features/mcp/services/project-access.ts`](/workspace/services/api/src/features/mcp/services/project-access.ts)
  - tenant-scoped tool gating such as `mcp.use_tenant` in [`find-projects-using-package-service.ts`](/workspace/services/api/src/features/mcp/services/find-projects-using-package-service.ts:32)

## Core Controls

### Authentication

- Dashboard/API JWT auth: [`src/middleware/auth.ts`](/workspace/services/api/src/middleware/auth.ts:29)
- MCP JWT auth: [`src/features/mcp/auth/service.ts`](/workspace/services/api/src/features/mcp/auth/service.ts:45)
- Proxy bootstrap auth: [`src/connect/proxy-auth.ts`](/workspace/services/api/src/connect/proxy-auth.ts:35)
- Proxy runtime JWT auth: [`src/connect/proxy-auth.ts`](/workspace/services/api/src/connect/proxy-auth.ts:91)
- Internal hook auth: [`src/features/internal-auth-hook/verification.ts`](/workspace/services/api/src/features/internal-auth-hook/verification.ts:20)

### Authorization

- Capability model: [`CAPABILITY_KEYS`](/workspace/services/api/src/middleware/rbac.ts:84)
- Role-to-capability mapping: [`ROLE_CAPABILITIES`](/workspace/services/api/src/middleware/rbac.ts:143)
- Tenant scope enforcement: [`requireTenantParamAccess()`](/workspace/services/api/src/http/guards.ts:35)
- Capability enforcement: [`requireTenantCapability()`](/workspace/services/api/src/http/guards.ts:92)
- Project scope enforcement: [`requireProjectAccess()`](/workspace/services/api/src/http/guards.ts:106)

### Input Validation and Query Safety

- request body size limit in [`buildApiApp()`](/workspace/services/api/src/app/http-app.ts:34)
- UUID path validation in [`validateUuidParam()`](/workspace/services/api/src/http/responses.ts:33)
- reusable Zod query helpers in [`src/http/validation.ts`](/workspace/services/api/src/http/validation.ts:3)
- Zod-backed body validation on public and internal routes via `zValidator`, including [`src/routes/internal.ts`](/workspace/services/api/src/routes/internal.ts)
- schema validation for internal proxy, token-hook, and MCP transport headers in [`src/routes/internal.ts`](/workspace/services/api/src/routes/internal.ts) and [`src/features/mcp/router.ts`](/workspace/services/api/src/features/mcp/router.ts)
- connector key validation with a restrictive regex in [`connectorKeyParamSchema`](/workspace/services/api/src/http/validation.ts:17)
- most DB access uses Drizzle parameterization rather than string interpolation

Residual note:

- some analytics/reporting queries still use raw `sql\`\`` fragments for aggregates and filters. These are not automatically unsafe, but they deserve extra review whenever modified.

## Role Model

Current API tenant roles:

| Role     | Intent                                                                     |
| -------- | -------------------------------------------------------------------------- |
| `owner`  | Full tenant control                                                        |
| `admin`  | Broad administrative access without the most privileged owner-only actions |
| `demo`   | Broad read-only / evaluation access across tenant and project surfaces     |
| `member` | Project-oriented working access                                            |
| `guest`  | Read-only access to assigned projects                                      |

Role metadata is defined in [`TENANT_ROLE_METADATA`](/workspace/services/api/src/middleware/rbac.ts:23).

## Capability Model

The canonical API capability list is [`CAPABILITY_KEYS`](/workspace/services/api/src/middleware/rbac.ts:72). Role assignment is defined by the internal `ROLE_CAPABILITIES` map in [`src/middleware/rbac.ts`](/workspace/services/api/src/middleware/rbac.ts:143).

### Context-Sensitive Capabilities

These capabilities are not pure role checks. [`canPerform()`](/workspace/services/api/src/middleware/rbac.ts:251) applies extra context:

| Capability                | Extra requirement                                            |
| ------------------------- | ------------------------------------------------------------ |
| `projects.read`           | `hasProjectAccess` when a project-scoped context is provided |
| `security.read_project`   | `hasProjectAccess` when a project-scoped context is provided |
| `packages.read_project`   | `hasProjectAccess` when a project-scoped context is provided |
| `violations.read_project` | `hasProjectAccess` when a project-scoped context is provided |
| `policy.read_project`     | `hasProjectAccess` when a project-scoped context is provided |
| `events.read_project`     | `hasProjectAccess` when a project-scoped context is provided |
| `mcp.use_project`         | `hasProjectAccess` when a project-scoped context is provided |
| `tokens.revoke_own`       | `ownsToken` must be true                                     |
| `tokens.rotate_own`       | `ownsToken` must be true                                     |

## Capability Grid

Legend:

- `Y` = role includes the capability
- `-` = role does not include the capability
- `ctx` = role includes the capability, but `canPerform()` may still require project/token context

| Capability                     | owner | admin | demo | member | guest | Notes                                                |
| ------------------------------ | ----- | ----- | ---- | ------ | ----- | ---------------------------------------------------- |
| `overview.read`                | Y     | Y     | Y    | Y      | Y     | Tenant overview surfaces                             |
| `projects.read`                | ctx   | ctx   | ctx  | ctx    | ctx   | Project reads may require project membership context |
| `projects.create`              | Y     | Y     | -    | Y      | -     | Create projects                                      |
| `projects.delete`              | Y     | Y     | -    | -      | -     | Delete projects                                      |
| `events.read_tenant`           | Y     | Y     | Y    | -      | -     | Tenant event surfaces                                |
| `events.read_project`          | ctx   | ctx   | ctx  | ctx    | ctx   | Project events, context-sensitive                    |
| `performance.read`             | Y     | Y     | Y    | -      | -     | Performance dashboards                               |
| `policy.read_tenant`           | Y     | Y     | Y    | Y      | -     | Tenant policy visibility                             |
| `policy.read_project`          | ctx   | ctx   | ctx  | ctx    | -     | Project policy visibility, context-sensitive         |
| `policy.write_tenant`          | Y     | Y     | -    | -      | -     | Tenant policy edits                                  |
| `policy.write_project`         | Y     | Y     | -    | -      | -     | Project policy edits                                 |
| `rules.read`                   | Y     | Y     | Y    | Y      | -     | Rule inspection                                      |
| `rules.write`                  | Y     | Y     | -    | -      | -     | Rule creation/editing                                |
| `policy_assignments.read`      | Y     | Y     | Y    | Y      | -     | Policy assignment visibility                         |
| `policy_assignments.write`     | Y     | Y     | -    | -      | -     | Policy assignment changes                            |
| `policy_preview.read`          | Y     | Y     | Y    | Y      | -     | Rule/condition previewing                            |
| `connectors.read`              | Y     | Y     | Y    | Y      | -     | Connector visibility                                 |
| `connectors.write`             | Y     | Y     | -    | -      | -     | Connector sync/write actions                         |
| `security.read_tenant`         | Y     | Y     | Y    | -      | -     | Tenant security views                                |
| `security.read_project`        | ctx   | ctx   | ctx  | ctx    | ctx   | Project security views, context-sensitive            |
| `security.write`               | Y     | Y     | -    | -      | -     | Security finding/status updates                      |
| `packages.read_tenant`         | Y     | Y     | Y    | -      | -     | Tenant package views                                 |
| `packages.read_project`        | ctx   | ctx   | ctx  | ctx    | ctx   | Project package views, context-sensitive             |
| `packages.rebuild`             | Y     | Y     | -    | -      | -     | Package rebuild actions                              |
| `tokens.read_all`              | Y     | Y     | -    | -      | -     | Read all project tokens                              |
| `tokens.read_own`              | Y     | Y     | Y    | Y      | -     | Read own token surfaces                              |
| `tokens.create`                | Y     | Y     | Y    | Y      | -     | Create project tokens                                |
| `tokens.revoke_any`            | Y     | Y     | -    | -      | -     | Revoke any token in project                          |
| `tokens.revoke_own`            | Y     | Y     | -    | ctx    | -     | Requires token ownership context for member          |
| `tokens.rotate_any`            | Y     | Y     | -    | -      | -     | Rotate any token in project                          |
| `tokens.rotate_own`            | Y     | Y     | -    | ctx    | -     | Requires token ownership context for member          |
| `members.read`                 | Y     | Y     | -    | -      | -     | Tenant member list                                   |
| `members.invite`               | Y     | Y     | -    | Y      | -     | Invite members/guests                                |
| `members.invite_admin`         | Y     | Y     | -    | -      | -     | Invite admins                                        |
| `members.invite_unscoped`      | Y     | Y     | -    | Y      | -     | Invite without project scope                         |
| `members.write_roles`          | Y     | Y     | -    | -      | -     | Change member roles                                  |
| `members.create_password_user` | Y     | -     | -    | -      | -     | Create password users directly                       |
| `members.reset_password`       | Y     | Y     | -    | -      | -     | Reset another user's password                        |
| `settings.read`                | Y     | Y     | Y    | -      | -     | Tenant settings visibility                           |
| `settings.write`               | Y     | Y     | -    | -      | -     | Tenant settings updates                              |
| `proxies.read`                 | Y     | Y     | Y    | Y      | -     | Proxy management visibility                          |
| `proxies.write`                | Y     | Y     | -    | -      | -     | Proxy create/rotate/disable actions                  |
| `mcp.read`                     | Y     | Y     | Y    | Y      | -     | MCP dashboard/API surfaces                           |
| `mcp.connect`                  | Y     | Y     | Y    | Y      | -     | Start MCP connection bootstrap                       |
| `mcp.use_project`              | ctx   | ctx   | ctx  | ctx    | -     | Project-scoped MCP use, context-sensitive            |
| `mcp.use_tenant`               | Y     | -     | -    | -      | -     | Tenant-scoped MCP tools                              |
| `violations.read_tenant`       | Y     | Y     | Y    | -      | -     | Tenant violations surfaces                           |
| `violations.read_project`      | ctx   | ctx   | ctx  | ctx    | ctx   | Project violations, context-sensitive                |
| `violations.write`             | Y     | Y     | -    | -      | -     | Violation status updates                             |

## Notes

- `owner` currently receives the full API capability set by design in [`src/middleware/rbac.ts`](/workspace/services/api/src/middleware/rbac.ts:143).
- `admin` is nearly full-access, but intentionally lacks:
  - `mcp.use_tenant`
  - `members.create_password_user`
- `demo` is intentionally broad read/evaluation access, but excludes write paths and member-management surfaces.
- `guest` is intentionally minimal and project-read oriented.

## Capability Enforcement Map

Notes:

- `Capability Grid` above is the canonical role-to-capability view.
- This section is intentionally narrower: it only calls out enforcement paths that are easy to misunderstand because they are indirect, split across multiple surfaces, or enforced deeper in service/tool logic.
- "Indirect" means the capability is enforced inside shared service code or MCP tool logic rather than by the top-level REST route alone.

| Capability                | Surface                                                                                      | Current enforcement                                                                                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projects.read`           | Tenant project list plus project-scoped reads                                                | Context-sensitive. Role check is in [`canPerform()`](/workspace/services/api/src/middleware/rbac.ts:251), with project membership / implicit access resolved through route/service flow. |
| `events.read_tenant`      | `GET /v1/events`, `GET /v1/events/stream`                                                    | Split across [`features/events/tenant-routes.ts`](/workspace/services/api/src/features/events/tenant-routes.ts:25) and [`routes/sse.ts`](/workspace/services/api/src/routes/sse.ts:20). |
| `events.read_project`     | Project event routes and project-filtered SSE access                                         | Split across [`features/events/project-routes.ts`](/workspace/services/api/src/features/events/project-routes.ts:13) and [`routes/sse.ts`](/workspace/services/api/src/routes/sse.ts:37). |
| `policy.read_project`     | Project policy reads, effective policies, and project-linked policy detail                   | Context-sensitive. Role checks combine with project access checks across multiple route families.                                                                                    |
| `connectors.read`         | `GET /v1/connectors`, contributor/security connector routes, evidence routes                 | Mixed enforcement. Some routes check directly, others enforce the same capability deeper in route-family or feature-specific code.                                                  |
| `security.read_project`   | Project security summary, findings, and package-oriented security views                      | Split semantic surface. Findings/summary routes use `security.read_project`, while some package views are intentionally gated by `packages.read_project`.                             |
| `packages.read_project`   | Project package routes and package-oriented security views                                   | Context-sensitive and partially shared with security-oriented package views.                                                                                                          |
| `tokens.read_all`         | `GET /v1/projects/:project_id/tokens`                                                        | Indirect via [`features/tokens/service.ts`](/workspace/services/api/src/features/tokens/service.ts:33), where own-vs-all token visibility is resolved after route entry.            |
| `tokens.read_own`         | `GET /v1/projects/:project_id/tokens`                                                        | Indirect. Same route as `tokens.read_all`; enforcement depends on service-level filtering rather than route separation.                                                             |
| `tokens.create`           | `POST /v1/projects/:project_id/tokens`                                                       | Indirect via [`canCreateProjectToken()`](/workspace/services/api/src/features/tokens/service.ts:27).                                                                                |
| `tokens.revoke_any`       | `DELETE /v1/projects/:project_id/tokens/:token_id`                                           | Indirect via [`canManageExistingToken()`](/workspace/services/api/src/features/tokens/service.ts:43).                                                                               |
| `tokens.revoke_own`       | `DELETE /v1/projects/:project_id/tokens/:token_id`                                           | Indirect and context-sensitive. Ownership is resolved in token service code, not by route shape.                                                                                    |
| `tokens.rotate_any`       | `POST /v1/projects/:project_id/tokens/:token_id/rotate`                                      | Indirect via token service authorization helpers.                                                                                                                                     |
| `tokens.rotate_own`       | `POST /v1/projects/:project_id/tokens/:token_id/rotate`                                      | Indirect and context-sensitive. Ownership check is applied in service logic.                                                                                                         |
| `members.invite_admin`    | `POST /v1/tenants/:tenant_id/access-grants` when assigning `admin`                           | Indirect via [`canInviteTenantRole()`](/workspace/services/api/src/middleware/rbac.ts:279).                                                                                        |
| `members.invite_unscoped` | `POST /v1/tenants/:tenant_id/access-grants` when omitting `project_id`                       | Indirect via [`canInviteWithoutProjectScope()`](/workspace/services/api/src/middleware/rbac.ts:286).                                                                               |
| `mcp.read`                | `GET /mcp`, `POST /mcp` JSON-RPC transport                                                   | Enforced in MCP-specific auth flow rather than normal API middleware in [`features/mcp/auth/service.ts`](/workspace/services/api/src/features/mcp/auth/service.ts:45).              |
| `mcp.connect`             | `GET /v1/mcp/availability`, `POST /v1/mcp/connections`                                       | Indirect via [`getMcpAvailability()`](/workspace/services/api/src/features/mcp/availability-service.ts:22) and connection bootstrap services.                                      |
| `mcp.use_project`         | Project-scoped MCP tools                                                                      | Indirect via MCP project access services in [`features/mcp/services/project-access.ts`](/workspace/services/api/src/features/mcp/services/project-access.ts:1).                      |
| `mcp.use_tenant`          | Tenant-scoped MCP tools such as "find projects using package"                                 | Indirect via individual tool services rather than top-level transport routing.                                                                                                       |
| `violations.read_tenant`  | Tenant violation list/detail/entity routes, tenant summary, tenant suppression list          | Split across multiple route families under violations and suppression features.                                                                                                      |
| `violations.read_project` | Project violation list/detail/entity routes and project suppression list                      | Split across multiple route families and context-sensitive for project membership.                                                                                                   |
| `violations.write`        | Violation status updates and suppression write routes                                         | Split across violation status routes and suppression write routes.                                                                                                                   |

## Verification

The current security posture described in this document was validated during the accompanying hardening work with:

- `npm run build`
- `source ./env.setup.sh && npm run test:unit`

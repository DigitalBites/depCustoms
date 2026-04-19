# `services/dashboard` Security Overview

Last updated: 2026-04-18

## Overview

`services/dashboard` is the browser and Next.js dashboard surface for Customs. Its authorization model is capability-based and is defined in:

- [`src/lib/dashboard-capabilities.ts`](/workspace/services/dashboard/src/lib/dashboard-capabilities.ts:12)
- [`src/lib/dashboard-roles.ts`](/workspace/services/dashboard/src/lib/dashboard-roles.ts:12)

The dashboard does not treat route names or UI visibility alone as security boundaries. The intended model is:

1. the signed-in user carries a dashboard role in JWT metadata
2. that role resolves to a capability set
3. route guards, page components, nav visibility, and feature actions all consult the shared capability model

Current review status:

- As of the latest review update, there are no known findings in `services/dashboard`.
- The currently open items are hardening follow-ups rather than active auth-boundary defects:
  - framework-aware dashboard CSP tightening (`script-src` and `style-src`)
  - optionally adding an API-owned MCP OAuth consent nonce/state model later

## Role Model

Current dashboard roles:

| Role     | Intent                                                                     |
| -------- | -------------------------------------------------------------------------- |
| `owner`  | Full tenant control                                                        |
| `admin`  | Broad administrative access without the most privileged owner-only actions |
| `demo`   | Broad read-only / evaluation access across tenant and project surfaces     |
| `member` | Project-oriented working access                                            |
| `guest`  | Read-only access to assigned projects                                      |

Role metadata lives in [`DASHBOARD_ROLE_METADATA`](/workspace/services/dashboard/src/lib/dashboard-roles.ts:12).

## Capability Model

The canonical capability list is [`DASHBOARD_CAPABILITY_KEYS`](/workspace/services/dashboard/src/lib/dashboard-capabilities.ts:12). Role assignment is defined by the internal `ROLE_CAPABILITIES` map in [`dashboard-capabilities.ts`](/workspace/services/dashboard/src/lib/dashboard-capabilities.ts:72).

### Context-Sensitive Capabilities

These capabilities are not pure role checks. [`canPerform()`](/workspace/services/dashboard/src/lib/dashboard-capabilities.ts:153) applies extra context:

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

## Capability Catalog

Legend:

- `Y` = role includes the capability
- `-` = role does not include the capability
- `ctx` = role includes the capability, but `canPerform()` may still require project/token context

| Capability                     | owner | admin | demo | member | guest | Notes                                                |
| ------------------------------ | ----- | ----- | ---- | ------ | ----- | ---------------------------------------------------- |
| `overview.read`                | Y     | Y     | Y    | Y      | Y     | Dashboard landing / overview surfaces                |
| `projects.read`                | ctx   | ctx   | ctx  | ctx    | ctx   | Project reads may require project membership context |
| `projects.read_all`            | Y     | Y     | Y    | -      | -     | Tenant-wide project visibility                       |
| `projects.create`              | Y     | Y     | -    | Y      | -     | Create new projects                                  |
| `projects.delete`              | Y     | Y     | -    | -      | -     | Delete projects                                      |
| `events.read_tenant`           | Y     | Y     | Y    | -      | -     | Tenant events surface                                |
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
| `policy_preview.read`          | Y     | Y     | Y    | Y      | -     | Rule / condition previewing                          |
| `connectors.read`              | Y     | Y     | Y    | Y      | -     | Connector visibility                                 |
| `connectors.write`             | Y     | Y     | -    | -      | -     | Connector sync / write actions                       |
| `security.read_tenant`         | Y     | Y     | Y    | -      | -     | Tenant security views                                |
| `security.read_project`        | ctx   | ctx   | ctx  | ctx    | ctx   | Project security views, context-sensitive            |
| `security.write`               | Y     | Y     | -    | -      | -     | Security finding/status updates                      |
| `packages.read_tenant`         | Y     | Y     | Y    | -      | -     | Tenant package views                                 |
| `packages.read_project`        | ctx   | ctx   | ctx  | ctx    | ctx   | Project package views, context-sensitive             |
| `packages.rebuild`             | Y     | Y     | -    | -      | -     | Package rebuild actions                              |
| `tokens.read_all`              | Y     | Y     | -    | -      | -     | Read all project tokens                              |
| `tokens.read_own`              | Y     | Y     | Y    | Y      | -     | Read own tokens / limited token surfaces             |
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
| `mcp.read`                     | Y     | Y     | Y    | Y      | -     | MCP dashboard surfaces                               |
| `mcp.connect`                  | Y     | Y     | Y    | Y      | -     | Start MCP connection bootstrap                       |
| `mcp.use_project`              | ctx   | ctx   | ctx  | ctx    | -     | Project-scoped MCP use, context-sensitive            |
| `mcp.use_tenant`               | Y     | -     | -    | -      | -     | Tenant-scoped MCP tools                              |
| `violations.read_tenant`       | Y     | Y     | Y    | -      | -     | Tenant violations surfaces                           |
| `violations.read_project`      | ctx   | ctx   | ctx  | ctx    | ctx   | Project violations, context-sensitive                |
| `violations.write`             | Y     | Y     | -    | -      | -     | Violation status updates                             |

## Notes

- `owner` currently receives the full dashboard capability set by design in [`dashboard-capabilities.ts`](/workspace/services/dashboard/src/lib/dashboard-capabilities.ts:76).
- `admin` is nearly full-access, but intentionally lacks:
  - `mcp.use_tenant`
  - `members.create_password_user`
- `demo` is intentionally broad read access, but excludes write paths and member-management surfaces.
- `guest` is intentionally minimal and project-read oriented.

## Verification Source

This document was derived from:

- [`services/dashboard/src/lib/dashboard-capabilities.ts`](/workspace/services/dashboard/src/lib/dashboard-capabilities.ts:12)
- [`services/dashboard/src/lib/dashboard-roles.ts`](/workspace/services/dashboard/src/lib/dashboard-roles.ts:12)

import { describe, expect, it } from "vitest";

import {
  canPerform,
  hasImplicitProjectAccess,
  isOwnerOrAdmin,
  isTenantRole,
  isAssignableTenantRole,
  TENANT_ROLE_METADATA,
} from "../../middleware/rbac.js";

describe("rbac role helpers", () => {
  it("recognizes valid tenant roles", () => {
    expect(isTenantRole("owner")).toBe(true);
    expect(isTenantRole("admin")).toBe(true);
    expect(isTenantRole("demo")).toBe(true);
    expect(isTenantRole("member")).toBe(true);
    expect(isTenantRole("guest")).toBe(true);
  });

  it("rejects unexpected role strings", () => {
    expect(isTenantRole("superadmin")).toBe(false);
    expect(isTenantRole("")).toBe(false);
  });

  it("exposes central role metadata consistently", () => {
    expect(TENANT_ROLE_METADATA.owner.ownerLevel).toBe(true);
    expect(TENANT_ROLE_METADATA.admin.ownerLevel).toBe(true);
    expect(TENANT_ROLE_METADATA.demo.ownerLevel).toBe(false);
    expect(TENANT_ROLE_METADATA.demo.implicitProjectAccess).toBe(true);
    expect(TENANT_ROLE_METADATA.member.inviteAssignable).toBe(true);
    expect(TENANT_ROLE_METADATA.guest.inviteAssignable).toBe(true);
    expect(TENANT_ROLE_METADATA.demo.directCreateAssignable).toBe(true);
    expect(TENANT_ROLE_METADATA.owner.inviteAssignable).toBe(false);
  });

  it("recognizes assignable tenant roles", () => {
    expect(isAssignableTenantRole("admin")).toBe(true);
    expect(isAssignableTenantRole("member")).toBe(true);
    expect(isAssignableTenantRole("guest")).toBe(true);
    expect(isAssignableTenantRole("demo")).toBe(false);
    expect(isAssignableTenantRole("owner")).toBe(false);
  });

  it("preserves owner/admin semantics", () => {
    expect(isOwnerOrAdmin("owner")).toBe(true);
    expect(isOwnerOrAdmin("admin")).toBe(true);
    expect(isOwnerOrAdmin("demo")).toBe(false);
    expect(isOwnerOrAdmin("member")).toBe(false);
    expect(isOwnerOrAdmin("guest")).toBe(false);
  });

  it("treats demo as having implicit project access without owner/admin mutation semantics", () => {
    expect(hasImplicitProjectAccess("owner")).toBe(true);
    expect(hasImplicitProjectAccess("admin")).toBe(true);
    expect(hasImplicitProjectAccess("demo")).toBe(true);
    expect(hasImplicitProjectAccess("member")).toBe(false);
    expect(hasImplicitProjectAccess("guest")).toBe(false);
  });

  it("enforces representative demo capability boundaries", () => {
    expect(canPerform("demo", "projects.read")).toBe(true);
    expect(canPerform("demo", "performance.read")).toBe(true);
    expect(canPerform("demo", "policy.read_tenant")).toBe(true);
    expect(canPerform("demo", "policy.write_tenant")).toBe(false);
    expect(canPerform("demo", "tokens.read_all")).toBe(false);
    expect(canPerform("demo", "tokens.create")).toBe(true);
    expect(canPerform("demo", "mcp.use_project")).toBe(true);
    expect(canPerform("demo", "mcp.use_tenant")).toBe(false);
  });

  it("enforces contextual capability checks for project and token ownership access", () => {
    expect(
      canPerform("demo", "security.read_project", { hasProjectAccess: true }),
    ).toBe(true);
    expect(
      canPerform("demo", "security.read_project", { hasProjectAccess: false }),
    ).toBe(false);
    expect(canPerform("member", "tokens.revoke_own", { ownsToken: true })).toBe(
      true,
    );
    expect(
      canPerform("member", "tokens.revoke_own", { ownsToken: false }),
    ).toBe(false);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/index.js");
vi.mock("../../middleware/rbac.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../middleware/rbac.js")>();
  return {
    ...actual,
    hasImplicitProjectAccess: vi.fn(),
    shouldAutoJoinCreatedProject: vi.fn(),
  };
});

import { db } from "../../db/index.js";
import {
  createProject,
  deleteProject,
  listTenantProjects,
} from "../../features/projects/service.js";
import {
  hasImplicitProjectAccess,
  shouldAutoJoinCreatedProject,
} from "../../middleware/rbac.js";
import {
  q,
  TEST_PROJECT_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
} from "../helpers/fakes.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.select).mockReturnValue(q([]) as any);
  vi.mocked(db.delete).mockReturnValue(q([]) as any);
  vi.mocked(hasImplicitProjectAccess).mockReturnValue(false);
  vi.mocked(shouldAutoJoinCreatedProject).mockReturnValue(false);
});

describe("project service", () => {
  it("lists all tenant projects when the role has implicit access", async () => {
    vi.mocked(hasImplicitProjectAccess).mockReturnValueOnce(true);
    vi.mocked(db.select).mockReturnValueOnce(
      q([{ id: TEST_PROJECT_ID, name: "Alpha" }]) as any,
    );

    await expect(
      listTenantProjects({
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
        role: "owner",
      }),
    ).resolves.toEqual([{ id: TEST_PROJECT_ID, name: "Alpha" }]);
  });

  it("returns only member project rows when the role lacks implicit access", async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(q([{ project_id: "p-1" }]) as any)
      .mockReturnValueOnce(q([{ id: "p-1", name: "Alpha" }]) as any);

    await expect(
      listTenantProjects({
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
        role: "member",
      }),
    ).resolves.toEqual([{ id: "p-1", name: "Alpha" }]);
  });

  it("returns an empty project list when membership lookup is empty", async () => {
    vi.mocked(db.select).mockReturnValueOnce(q([]) as any);

    await expect(
      listTenantProjects({
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
        role: "member",
      }),
    ).resolves.toEqual([]);
  });

  it("creates a project and auto-joins the creator when configured", async () => {
    const tx = {
      insert: vi
        .fn()
        .mockReturnValueOnce(q([{ id: TEST_PROJECT_ID, name: "Alpha" }]))
        .mockReturnValueOnce(q([])),
    };
    vi.mocked(db.transaction).mockImplementationOnce(async (fn: any) => fn(tx));
    vi.mocked(shouldAutoJoinCreatedProject).mockReturnValueOnce(true);

    await expect(
      createProject({
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
        role: "owner",
        name: "Alpha",
      }),
    ).resolves.toEqual({ id: TEST_PROJECT_ID, name: "Alpha" });

    expect(tx.insert).toHaveBeenCalledTimes(2);
  });

  it("deletes a project and returns null when no row is removed", async () => {
    vi.mocked(db.delete)
      .mockReturnValueOnce(q([{ id: TEST_PROJECT_ID }]) as any)
      .mockReturnValueOnce(q([]) as any);

    await expect(deleteProject(TEST_PROJECT_ID)).resolves.toEqual({
      id: TEST_PROJECT_ID,
    });
    await expect(deleteProject("missing")).resolves.toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/index.js");
vi.mock("../../http/guards.js", () => ({
  requireResolvedProjectAccess: vi.fn(async () => ({ project: { id: "p-1" } })),
  requireTenantCapability: vi.fn(() => true),
}));
vi.mock("../../features/violations/query-service.js", () => ({
  listViolations: vi.fn(),
  loadViolationSummary: vi.fn(),
}));

import { db } from "../../db/index.js";
import {
  applyBulkViolationStatusUpdate,
  applyViolationStatusUpdate,
  listProjectViolations,
  loadProjectViolationSummary,
  requireViolationProjectAccess,
} from "../../features/violations/project-shared.js";
import {
  listViolations,
  loadViolationSummary,
} from "../../features/violations/query-service.js";
import {
  q,
  TEST_TENANT_ID,
  TEST_USER_ID,
  TEST_VIOLATION_ID,
} from "../helpers/fakes.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.select).mockReturnValue(q([]) as any);
  vi.mocked(db.update).mockReturnValue(q([]) as any);
  vi.mocked(db.insert).mockReturnValue(q([]) as any);
});

describe("violation project shared helpers", () => {
  it("delegates summary and listing helpers", async () => {
    vi.mocked(loadViolationSummary).mockResolvedValueOnce({ open: 2 } as any);
    vi.mocked(listViolations).mockResolvedValueOnce([
      { id: TEST_VIOLATION_ID },
    ] as any);

    await expect(
      loadProjectViolationSummary("p-1", TEST_TENANT_ID),
    ).resolves.toEqual({ open: 2 });
    await expect(
      listProjectViolations("p-1", TEST_TENANT_ID, {
        limit: 10,
        offset: 0,
      } as any),
    ).resolves.toEqual([{ id: TEST_VIOLATION_ID }]);
  });

  it("updates a single violation and inserts a suppression when needed", async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      q([
        {
          id: TEST_VIOLATION_ID,
          project_id: "p-1",
          entity_id: "npm:lodash:4.17.15",
          rule_id: null,
        },
      ]) as any,
    );
    vi.mocked(db.update).mockReturnValueOnce(
      q([{ id: TEST_VIOLATION_ID, status: "suppressed" }]) as any,
    );

    await expect(
      applyViolationStatusUpdate(
        TEST_VIOLATION_ID,
        TEST_TENANT_ID,
        TEST_USER_ID,
        {
          status: "suppressed",
          status_note: "accepted",
        },
      ),
    ).resolves.toEqual({ id: TEST_VIOLATION_ID, status: "suppressed" });
    expect(db.insert).toHaveBeenCalledOnce();
  });

  it("returns null for missing single violations and handles bulk updates", async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(q([]) as any)
      .mockReturnValueOnce(
        q([
          {
            id: TEST_VIOLATION_ID,
            project_id: "p-1",
            entity_id: "npm:lodash:4.17.15",
            rule_id: null,
          },
        ]) as any,
      );
    vi.mocked(db.update).mockReturnValueOnce(
      q([{ id: TEST_VIOLATION_ID }]) as any,
    );

    await expect(
      applyViolationStatusUpdate("missing", TEST_TENANT_ID, TEST_USER_ID, {
        status: "resolved",
      } as any),
    ).resolves.toBeNull();

    await expect(
      applyBulkViolationStatusUpdate(
        [TEST_VIOLATION_ID, TEST_VIOLATION_ID],
        TEST_TENANT_ID,
        TEST_USER_ID,
        {
          status: "suppressed",
          status_note: "accepted",
        },
      ),
    ).resolves.toEqual({ updatedIds: [TEST_VIOLATION_ID] });
  });

  it("short-circuits empty bulk updates and respects project access helper", async () => {
    await expect(
      applyBulkViolationStatusUpdate([], TEST_TENANT_ID, TEST_USER_ID, {
        status: "resolved",
      } as any),
    ).resolves.toEqual({ updatedIds: [] });

    const c = {} as any;
    await expect(requireViolationProjectAccess(c, "p-1")).resolves.toEqual({
      project: { id: "p-1" },
    });
  });
});

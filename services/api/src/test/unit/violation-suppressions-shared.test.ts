import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/index.js");

import { db } from "../../db/index.js";
import {
  listProjectViolationSuppressions,
  listTenantViolationSuppressions,
  loadSuppressionForTenant,
  projectExistsForTenant,
} from "../../features/violation-suppressions/shared.js";
import { q, TEST_PROJECT_ID, TEST_TENANT_ID } from "../helpers/fakes.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.select).mockReturnValue(q([]) as any);
});

describe("violation suppression shared helpers", () => {
  it("loads a suppression and project row for a tenant", async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(q([{ id: "supp-1" }]) as any)
      .mockReturnValueOnce(q([{ id: TEST_PROJECT_ID }]) as any);

    await expect(
      loadSuppressionForTenant("supp-1", TEST_TENANT_ID),
    ).resolves.toEqual({
      id: "supp-1",
    });
    await expect(
      projectExistsForTenant(TEST_PROJECT_ID, TEST_TENANT_ID),
    ).resolves.toEqual({
      id: TEST_PROJECT_ID,
    });
  });

  it("lists project and tenant violation suppressions", async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(q([{ id: "supp-1" }]) as any)
      .mockReturnValueOnce(q([{ id: "supp-2" }]) as any);

    await expect(
      listProjectViolationSuppressions(TEST_PROJECT_ID, TEST_TENANT_ID),
    ).resolves.toEqual([{ id: "supp-1" }]);
    await expect(
      listTenantViolationSuppressions(TEST_TENANT_ID),
    ).resolves.toEqual([{ id: "supp-2" }]);
  });
});

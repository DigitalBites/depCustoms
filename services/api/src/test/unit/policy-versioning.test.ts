import { describe, expect, it, vi } from "vitest";
import { policies, policy_rule_bindings } from "../../db/schema.js";
import { createNextPolicyVersion } from "../../features/policies/versioning.js";
import {
  TEST_POLICY_ID,
  TEST_PROJECT_ID,
  TEST_TENANT_ID,
  fakeV2Policy,
} from "../helpers/fakes.js";

function returningBuilder(rows: unknown[]) {
  return {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(rows),
  };
}

function chainBuilder() {
  return {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
  };
}

describe("policy versioning tenant consistency", () => {
  it("writes cloned policy-rule bindings under the authenticated tenant", async () => {
    const newPolicy = fakeV2Policy({
      id: "00000000-0000-0000-0000-000000000777",
      version: 2,
    });
    const policyInsert = returningBuilder([newPolicy]);
    const bindingInsert = {
      values: vi.fn().mockResolvedValue(undefined),
    };
    const update = chainBuilder();
    const tx = {
      insert: vi.fn((table) => {
        if (table === policies) return policyInsert;
        if (table === policy_rule_bindings) return bindingInsert;
        throw new Error("unexpected insert table");
      }),
      update: vi.fn(() => update),
    };

    await createNextPolicyVersion(
      tx,
      fakeV2Policy({
        id: TEST_POLICY_ID,
        tenant_id: TEST_TENANT_ID,
        project_id: TEST_PROJECT_ID,
      }) as any,
      TEST_TENANT_ID,
      new Date("2026-01-01T00:00:00Z"),
      [
        {
          tenant_id: "00000000-0000-0000-0000-000000000999",
          rule_id: "00000000-0000-0000-0000-000000000123",
          enabled: true,
          required: false,
          order_index: 0,
        },
      ],
    );

    expect(bindingInsert.values).toHaveBeenCalledWith([
      expect.objectContaining({
        tenant_id: TEST_TENANT_ID,
        policy_id: newPolicy.id,
        rule_id: "00000000-0000-0000-0000-000000000123",
      }),
    ]);
  });
});

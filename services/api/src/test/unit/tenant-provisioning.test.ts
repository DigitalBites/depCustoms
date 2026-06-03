import { describe, expect, it, vi } from "vitest";
import {
  ENFORCEMENT_MODE,
  POLICY_SCOPE,
  POLICY_STATUS,
  RULE_TARGET_ENTITY,
} from "@customs/shared-constants";
import {
  DEFAULT_VERSION_COOLING_PERIOD_DAYS,
  ensureStarterPolicies,
  provisionCustomerTenantDefaults,
} from "../../bootstrap/tenant-provisioning.js";
import { q } from "../helpers/fakes.js";

const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000201";
const CUSTOMER_TENANT_ID = "00000000-0000-0000-0000-000000000202";
const PLATFORM_POLICY_ID = "00000000-0000-0000-0000-000000000301";
const CUSTOMER_POLICY_ID = "00000000-0000-0000-0000-000000000302";
const PLATFORM_RULE_ID = "00000000-0000-0000-0000-000000000401";
const CUSTOMER_RULE_ID = "00000000-0000-0000-0000-000000000402";

describe("tenant provisioning", () => {
  it("creates the built-in package version cooling rule", async () => {
    const firstPolicyInsert = q([{ id: CUSTOMER_POLICY_ID }]);
    const firstRulesInsert = q([
      { id: "00000000-0000-0000-0000-000000000411" },
      { id: "00000000-0000-0000-0000-000000000412" },
      { id: "00000000-0000-0000-0000-000000000413" },
      { id: "00000000-0000-0000-0000-000000000414" },
    ]);
    const secondPolicyInsert = q([
      { id: "00000000-0000-0000-0000-000000000303" },
    ]);
    const secondRulesInsert = q([
      { id: "00000000-0000-0000-0000-000000000421" },
    ]);
    const tx = {
      select: vi.fn().mockReturnValueOnce(q([])).mockReturnValueOnce(q([])),
      insert: vi
        .fn()
        .mockReturnValueOnce(firstPolicyInsert)
        .mockReturnValueOnce(firstRulesInsert)
        .mockReturnValueOnce(q(undefined))
        .mockReturnValueOnce(secondPolicyInsert)
        .mockReturnValueOnce(secondRulesInsert)
        .mockReturnValueOnce(q(undefined)),
    };

    const created = await ensureStarterPolicies(tx as any, CUSTOMER_TENANT_ID);

    expect(created).toBe(2);
    expect(firstRulesInsert.values).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          tenant_id: CUSTOMER_TENANT_ID,
          name: "Block Newly Released Package Versions",
          target_entity: RULE_TARGET_ENTITY.ARTIFACT,
          condition: {
            field: "asset.version_age_days",
            operator: "lt",
            value: DEFAULT_VERSION_COOLING_PERIOD_DAYS,
          },
          action: expect.objectContaining({
            type: "violation",
            severity: "high",
            code: "PACKAGE_VERSION_COOLING_PERIOD",
            enforcement_mode: ENFORCEMENT_MODE.ENFORCING,
          }),
        }),
      ]),
    );
  });

  it("copies active platform policy templates into a new customer tenant", async () => {
    const templatePolicy = {
      id: PLATFORM_POLICY_ID,
      policy_key: "00000000-0000-0000-0000-000000000501",
      tenant_id: PLATFORM_TENANT_ID,
      project_id: null,
      name: "Template Policy",
      description: "Template description",
      category: "supply-chain",
      scope: POLICY_SCOPE.GLOBAL,
      status: POLICY_STATUS.ACTIVE,
      enforcement_mode: ENFORCEMENT_MODE.ADVISORY,
      priority: 42,
      version: 3,
      effective_from: new Date("2026-01-01T00:00:00Z"),
      effective_to: new Date("9999-12-31T23:59:59.999Z"),
      superseded_by_id: null,
      created_by_user_id: "00000000-0000-0000-0000-000000000601",
      created_at: new Date("2026-01-01T00:00:00Z"),
      updated_at: new Date("2026-01-02T00:00:00Z"),
    };
    const templateRule = {
      id: PLATFORM_RULE_ID,
      rule_key: "00000000-0000-0000-0000-000000000502",
      tenant_id: PLATFORM_TENANT_ID,
      name: "Template Rule",
      description: "Template rule description",
      target_entity: RULE_TARGET_ENTITY.ARTIFACT,
      condition: { field: "source.osv.high_count", operator: "gt", value: 0 },
      action: { type: "violation", severity: "high" },
      version: 2,
      effective_from: new Date("2026-01-01T00:00:00Z"),
      effective_to: new Date("9999-12-31T23:59:59.999Z"),
      superseded_by_id: null,
      created_at: new Date("2026-01-01T00:00:00Z"),
      updated_at: new Date("2026-01-02T00:00:00Z"),
    };
    const templateBinding = {
      id: "00000000-0000-0000-0000-000000000701",
      tenant_id: PLATFORM_TENANT_ID,
      policy_id: PLATFORM_POLICY_ID,
      rule_id: PLATFORM_RULE_ID,
      enabled: false,
      required: true,
      order_index: 7,
      created_at: new Date("2026-01-01T00:00:00Z"),
    };
    const entitlementInsert = q(undefined);
    const policyInsert = q([{ id: CUSTOMER_POLICY_ID }]);
    const ruleInsert = q([{ id: CUSTOMER_RULE_ID }]);
    const bindingInsert = q(undefined);
    const tx = {
      select: vi
        .fn()
        .mockReturnValueOnce(q([]))
        .mockReturnValueOnce(q([templatePolicy]))
        .mockReturnValueOnce(q([]))
        .mockReturnValueOnce(q([{ binding: templateBinding, rule: templateRule }])),
      insert: vi
        .fn()
        .mockReturnValueOnce(entitlementInsert)
        .mockReturnValueOnce(policyInsert)
        .mockReturnValueOnce(ruleInsert)
        .mockReturnValueOnce(bindingInsert),
    };

    const result = await provisionCustomerTenantDefaults(tx as any, {
      tenantId: CUSTOMER_TENANT_ID,
      platformTenantId: PLATFORM_TENANT_ID,
    });

    expect(result).toEqual({
      source: "platform_template",
      policiesCreated: 1,
    });
    expect(entitlementInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: CUSTOMER_TENANT_ID }),
    );
    expect(policyInsert.values).toHaveBeenCalledWith({
      tenant_id: CUSTOMER_TENANT_ID,
      project_id: null,
      name: "Template Policy",
      description: "Template description",
      category: "supply-chain",
      scope: POLICY_SCOPE.GLOBAL,
      status: POLICY_STATUS.ACTIVE,
      enforcement_mode: ENFORCEMENT_MODE.ADVISORY,
      priority: 42,
      created_by_user_id: null,
    });
    expect(ruleInsert.values).toHaveBeenCalledWith([
      {
        tenant_id: CUSTOMER_TENANT_ID,
        name: "Template Rule",
        description: "Template rule description",
        target_entity: RULE_TARGET_ENTITY.ARTIFACT,
        condition: templateRule.condition,
        action: templateRule.action,
      },
    ]);
    expect(bindingInsert.values).toHaveBeenCalledWith([
      {
        tenant_id: CUSTOMER_TENANT_ID,
        policy_id: CUSTOMER_POLICY_ID,
        rule_id: CUSTOMER_RULE_ID,
        enabled: false,
        required: true,
        order_index: 7,
      },
    ]);
  });
});

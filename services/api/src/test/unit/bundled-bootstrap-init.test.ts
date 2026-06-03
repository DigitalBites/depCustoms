import { describe, expect, it, vi, beforeEach } from "vitest";
import { TENANT_KIND } from "@customs/shared-constants";

vi.mock("../../db/index.js");
vi.mock("../../bootstrap/tenant-provisioning.js", () => ({
  ensureTenantEntitlements: vi.fn().mockResolvedValue(undefined),
  ensureStarterPolicies: vi.fn().mockResolvedValue(2),
  provisionCustomerTenantDefaults: vi.fn().mockResolvedValue({
    source: "platform_template",
    policiesCreated: 2,
  }),
}));

import { db } from "../../db/index.js";
import { runBundledBootstrapInitialization } from "../../bootstrap/bundled-bootstrap-init.js";
import {
  ensureTenantEntitlements,
  ensureStarterPolicies,
  provisionCustomerTenantDefaults,
} from "../../bootstrap/tenant-provisioning.js";
import { q } from "../helpers/fakes.js";

const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000201";
const CUSTOMER_TENANT_ID = "00000000-0000-0000-0000-000000000202";

describe("runBundledBootstrapInitialization", () => {
  let mockTx: {
    select: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockTx = {
      select: vi.fn(),
      insert: vi.fn(),
    };

    vi.mocked(db.transaction).mockImplementation(async (callback: any) =>
      callback(mockTx),
    );
  });

  it("creates platform and customer tenants and registers the bundled proxy to platform", async () => {
    const existingTenantQuery = q([]);
    const proxyLookupQuery = q([]);
    mockTx.select
      .mockReturnValueOnce(existingTenantQuery)
      .mockReturnValueOnce(proxyLookupQuery);

    const platformTenantInsert = q([{ id: PLATFORM_TENANT_ID }]);
    const customerTenantInsert = q([{ id: CUSTOMER_TENANT_ID }]);
    const proxyInsert = q(undefined);
    mockTx.insert
      .mockReturnValueOnce(platformTenantInsert)
      .mockReturnValueOnce(customerTenantInsert)
      .mockReturnValueOnce(proxyInsert);

    const result = await runBundledBootstrapInitialization({
      BOOTSTRAP_MODE: "bundled",
      BOOTSTRAP_SETUP_DEFAULT_POLICIES: "false",
      BOOTSTRAP_PROXY_ID: "00000000-0000-0000-0000-000000000301",
      BOOTSTRAP_PROXY_KEY: "cxp_test_bootstrap_secret",
    } as NodeJS.ProcessEnv);

    expect(result).toEqual({
      tenantId: CUSTOMER_TENANT_ID,
      platformTenantId: PLATFORM_TENANT_ID,
      customerTenantId: CUSTOMER_TENANT_ID,
      tenantCreated: true,
      proxyCreated: true,
      policiesCreated: 0,
    });
    expect(platformTenantInsert.values).toHaveBeenCalledWith({
      name: "Platform",
      kind: TENANT_KIND.PLATFORM,
    });
    expect(customerTenantInsert.values).toHaveBeenCalledWith({
      name: "default-first-tenant",
      kind: TENANT_KIND.CUSTOMER,
    });
    expect(ensureTenantEntitlements).toHaveBeenCalledWith(
      mockTx,
      CUSTOMER_TENANT_ID,
    );
    expect(proxyInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: PLATFORM_TENANT_ID }),
    );
  });

  it("seeds platform policies and provisions customer tenant defaults", async () => {
    const existingTenantQuery = q([]);
    const proxyLookupQuery = q([]);
    mockTx.select
      .mockReturnValueOnce(existingTenantQuery)
      .mockReturnValueOnce(proxyLookupQuery);

    mockTx.insert
      .mockReturnValueOnce(q([{ id: PLATFORM_TENANT_ID }]))
      .mockReturnValueOnce(q([{ id: CUSTOMER_TENANT_ID }]))
      .mockReturnValueOnce(q(undefined));

    const result = await runBundledBootstrapInitialization({
      BOOTSTRAP_MODE: "bundled",
      BOOTSTRAP_SETUP_DEFAULT_POLICIES: "true",
      BOOTSTRAP_PROXY_ID: "00000000-0000-0000-0000-000000000301",
      BOOTSTRAP_PROXY_KEY: "cxp_test_bootstrap_secret",
    } as NodeJS.ProcessEnv);

    expect(ensureStarterPolicies).toHaveBeenCalledWith(
      mockTx,
      PLATFORM_TENANT_ID,
    );
    expect(provisionCustomerTenantDefaults).toHaveBeenCalledWith(mockTx, {
      tenantId: CUSTOMER_TENANT_ID,
      platformTenantId: PLATFORM_TENANT_ID,
    });
    expect(result.policiesCreated).toBe(4);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/index.js");
vi.mock("../../app/db-readiness.js");

import { config } from "../../config.js";
import { checkDatabaseReadiness } from "../../app/db-readiness.js";
import { getBootstrapStatus } from "../../bootstrap/status-service.js";
import { db } from "../../db/index.js";
import { q, TEST_PROXY_ID } from "../helpers/fakes.js";

describe("getBootstrapStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BOOTSTRAP_MODE = "bundled";
    process.env.BOOTSTRAP_SETUP_FIRST_TENANT = "true";
    process.env.BOOTSTRAP_SETUP_FIRST_PROXY = "true";
    process.env.BOOTSTRAP_SETUP_DEFAULT_POLICIES = "true";
    process.env.PROXY_ID = TEST_PROXY_ID;

    (config as any).gotrueUrl = "http://gotrue.test";
    (config as any).gotrueRequestTimeoutMs = 1000;

    vi.mocked(checkDatabaseReadiness).mockResolvedValue({
      ok: true,
      missingTables: [],
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

    vi.mocked(db.execute).mockResolvedValueOnce([{ count: 0 }] as any);
    vi.mocked(db.execute).mockResolvedValueOnce([{ count: 0 }] as any);
    vi.mocked(db.execute).mockResolvedValueOnce([{ count: 1 }] as any);
    vi.mocked(db.select).mockReturnValue(q([]));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports no_users when runtime is healthy but auth has no users yet", async () => {
    const status = await getBootstrapStatus();

    expect(status.state).toBe("no_users");
    expect(status.nextStep).toBe("sign_in");
    expect(status.checks.dbReady).toBe(true);
    expect(status.checks.schemaReady).toBe(true);
    expect(status.checks.authReachable).toBe(true);
    expect(status.checks.usersExist).toBe(false);
  });

  it("reports needs_setup when placeholder tenant still exists after owner creation", async () => {
    vi.mocked(db.execute).mockReset();
    vi.mocked(db.execute).mockResolvedValueOnce([{ count: 1 }] as any);
    vi.mocked(db.execute).mockResolvedValueOnce([{ count: 1 }] as any);
    vi.mocked(db.execute).mockResolvedValueOnce([{ count: 1 }] as any);
    vi.mocked(db.select).mockReturnValueOnce(q([{ id: "tenant-1" }]));
    vi.mocked(db.select).mockReturnValueOnce(q([{ id: "proxy-1" }]));

    const status = await getBootstrapStatus();

    expect(status.state).toBe("needs_setup");
    expect(status.nextStep).toBe("complete_setup");
    expect(status.checks.placeholderTenantExists).toBe(true);
    expect(status.checks.bundledProxyRegistered).toBe(true);
  });

  it("reports sign_in as the next step when the first user exists but no owner membership has been established yet", async () => {
    vi.mocked(db.execute).mockReset();
    vi.mocked(db.execute).mockResolvedValueOnce([{ count: 1 }] as any);
    vi.mocked(db.execute).mockResolvedValueOnce([{ count: 0 }] as any);
    vi.mocked(db.execute).mockResolvedValueOnce([{ count: 1 }] as any);
    vi.mocked(db.select).mockReturnValueOnce(q([{ id: "tenant-1" }]));
    vi.mocked(db.select).mockReturnValueOnce(q([{ id: "proxy-1" }]));

    const status = await getBootstrapStatus();

    expect(status.state).toBe("needs_setup");
    expect(status.nextStep).toBe("sign_in");
    expect(status.checks.usersExist).toBe(true);
    expect(status.checks.ownerMembershipExists).toBe(false);
  });

  it("reports ready when users, owner membership, and bundled proxy are all in place", async () => {
    vi.mocked(db.execute).mockReset();
    vi.mocked(db.execute).mockResolvedValueOnce([{ count: 1 }] as any);
    vi.mocked(db.execute).mockResolvedValueOnce([{ count: 1 }] as any);
    vi.mocked(db.execute).mockResolvedValueOnce([{ count: 1 }] as any);
    vi.mocked(db.select).mockReturnValueOnce(q([]));
    vi.mocked(db.select).mockReturnValueOnce(q([{ id: "proxy-1" }]));

    const status = await getBootstrapStatus();

    expect(status.state).toBe("ready");
    expect(status.nextStep).toBe("done");
    expect(status.ok).toBe(true);
  });

  it("uses BOOTSTRAP_PROXY_ID when PROXY_ID is not present", async () => {
    delete process.env.PROXY_ID;
    process.env.BOOTSTRAP_PROXY_ID = TEST_PROXY_ID;

    vi.mocked(db.execute).mockReset();
    vi.mocked(db.execute).mockResolvedValueOnce([{ count: 1 }] as any);
    vi.mocked(db.execute).mockResolvedValueOnce([{ count: 1 }] as any);
    vi.mocked(db.execute).mockResolvedValueOnce([{ count: 1 }] as any);
    vi.mocked(db.select).mockReturnValueOnce(q([]));
    vi.mocked(db.select).mockReturnValueOnce(q([{ id: "proxy-1" }]));

    const status = await getBootstrapStatus();

    expect(status.checks.bundledProxyConfigured).toBe(true);
    expect(status.checks.bundledProxyRegistered).toBe(true);
    expect(status.state).toBe("ready");
  });

  it("reports auth_unreachable when GoTrue health fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    const status = await getBootstrapStatus();

    expect(status.state).toBe("auth_unreachable");
    expect(status.nextStep).toBe("wait_for_runtime");
    expect(status.checks.authReachable).toBe(false);
  });
});

/**
 * Unit tests for POST /internal/auth/token-hook
 *
 * Covers:
 *   - HMAC signature verification (missing, wrong secret, malformed)
 *   - Missing GOTRUE_HOOK_SECRET configuration
 *   - Invalid JSON body
 *   - Existing membership → stamps tenant_id + role from DB
 *   - New user → auto-provisions initial tenant membership
 *   - Existing claims fields are preserved in returned claims
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { TENANT_KIND } from "@customs/shared-constants";

// Mocks must be declared before imports of the modules they replace.
vi.mock("../../db/index.js");

import { Hono } from "hono";
import { config } from "../../config.js";
import { db } from "../../db/index.js";
import { internalRouter } from "../../routes/internal.js";
import {
  q,
  fakeMembership,
  TEST_TENANT_ID,
  TEST_USER_ID,
} from "../helpers/fakes.js";

const TEST_HOOK_SECRET = "test-hook-secret-32-characters!!";

const app = new Hono();
app.route("/", internalRouter);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_WEBHOOK_TS = "1700000000";
let currentWebhookId = "test-webhook-id-001";
let currentWebhookTs = TEST_WEBHOOK_TS;

function sign(
  body: string,
  secret = TEST_HOOK_SECRET,
  id = currentWebhookId,
  ts = currentWebhookTs,
): string {
  const signedPayload = `${id}.${ts}.${body}`;
  return (
    "v1," + createHmac("sha256", secret).update(signedPayload).digest("base64")
  );
}

function hookRequest(
  payload: object,
  secret = TEST_HOOK_SECRET,
  options: { id?: string; ts?: string } = {},
) {
  const body = JSON.stringify(payload);
  const webhookId = options.id ?? currentWebhookId;
  const webhookTs = options.ts ?? currentWebhookTs;
  return app.request("/internal/auth/token-hook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "webhook-id": webhookId,
      "webhook-timestamp": webhookTs,
      "webhook-signature": sign(body, secret, webhookId, webhookTs),
    },
    body,
  });
}

// ---------------------------------------------------------------------------
// Transaction mock — executes the callback with a fake tx whose select/insert
// behaviour can be overridden per-test by mutating mockTx properties.
// ---------------------------------------------------------------------------

let mockTx: {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  currentWebhookId = `test-webhook-id-${Math.random().toString(36).slice(2)}`;
  currentWebhookTs = Math.floor(Date.now() / 1000).toString();
  (config as any).gotrueHookSecret = TEST_HOOK_SECRET;

  mockTx = {
    select: vi.fn().mockReturnValue(q([fakeMembership()])), // default: returning user
    insert: vi.fn().mockReturnValue(q(undefined)),
    execute: vi.fn().mockResolvedValue([]),
  };

  // Re-apply after clearAllMocks
  vi.mocked(db.transaction).mockImplementation(async (callback: any) =>
    callback(mockTx),
  );
  vi.mocked(db.execute).mockResolvedValue([] as any);
});

// ---------------------------------------------------------------------------
// Configuration guard
// ---------------------------------------------------------------------------

describe("GOTRUE_HOOK_SECRET not set", () => {
  it("returns 500 when the hook secret env var is missing", async () => {
    (config as any).gotrueHookSecret = "";

    const body = JSON.stringify({ user_id: TEST_USER_ID });
    const res = await app.request("/internal/auth/token-hook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "webhook-signature": "v1,deadbeef",
      },
      body,
    });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error.code).toBe("SERVER_MISCONFIGURED");
  });
});

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

describe("signature verification", () => {
  it("returns 401 when webhook-signature header is absent", async () => {
    const body = JSON.stringify({ user_id: TEST_USER_ID });
    const res = await app.request("/internal/auth/token-hook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 when the signature is computed with the wrong secret", async () => {
    const res = await hookRequest(
      { user_id: TEST_USER_ID },
      "wrong-secret-entirely",
    );
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 when the signature payload is malformed", async () => {
    const body = JSON.stringify({ user_id: TEST_USER_ID });
    const res = await app.request("/internal/auth/token-hook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "webhook-id": currentWebhookId,
        "webhook-timestamp": currentWebhookTs,
        "webhook-signature": "v1,notvalidbase64!!!",
      },
      body,
    });

    expect(res.status).toBe(401);
  });

  it("returns 401 when the webhook timestamp is stale", async () => {
    vi.spyOn(Date, "now").mockReturnValue(
      (Number.parseInt(currentWebhookTs, 10) + 600) * 1000,
    );

    const res = await hookRequest({ user_id: TEST_USER_ID });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 409 when the same webhook-id is replayed within the cache window", async () => {
    const first = await hookRequest({ user_id: TEST_USER_ID });
    expect(first.status).toBe(200);

    const second = await hookRequest({ user_id: TEST_USER_ID });
    expect(second.status).toBe(409);
    const json = await second.json();
    expect(json.error.code).toBe("REPLAYED_WEBHOOK");
  });
});

// ---------------------------------------------------------------------------
// Request parsing
// ---------------------------------------------------------------------------

describe("request parsing", () => {
  it("returns 400 when the body is not valid JSON", async () => {
    const body = "not-json-at-all";
    const sig = sign(body);
    const res = await app.request("/internal/auth/token-hook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "webhook-id": currentWebhookId,
        "webhook-timestamp": currentWebhookTs,
        "webhook-signature": sig,
      },
      body,
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("BAD_REQUEST");
  });
});

// ---------------------------------------------------------------------------
// Membership lookup — returning user
// ---------------------------------------------------------------------------

describe("existing membership", () => {
  it("stamps tenant_id and role from the existing membership row", async () => {
    mockTx.select = vi
      .fn()
      .mockReturnValue(q([fakeMembership({ role: "admin" })]));

    const res = await hookRequest({ user_id: TEST_USER_ID });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.claims.app_metadata.tenant_id).toBe(TEST_TENANT_ID);
    expect(json.claims.app_metadata.tenant_kind).toBe(TENANT_KIND.CUSTOMER);
    expect(json.claims.app_metadata.role).toBe("admin");
    expect(json.claims.app_metadata.tenants[0].tenant_kind).toBe(
      TENANT_KIND.CUSTOMER,
    );
  });

  it("does not insert any rows when a membership already exists", async () => {
    await hookRequest({ user_id: TEST_USER_ID });
    expect(mockTx.insert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Auto-provision — new user
// ---------------------------------------------------------------------------

describe("new user (no membership)", () => {
  beforeEach(() => {
    mockTx.select = vi.fn().mockReturnValue(q([])); // no membership found
    mockTx.execute = vi.fn().mockResolvedValue([]);
  });

  it("returns 200 with the customer tenant active by default", async () => {
    const res = await hookRequest({ user_id: TEST_USER_ID });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.claims.app_metadata.tenant_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(json.claims.app_metadata.role).toBe("owner");
    expect(json.claims.app_metadata.tenant_kind).toBe(TENANT_KIND.CUSTOMER);
    expect(json.claims.app_metadata.tenants).toHaveLength(2);
    expect(
      json.claims.app_metadata.tenants.map(
        (tenant: any) => tenant.tenant_kind,
      ),
    ).toEqual([TENANT_KIND.CUSTOMER, TENANT_KIND.PLATFORM]);
  });

  it("inserts the first tenant pair and creates owner memberships for both", async () => {
    await hookRequest({ user_id: TEST_USER_ID });
    expect(mockTx.insert).toHaveBeenCalledTimes(4);
    expect(mockTx.insert.mock.results[0]?.value.values).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Platform", kind: TENANT_KIND.PLATFORM }),
    );
    expect(mockTx.insert.mock.results[1]?.value.values).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: TEST_USER_ID, role: "owner" }),
    );
    expect(mockTx.insert.mock.results[2]?.value.values).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "default-first-tenant",
        kind: TENANT_KIND.CUSTOMER,
      }),
    );
    expect(mockTx.insert.mock.results[3]?.value.values).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: TEST_USER_ID, role: "owner" }),
    );
  });

  it("inserts later auto-created tenants as customer", async () => {
    mockTx.execute = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 1 }]);

    await hookRequest({ user_id: TEST_USER_ID });

    expect(mockTx.insert.mock.results[0]?.value.values).toHaveBeenCalledWith(
      expect.objectContaining({ kind: TENANT_KIND.CUSTOMER }),
    );
  });

  it("claims the placeholder platform tenant and creates the first customer tenant", async () => {
    mockTx.execute = vi.fn().mockResolvedValue([
      {
        tenant_id: TEST_TENANT_ID,
        tenant_name: "default-first-tenant",
        tenant_kind: TENANT_KIND.PLATFORM,
      },
    ]);

    const res = await hookRequest({ user_id: TEST_USER_ID });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.claims.app_metadata.tenant_id).not.toBe(TEST_TENANT_ID);
    expect(json.claims.app_metadata.tenant_kind).toBe(TENANT_KIND.CUSTOMER);
    expect(json.claims.app_metadata.role).toBe("owner");
    expect(json.claims.app_metadata.tenants).toHaveLength(2);
    expect(json.claims.app_metadata.tenants[1]).toEqual(
      expect.objectContaining({
        tenant_id: TEST_TENANT_ID,
        tenant_kind: TENANT_KIND.PLATFORM,
      }),
    );
    expect(mockTx.insert).toHaveBeenCalledTimes(3);
  });

  it("claims an unowned platform/customer pair with the customer tenant active", async () => {
    const customerTenantId = "00000000-0000-0000-0000-000000000123";
    mockTx.execute = vi.fn().mockResolvedValue([
      {
        tenant_id: TEST_TENANT_ID,
        tenant_name: "Platform",
        tenant_kind: TENANT_KIND.PLATFORM,
      },
      {
        tenant_id: customerTenantId,
        tenant_name: "default-first-tenant",
        tenant_kind: TENANT_KIND.CUSTOMER,
      },
    ]);

    const res = await hookRequest({ user_id: TEST_USER_ID });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.claims.app_metadata.tenant_id).toBe(customerTenantId);
    expect(json.claims.app_metadata.tenant_kind).toBe(TENANT_KIND.CUSTOMER);
    expect(json.claims.app_metadata.tenants).toEqual([
      expect.objectContaining({
        tenant_id: customerTenantId,
        tenant_kind: TENANT_KIND.CUSTOMER,
      }),
      expect.objectContaining({
        tenant_id: TEST_TENANT_ID,
        tenant_kind: TENANT_KIND.PLATFORM,
      }),
    ]);
    expect(mockTx.insert).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Claims passthrough
// ---------------------------------------------------------------------------

describe("claims passthrough", () => {
  it("merges new claims into existing app_metadata without clobbering other fields", async () => {
    const res = await hookRequest({
      user_id: TEST_USER_ID,
      claims: { app_metadata: { existing_flag: true } },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.claims.app_metadata.existing_flag).toBe(true);
    expect(json.claims.app_metadata.tenant_id).toBe(TEST_TENANT_ID);
    expect(json.claims.app_metadata.role).toBe("owner");
  });

  it("preserves top-level claims fields outside app_metadata", async () => {
    const res = await hookRequest({
      user_id: TEST_USER_ID,
      claims: { email: "user@example.com", sub: TEST_USER_ID },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.claims.email).toBe("user@example.com");
    expect(json.claims.sub).toBe(TEST_USER_ID);
  });

  it("adds the mcp audience for oauth-issued client tokens", async () => {
    vi.mocked(db.execute).mockResolvedValueOnce([
      {
        registration_type: "dynamic",
        client_type: "public",
        token_endpoint_auth_method: "none",
        redirect_uris: "http://localhost:64881/callback",
      },
    ] as any);

    const res = await hookRequest({
      user_id: TEST_USER_ID,
      claims: {
        aud: "authenticated",
        client_id: "a1fcb0fc-3ad5-476f-bb16-e45a89502747",
      },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.claims.aud).toEqual(["authenticated", "mcp"]);
  });

  it("does not add the mcp audience for non-MCP oauth clients", async () => {
    vi.mocked(db.execute).mockResolvedValueOnce([
      {
        registration_type: "manual",
        client_type: "confidential",
        token_endpoint_auth_method: "client_secret_basic",
        redirect_uris: "https://app.customs.local/callback",
      },
    ] as any);

    const res = await hookRequest({
      user_id: TEST_USER_ID,
      claims: {
        aud: "authenticated",
        client_id: "0d0f3c1f-c7bf-463d-b9f2-523be09b2d62",
      },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.claims.aud).toBe("authenticated");
  });

  it("does not add the mcp audience for normal dashboard tokens", async () => {
    const res = await hookRequest({
      user_id: TEST_USER_ID,
      claims: {
        aud: "authenticated",
      },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.claims.aud).toBe("authenticated");
  });
});

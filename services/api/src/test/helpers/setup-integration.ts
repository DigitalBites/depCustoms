/**
 * Global setup for integration tests.
 * Runs once before all integration test files.
 *
 * Required env:
 *   DATABASE_URL — always required
 *
 * Optional env (enables real GoTrue JWT for future REST integration tests):
 *   AUTH_URL              — auth URL (API proxies /auth/v1/* to GoTrue)
 *   GOTRUE_SERVICE_ROLE_KEY — service role key for admin user creation
 *
 * When both vars are present, a throwaway test user is created in
 * auth.users, a JWT is obtained, and stored as TEST_AUTH_TOKEN in the process
 * environment for any HTTP integration tests to consume.
 */

import { db } from "../../db/index.js";
import { tenants } from "../../db/schema.js";
import { eq } from "drizzle-orm";

const TEST_USER_EMAIL = `test-${Date.now()}@customs-integration.test`;
const TEST_USER_PASSWORD =
  "integration-test-password-" + Math.random().toString(36).slice(2);

export async function setup() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required for integration tests.\n" +
        "Run: npm run test:integration (starts Postgres automatically)",
    );
  }

  // Optional: set up real GoTrue auth for HTTP integration tests.
  // DB schema tests do not require this.
  const authUrl = process.env.AUTH_URL;
  const serviceKey = process.env.GOTRUE_SERVICE_ROLE_KEY;

  if (!authUrl || !serviceKey) {
    return; // DB-only tests — no GoTrue setup needed
  }

  // Create throwaway test user via GoTrue admin API
  const createResp = await fetch(`${authUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: TEST_USER_EMAIL,
      password: TEST_USER_PASSWORD,
      email_confirm: true,
    }),
  });

  if (!createResp.ok) {
    const detail = await createResp.text().catch(() => "");
    throw new Error(`Failed to create integration test user: ${detail}`);
  }

  const created = (await createResp.json()) as { id?: string };
  if (!created.id) {
    throw new Error("GoTrue did not return a user id on creation");
  }

  process.env.TEST_AUTH_USER_ID = created.id;

  // Exchange credentials for a real JWT
  const anonKey = process.env.GOTRUE_ANON_KEY;
  if (anonKey) {
    const signInResp = await fetch(
      `${authUrl}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: { apikey: anonKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          email: TEST_USER_EMAIL,
          password: TEST_USER_PASSWORD,
        }),
      },
    );

    if (signInResp.ok) {
      const session = (await signInResp.json()) as { access_token?: string };
      const token = session.access_token;
      if (token) {
        process.env.TEST_AUTH_TOKEN = token;

        // Decode JWT payload to extract the tenant_id stamped by the token hook.
        // The hook auto-provisions a tenant on first login — we need its id for teardown.
        try {
          const [, payloadB64] = token.split(".");
          const jwtPayload = JSON.parse(
            Buffer.from(payloadB64, "base64url").toString(),
          );
          const tenantId = jwtPayload?.app_metadata?.tenant_id as
            | string
            | undefined;
          if (tenantId) {
            process.env.TEST_AUTH_TENANT_ID = tenantId;
          }
        } catch {
          // Non-fatal — schema tests don't need tenant_id
        }
      }
    }
  }
}

export async function teardown() {
  const authUrl = process.env.AUTH_URL;
  const serviceKey = process.env.GOTRUE_SERVICE_ROLE_KEY;
  const userId = process.env.TEST_AUTH_USER_ID;

  if (!authUrl || !serviceKey || !userId) return;

  // Delete the auto-provisioned tenant first (cascades memberships).
  const tenantId = process.env.TEST_AUTH_TENANT_ID;
  if (tenantId) {
    await db
      .delete(tenants)
      .where(eq(tenants.id, tenantId))
      .catch(() => {});
  }

  await fetch(`${authUrl}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
  }).catch(() => {});

  delete process.env.TEST_AUTH_USER_ID;
  delete process.env.TEST_AUTH_TOKEN;
  delete process.env.TEST_AUTH_TENANT_ID;
}

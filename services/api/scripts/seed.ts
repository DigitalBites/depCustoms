/**
 * Seed script — populates a fresh database with dev tenants, projects, users,
 * and memberships designed to exercise every role and access pattern.
 *
 * What gets created:
 *
 *   Tenant 1 — "Dev Tenant"
 *     - dev@customs.local          owner    (also a member of Tenant 2 → triggers tenant picker)
 *     - dev-member@customs.local   member   (project-scoped: test-project only)
 *     Projects: test-project (with token, policies, rules), test-project-b
 *
 *   Tenant 2 — "Second Tenant"
 *     - dev@customs.local          admin    (same user — multi-tenant)
 *     - dev-tenant2@customs.local  owner    (single-tenant user)
 *     Projects: tenant2-project (with token, policy)
 *
 * Usage:
 *   npm run seed
 *
 * Prerequisites:
 *   - Local Supabase stack running (docker compose up)
 *   - AUTH_URL + GOTRUE_SERVICE_ROLE_KEY set in your .env
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { db } from "../src/db/index.js";
import {
  tenants,
  memberships,
  projects,
  project_tokens,
  project_members,
  policies,
  policy_assignments,
  rules,
  proxies,
  tenant_entitlements,
} from "../src/db/schema.js";

// ---------------------------------------------------------------------------
// Dev user credentials
// ---------------------------------------------------------------------------
const USERS = {
  devOwner: {
    email: "dev@customs.local",
    password: "devpassword123",
    label: "Multi-tenant user (owner T1, admin T2)",
  },
  devTenant2: {
    email: "dev-tenant2@customs.local",
    password: "devpassword123",
    label: "Tenant 2 only user (owner T2)",
  },
  devMember: {
    email: "dev-member@customs.local",
    password: "devpassword123",
    label: "Project-scoped member (member T1, test-project only)",
  },
} as const;

function log(msg: string, fields: Record<string, unknown> = {}) {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      service: "seed",
      message: msg,
      ...fields,
    }),
  );
}

function warn(msg: string, fields: Record<string, unknown> = {}) {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "warn",
      service: "seed",
      message: msg,
      ...fields,
    }),
  );
}

// ---------------------------------------------------------------------------
// Helper: create or find a GoTrue auth user by email.
// Returns the user's UUID.
// ---------------------------------------------------------------------------
async function upsertAuthUser(
  authUrl: string,
  serviceKey: string,
  email: string,
  password: string,
): Promise<string> {
  const headers = {
    Authorization: `Bearer ${serviceKey}`,
    apikey: serviceKey,
    "Content-Type": "application/json",
  };

  const createResp = await fetch(`${authUrl}/admin/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });

  if (createResp.ok) {
    const data = (await createResp.json()) as { id: string };
    log(`Created auth user`, { email });
    return data.id;
  }

  // Already exists — find by email
  if (createResp.status === 422) {
    const listResp = await fetch(`${authUrl}/admin/users?per_page=1000`, {
      headers,
    });
    if (!listResp.ok)
      throw new Error(`Failed to list users: ${await listResp.text()}`);
    const { users } = (await listResp.json()) as {
      users: { id: string; email?: string }[];
    };
    const existing = users.find((u) => u.email === email);
    if (!existing)
      throw new Error(`createUser failed and could not find existing user`);
    log(`Found existing auth user`, { email, user_id: existing.id });
    return existing.id;
  }

  throw new Error(
    `Failed to create auth user ${email}: ${await createResp.text()}`,
  );
}

// ---------------------------------------------------------------------------
// Helper: generate a project token, insert it, return the raw value.
// ---------------------------------------------------------------------------
async function insertToken(
  projectId: string,
  tenantId: string,
  name: string,
  createdById: string,
): Promise<string> {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const tokenPrefix = rawToken.slice(-6);

  await db.insert(project_tokens).values({
    project_id: projectId,
    tenant_id: tenantId,
    name,
    token_hash: tokenHash,
    token_prefix: tokenPrefix,
    created_by_user_id: createdById,
  });

  return rawToken;
}

// ---------------------------------------------------------------------------
// Helper: register a dev proxy, return { proxyId, secret }.
// ---------------------------------------------------------------------------
async function insertProxy(tenantId: string, name: string) {
  const proxyId = randomUUID();
  const rawSecret = "cxp_" + randomBytes(16).toString("hex");
  const secretHash = createHash("sha256").update(rawSecret).digest("hex");
  const secretPrefix = rawSecret.slice(0, 12);

  await db.insert(proxies).values({
    tenant_id: tenantId,
    proxy_id: proxyId,
    name,
    secret_hash: secretHash,
    secret_prefix: secretPrefix,
  });

  return { proxyId, rawSecret };
}

async function seed() {
  log("Starting seed");

  // The seed calls GoTrue admin APIs directly — use GOTRUE_URL (the internal
  // direct URL to GoTrue, e.g. http://localhost:9999) rather than AUTH_URL
  // (which routes through the Hono proxy and requires the API to be running).
  const gotrueUrl = process.env.GOTRUE_URL;
  const serviceKey = process.env.GOTRUE_SERVICE_ROLE_KEY;

  if (!gotrueUrl || !serviceKey) {
    throw new Error(
      "GOTRUE_URL and GOTRUE_SERVICE_ROLE_KEY are required.\n" +
        "Start the local stack: docker compose up",
    );
  }

  // alias for the upsertAuthUser calls below
  const authUrl = gotrueUrl;

  // =========================================================================
  // Auth users
  // =========================================================================
  log("--- Creating auth users ---");

  const [ownerUserId, tenant2UserId, memberUserId] = await Promise.all([
    upsertAuthUser(
      authUrl,
      serviceKey,
      USERS.devOwner.email,
      USERS.devOwner.password,
    ),
    upsertAuthUser(
      authUrl,
      serviceKey,
      USERS.devTenant2.email,
      USERS.devTenant2.password,
    ),
    upsertAuthUser(
      authUrl,
      serviceKey,
      USERS.devMember.email,
      USERS.devMember.password,
    ),
  ]);

  // =========================================================================
  // Tenant 1 — "Dev Tenant"
  // =========================================================================
  log("--- Setting up Tenant 1: Dev Tenant ---");

  const tenant1Id = randomUUID();
  await db.insert(tenants).values({ id: tenant1Id, name: "Dev Tenant" });
  log("Inserted tenant", { tenant_id: tenant1Id, name: "Dev Tenant" });

  // Memberships for Tenant 1
  await db.insert(memberships).values([
    { tenant_id: tenant1Id, user_id: ownerUserId, role: "owner" },
    { tenant_id: tenant1Id, user_id: memberUserId, role: "member" },
  ]);
  log("Inserted memberships", {
    tenant_id: tenant1Id,
    owner: USERS.devOwner.email,
    member: USERS.devMember.email,
  });

  // Tenant 1 entitlement
  await db.insert(tenant_entitlements).values({
    tenant_id: tenant1Id,
    allowed_ecosystems: null,
    serve_mode: "SERVE_MODE_REDIRECT",
    cache_ttl_seconds: 300,
    mcp_enabled: true,
  });

  // Tenant 1 Projects
  const [t1ProjectA] = await db
    .insert(projects)
    .values({ tenant_id: tenant1Id, name: "test-project" })
    .returning();
  log("Inserted project", { project_id: t1ProjectA.id, name: "test-project" });

  const [t1ProjectB] = await db
    .insert(projects)
    .values({ tenant_id: tenant1Id, name: "test-project-b" })
    .returning();
  log("Inserted project", {
    project_id: t1ProjectB.id,
    name: "test-project-b",
  });

  // dev-member gets explicit access to test-project only
  await db.insert(project_members).values({
    project_id: t1ProjectA.id,
    tenant_id: tenant1Id,
    user_id: memberUserId,
  });
  log("Inserted project_member", {
    project: "test-project",
    user: USERS.devMember.email,
  });

  // ---------------------------------------------------------------------------
  // Tenant 1 — Global security policy (applies to all projects via assignments)
  // Blocks packages with critical or high CVEs from OSV.
  // ---------------------------------------------------------------------------
  const [t1GlobalPolicy] = await db
    .insert(policies)
    .values({
      tenant_id: tenant1Id,
      project_id: null,
      name: "Default Security Policy",
      description: "Blocks packages with critical or high CVEs detected by OSV",
      category: "vulnerability-management",
      scope: "global",
      status: "active",
      enforcement_mode: "enforcing",
      priority: 100,
      created_by: ownerUserId,
    })
    .returning();
  log("Inserted global policy", { policy_id: t1GlobalPolicy.id });

  await db.insert(rules).values([
    {
      policy_id: t1GlobalPolicy.id,
      tenant_id: tenant1Id,
      name: "Block Critical CVEs",
      description: "Blocks any package with one or more critical-severity CVEs",
      target_entity: "artifact",
      condition: {
        field: "source.osv.critical_count",
        operator: "gt",
        value: 0,
      },
      action: {
        type: "violation",
        severity: "critical",
        code: "OSV_CRITICAL_CVE",
        enforcement_mode: "enforcing",
        message_template:
          "Package has {{source.osv.critical_count}} critical CVE(s)",
      },
      enabled: true,
      order_index: 0,
    },
    {
      policy_id: t1GlobalPolicy.id,
      tenant_id: tenant1Id,
      name: "Block High CVEs",
      description: "Blocks any package with one or more high-severity CVEs",
      target_entity: "artifact",
      condition: { field: "source.osv.high_count", operator: "gt", value: 0 },
      action: {
        type: "violation",
        severity: "high",
        code: "OSV_HIGH_CVE",
        enforcement_mode: "enforcing",
        message_template: "Package has {{source.osv.high_count}} high CVE(s)",
      },
      enabled: true,
      order_index: 1,
    },
  ]);
  log("Inserted global policy rules", {
    policy_id: t1GlobalPolicy.id,
    count: 2,
  });

  // Assign global policy to both projects
  await db.insert(policy_assignments).values([
    {
      policy_id: t1GlobalPolicy.id,
      project_id: t1ProjectA.id,
      tenant_id: tenant1Id,
      enabled: true,
      inheritance_mode: "inherited",
    },
    {
      policy_id: t1GlobalPolicy.id,
      project_id: t1ProjectB.id,
      tenant_id: tenant1Id,
      enabled: true,
      inheritance_mode: "inherited",
    },
  ]);
  log("Assigned global policy to projects");

  // ---------------------------------------------------------------------------
  // Tenant 1 — Contributor Risk Policy (supply chain / maintainer-level signals)
  // Blocks packages where contributor_risk_score >= 80 (high-confidence: new actor,
  // fresh account, or high-velocity release). Requires CONNECTOR_CONTRIBUTOR_ENABLED=true.
  // When the contributor connector is disabled, source.contributor.contributor_risk_score
  // resolves to null and this rule never fires.
  // ---------------------------------------------------------------------------
  const [t1ContributorPolicy] = await db
    .insert(policies)
    .values({
      tenant_id: tenant1Id,
      project_id: null,
      name: "Contributor Risk Policy",
      description: "Blocks packages with elevated contributor risk scores (new maintainer, fresh account, high velocity)",
      category: "supply-chain",
      scope: "global",
      status: "active",
      enforcement_mode: "enforcing",
      priority: 110,
      created_by: ownerUserId,
    })
    .returning();
  log("Inserted contributor risk policy", { policy_id: t1ContributorPolicy.id });

  await db.insert(rules).values({
    policy_id: t1ContributorPolicy.id,
    tenant_id: tenant1Id,
    name: "Block High Contributor Risk",
    description: "Blocks packages with contributor risk score >= 80 (new actor, fresh account, or high release velocity)",
    target_entity: "artifact",
    condition: {
      field: "source.contributor.contributor_risk_score",
      operator: "gte",
      value: 80,
    },
    action: {
      type: "violation",
      severity: "high",
      code: "CONTRIBUTOR_RISK_HIGH",
      enforcement_mode: "enforcing",
      message_template:
        "Package has contributor risk score {{source.contributor.contributor_risk_score}} (threshold: 80)",
      recommended_remediation:
        "Review the package maintainer history and recent releases before upgrading",
    },
    enabled: true,
    order_index: 0,
  });
  log("Inserted contributor risk rule", { policy_id: t1ContributorPolicy.id });

  await db.insert(policy_assignments).values([
    {
      policy_id: t1ContributorPolicy.id,
      project_id: t1ProjectA.id,
      tenant_id: tenant1Id,
      enabled: true,
      inheritance_mode: "inherited",
    },
    {
      policy_id: t1ContributorPolicy.id,
      project_id: t1ProjectB.id,
      tenant_id: tenant1Id,
      enabled: true,
      inheritance_mode: "inherited",
    },
  ]);
  log("Assigned contributor risk policy to projects");

  // ---------------------------------------------------------------------------
  // Tenant 1 — Project-scoped advisory policy for test-project
  // Warns (advisory) about medium CVEs without blocking.
  // ---------------------------------------------------------------------------
  const [t1ProjectAPolicy] = await db
    .insert(policies)
    .values({
      tenant_id: tenant1Id,
      project_id: t1ProjectA.id,
      name: "Medium CVE Advisory",
      description:
        "Advisory warnings for medium-severity CVEs — does not block",
      category: "vulnerability-management",
      scope: "project",
      status: "active",
      enforcement_mode: "advisory",
      priority: 200,
      created_by: ownerUserId,
    })
    .returning();

  await db.insert(rules).values({
    policy_id: t1ProjectAPolicy.id,
    tenant_id: tenant1Id,
    name: "Warn on Medium CVEs",
    description:
      "Advisory: flags packages with medium-severity CVEs for review",
    target_entity: "artifact",
    condition: { field: "source.osv.medium_count", operator: "gt", value: 0 },
    action: {
      type: "violation",
      severity: "medium",
      code: "OSV_MEDIUM_CVE",
      enforcement_mode: "advisory",
      message_template:
        "Package has {{source.osv.medium_count}} medium CVE(s) — review recommended",
    },
    enabled: true,
    order_index: 0,
  });
  log("Inserted project-scoped advisory policy", {
    policy_id: t1ProjectAPolicy.id,
  });

  // Tokens
  const t1TokenA = await insertToken(
    t1ProjectA.id,
    tenant1Id,
    "default",
    ownerUserId,
  );
  const t1TokenB = await insertToken(
    t1ProjectB.id,
    tenant1Id,
    "default",
    ownerUserId,
  );
  log("Inserted project tokens");

  // Proxy
  const t1Proxy = await insertProxy(tenant1Id, "dev-proxy");
  log("Inserted proxy", { proxy_id: t1Proxy.proxyId });

  // =========================================================================
  // Tenant 2 — "Second Tenant"
  // =========================================================================
  log("--- Setting up Tenant 2: Second Tenant ---");

  const tenant2Id = randomUUID();
  await db.insert(tenants).values({ id: tenant2Id, name: "Second Tenant" });
  log("Inserted tenant", { tenant_id: tenant2Id, name: "Second Tenant" });

  // Memberships for Tenant 2
  // dev@customs.local is admin here (not owner) — tests different roles per tenant
  await db.insert(memberships).values([
    { tenant_id: tenant2Id, user_id: tenant2UserId, role: "owner" },
    { tenant_id: tenant2Id, user_id: ownerUserId, role: "admin" },
  ]);
  log("Inserted memberships", {
    tenant_id: tenant2Id,
    owner: USERS.devTenant2.email,
    admin: USERS.devOwner.email,
  });

  // Tenant 2 entitlement
  await db.insert(tenant_entitlements).values({
    tenant_id: tenant2Id,
    allowed_ecosystems: null,
    serve_mode: "SERVE_MODE_REDIRECT",
    cache_ttl_seconds: 300,
    mcp_enabled: true,
  });

  // Tenant 2 Project
  const [t2Project] = await db
    .insert(projects)
    .values({ tenant_id: tenant2Id, name: "tenant2-project" })
    .returning();
  log("Inserted project", {
    project_id: t2Project.id,
    name: "tenant2-project",
  });

  // ---------------------------------------------------------------------------
  // Tenant 2 — Strict global policy: block any package with any CVE
  // ---------------------------------------------------------------------------
  const [t2GlobalPolicy] = await db
    .insert(policies)
    .values({
      tenant_id: tenant2Id,
      project_id: null,
      name: "Strict Security Policy",
      description: "Blocks any package with any vulnerability (zero-tolerance)",
      category: "vulnerability-management",
      scope: "global",
      status: "active",
      enforcement_mode: "enforcing",
      priority: 100,
      created_by: tenant2UserId,
    })
    .returning();

  await db.insert(rules).values({
    policy_id: t2GlobalPolicy.id,
    tenant_id: tenant2Id,
    name: "Block Any CVE",
    description: "Blocks any package with any vulnerability detected by OSV",
    target_entity: "artifact",
    condition: { field: "source.osv.vuln_count", operator: "gt", value: 0 },
    action: {
      type: "violation",
      severity: "high",
      code: "ANY_CVE",
      enforcement_mode: "enforcing",
      message_template:
        "Package has {{source.osv.vuln_count}} vulnerability(s) — zero-tolerance policy",
    },
    enabled: true,
    order_index: 0,
  });

  await db.insert(policy_assignments).values({
    policy_id: t2GlobalPolicy.id,
    project_id: t2Project.id,
    tenant_id: tenant2Id,
    enabled: true,
    inheritance_mode: "inherited",
  });
  log("Inserted global policy and rules for Tenant 2", {
    policy_id: t2GlobalPolicy.id,
  });

  const t2Token = await insertToken(
    t2Project.id,
    tenant2Id,
    "default",
    ownerUserId,
  );
  log("Inserted project token");

  const t2Proxy = await insertProxy(tenant2Id, "dev-proxy-t2");
  log("Inserted proxy", { proxy_id: t2Proxy.proxyId });

  // =========================================================================
  // Summary output
  // =========================================================================
  log("Seed complete");

  warn("=== TENANT 1: Dev Tenant ===", {
    tenant_id: tenant1Id,
    projects: {
      "test-project": t1ProjectA.id,
      "test-project-b": t1ProjectB.id,
    },
  });

  warn("Tenant 1 — project tokens (save these)", {
    "test-project token": t1TokenA,
    "test-project-b token": t1TokenB,
  });

  warn("Tenant 1 — proxy credentials", {
    PROXY_ID: t1Proxy.proxyId,
    PROXY_CONTROL_PLANE_SECRET: t1Proxy.rawSecret,
  });

  warn("=== TENANT 2: Second Tenant ===", {
    tenant_id: tenant2Id,
    projects: {
      "tenant2-project": t2Project.id,
    },
  });

  warn("Tenant 2 — project token (save this)", {
    "tenant2-project token": t2Token,
  });

  warn("Tenant 2 — proxy credentials", {
    PROXY_ID: t2Proxy.proxyId,
    PROXY_CONTROL_PLANE_SECRET: t2Proxy.rawSecret,
  });

  warn("=== USER ACCOUNTS (all password: devpassword123) ===", {
    users: [
      {
        email: USERS.devOwner.email,
        note: USERS.devOwner.label,
        memberships: [
          { tenant: "Dev Tenant", role: "owner" },
          { tenant: "Second Tenant", role: "admin" },
        ],
      },
      {
        email: USERS.devTenant2.email,
        note: USERS.devTenant2.label,
        memberships: [{ tenant: "Second Tenant", role: "owner" }],
      },
      {
        email: USERS.devMember.email,
        note: USERS.devMember.label,
        memberships: [
          { tenant: "Dev Tenant", role: "member", projects: ["test-project"] },
        ],
        "no access to": ["test-project-b", "Second Tenant"],
      },
    ],
  });

  warn("Sign in at http://localhost:3001/login");

  process.exit(0);
}

seed().catch((err) => {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      service: "seed",
      message: "Seed failed",
      error: err instanceof Error ? err.message : String(err),
    }),
  );
  process.exit(1);
});

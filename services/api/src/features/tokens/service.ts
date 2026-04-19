import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { authAdminService } from "../../auth/admin-service.js";
import { db } from "../../db/index.js";
import { project_tokens } from "../../db/schema.js";
import {
  canPerform,
  isTenantRole,
  type TenantRole,
} from "../../middleware/rbac.js";

type TokenActorSummary = {
  email: string | null;
  provider: string | null;
};

type ExistingTokenRow = {
  id: string;
  created_by_user_id: string | null;
  revoked_at: Date | null;
};

type RotatableTokenRow = ExistingTokenRow & {
  name: string;
  expires_at: Date | null;
};

export function resolveTenantRole(role: string): TenantRole | null {
  return isTenantRole(role) ? role : null;
}

export function canCreateProjectToken(role: string): boolean {
  const tenantRole = resolveTenantRole(role);
  return !!tenantRole && canPerform(tenantRole, "tokens.create");
}

export function canReadProjectTokens(role: string) {
  const tenantRole = resolveTenantRole(role);
  return {
    canReadAll: tenantRole ? canPerform(tenantRole, "tokens.read_all") : false,
    canReadOwn: tenantRole ? canPerform(tenantRole, "tokens.read_own") : false,
  };
}

export function canManageExistingToken(input: {
  role: string;
  action: "revoke" | "rotate";
  ownsToken: boolean;
}): boolean {
  const tenantRole = resolveTenantRole(input.role);
  if (!tenantRole) return false;

  if (input.action === "revoke") {
    return (
      canPerform(tenantRole, "tokens.revoke_any") ||
      canPerform(tenantRole, "tokens.revoke_own", {
        ownsToken: input.ownsToken,
      })
    );
  }

  return (
    canPerform(tenantRole, "tokens.rotate_any") ||
    canPerform(tenantRole, "tokens.rotate_own", { ownsToken: input.ownsToken })
  );
}

function generateProjectToken() {
  const token = randomBytes(32).toString("hex");
  return {
    token,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    tokenPrefix: token.slice(-6),
  };
}

async function loadTokenActorSummaries(
  userIds: string[],
): Promise<Map<string, TokenActorSummary>> {
  if (userIds.length === 0) {
    return new Map();
  }

  const requestedIds = new Set(userIds);
  const users = await authAdminService.listUsers();
  const summaries = new Map<string, TokenActorSummary>();

  for (const user of users) {
    if (!requestedIds.has(user.id)) {
      continue;
    }

    summaries.set(user.id, {
      email: user.email ?? null,
      provider:
        typeof user.app_metadata?.provider === "string"
          ? user.app_metadata.provider
          : null,
    });
  }

  return summaries;
}

function buildTokenActor(
  userId: string | null,
  summaries: Map<string, TokenActorSummary>,
) {
  if (!userId) {
    return null;
  }

  const summary = summaries.get(userId);
  return {
    user_id: userId,
    email: summary?.email ?? null,
    provider: summary?.provider ?? null,
  };
}

export async function createProjectToken(input: {
  projectId: string;
  tenantId: string;
  userId: string;
  name: string;
  expiresAt: Date | null;
}) {
  const generated = generateProjectToken();

  const [row] = await db
    .insert(project_tokens)
    .values({
      project_id: input.projectId,
      tenant_id: input.tenantId,
      name: input.name,
      created_by_user_id: input.userId,
      token_hash: generated.tokenHash,
      token_prefix: generated.tokenPrefix,
      expires_at: input.expiresAt,
    })
    .returning({
      id: project_tokens.id,
      token_prefix: project_tokens.token_prefix,
      expires_at: project_tokens.expires_at,
    });

  return {
    token: generated.token,
    id: row.id,
    prefix: row.token_prefix,
    expires_at: row.expires_at?.toISOString() ?? null,
  };
}

export async function listProjectTokens(input: {
  projectId: string;
  userId: string;
  canReadAll: boolean;
}) {
  const baseQuery = db
    .select({
      id: project_tokens.id,
      name: project_tokens.name,
      token_prefix: project_tokens.token_prefix,
      created_at: project_tokens.created_at,
      last_used_at: project_tokens.last_used_at,
      expires_at: project_tokens.expires_at,
      revoked_at: project_tokens.revoked_at,
      created_by_user_id: project_tokens.created_by_user_id,
      revoked_by_user_id: project_tokens.revoked_by_user_id,
    })
    .from(project_tokens)
    .orderBy(project_tokens.created_at);

  const rows = await (input.canReadAll
    ? baseQuery.where(eq(project_tokens.project_id, input.projectId))
    : baseQuery.where(
        and(
          eq(project_tokens.project_id, input.projectId),
          eq(project_tokens.created_by_user_id, input.userId),
        ),
      ));

  let actorSummaries = new Map<string, TokenActorSummary>();
  if (input.canReadAll) {
    const actorIds = [
      ...new Set(
        rows.flatMap((row) =>
          [row.created_by_user_id, row.revoked_by_user_id].filter(
            (value): value is string => !!value,
          ),
        ),
      ),
    ];

    try {
      actorSummaries = await loadTokenActorSummaries(actorIds);
    } catch {
      actorSummaries = new Map();
    }
  }

  return rows.map((row) => ({
    ...row,
    created_by: buildTokenActor(row.created_by_user_id, actorSummaries),
    revoked_by: buildTokenActor(row.revoked_by_user_id, actorSummaries),
  }));
}

export async function loadExistingProjectToken(
  tokenId: string,
  projectId: string,
): Promise<ExistingTokenRow | null> {
  const [row] = await db
    .select({
      id: project_tokens.id,
      created_by_user_id: project_tokens.created_by_user_id,
      revoked_at: project_tokens.revoked_at,
    })
    .from(project_tokens)
    .where(
      and(
        eq(project_tokens.id, tokenId),
        eq(project_tokens.project_id, projectId),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function revokeProjectToken(input: {
  tokenId: string;
  projectId: string;
  userId: string;
}) {
  const [revoked] = await db
    .update(project_tokens)
    .set({ revoked_at: new Date(), revoked_by_user_id: input.userId })
    .where(
      and(
        eq(project_tokens.id, input.tokenId),
        eq(project_tokens.project_id, input.projectId),
        isNull(project_tokens.revoked_at),
      ),
    )
    .returning({ id: project_tokens.id });

  return revoked ?? null;
}

export async function loadRotatableProjectToken(
  tokenId: string,
  projectId: string,
): Promise<RotatableTokenRow | null> {
  const [row] = await db
    .select({
      id: project_tokens.id,
      name: project_tokens.name,
      created_by_user_id: project_tokens.created_by_user_id,
      expires_at: project_tokens.expires_at,
      revoked_at: project_tokens.revoked_at,
    })
    .from(project_tokens)
    .where(
      and(
        eq(project_tokens.id, tokenId),
        eq(project_tokens.project_id, projectId),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function rotateProjectToken(input: {
  tokenId: string;
  projectId: string;
  tenantId: string;
  userId: string;
  existing: RotatableTokenRow;
}) {
  const generated = generateProjectToken();
  const now = new Date();

  const [rotated] = await db.transaction(async (tx) => {
    const [nextToken] = await tx
      .insert(project_tokens)
      .values({
        project_id: input.projectId,
        tenant_id: input.tenantId,
        name: input.existing.name,
        created_by_user_id: input.userId,
        token_hash: generated.tokenHash,
        token_prefix: generated.tokenPrefix,
        expires_at: input.existing.expires_at,
      })
      .returning({
        id: project_tokens.id,
        token_prefix: project_tokens.token_prefix,
        expires_at: project_tokens.expires_at,
      });

    await tx
      .update(project_tokens)
      .set({
        revoked_at: now,
        revoked_by_user_id: input.userId,
      })
      .where(
        and(
          eq(project_tokens.id, input.tokenId),
          eq(project_tokens.project_id, input.projectId),
          isNull(project_tokens.revoked_at),
        ),
      );

    return [nextToken];
  });

  return {
    token: generated.token,
    id: rotated.id,
    prefix: rotated.token_prefix,
    expires_at: rotated.expires_at?.toISOString() ?? null,
  };
}

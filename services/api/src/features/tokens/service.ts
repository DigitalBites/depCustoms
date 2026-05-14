import { randomBytes } from "node:crypto";
import { hashProjectToken } from "../../auth/hashing.js";
import { and, eq, isNull } from "drizzle-orm";
import {
  ACTOR_RESOLUTION_MODE,
  CAPABILITY,
  type ActorResolutionMode,
} from "@customs/shared-constants";
import { db } from "../../db/index.js";
import { project_tokens } from "../../db/schema.js";
import {
  canPerform,
  isTenantRole,
  type TenantRole,
} from "../../middleware/rbac.js";
import { actorFromMap, resolveActorRefs } from "../actors/resolver.js";

type ExistingTokenRow = {
  id: string;
  owner_user_id: string;
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
  return !!tenantRole && canPerform(tenantRole, CAPABILITY.TOKENS_CREATE);
}

export function canReadProjectTokens(role: string) {
  const tenantRole = resolveTenantRole(role);
  return {
    canReadAll: tenantRole
      ? canPerform(tenantRole, CAPABILITY.TOKENS_READ_ALL)
      : false,
    canReadOwn: tenantRole
      ? canPerform(tenantRole, CAPABILITY.TOKENS_READ_OWN)
      : false,
    canReadActorProfiles: tenantRole
      ? canPerform(tenantRole, CAPABILITY.MEMBERS_READ)
      : false,
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
      canPerform(tenantRole, CAPABILITY.TOKENS_REVOKE_ANY) ||
      canPerform(tenantRole, CAPABILITY.TOKENS_REVOKE_OWN, {
        ownsToken: input.ownsToken,
      })
    );
  }

  return (
    canPerform(tenantRole, CAPABILITY.TOKENS_ROTATE_ANY) ||
    canPerform(tenantRole, CAPABILITY.TOKENS_ROTATE_OWN, {
      ownsToken: input.ownsToken,
    })
  );
}

function generateProjectToken() {
  const token = randomBytes(32).toString("hex");
  return {
    token,
    tokenHash: hashProjectToken(token),
    tokenPrefix: token.slice(-6),
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
      owner_user_id: input.userId,
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
  actorResolutionMode?: ActorResolutionMode;
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
      owner_user_id: project_tokens.owner_user_id,
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
          eq(project_tokens.owner_user_id, input.userId),
        ),
      ));

  const actorResolutionMode =
    input.actorResolutionMode ?? ACTOR_RESOLUTION_MODE.IDS_ONLY;
  const actors = await resolveActorRefs(
    rows.flatMap((row) => [
      row.owner_user_id,
      row.created_by_user_id,
      row.revoked_by_user_id,
    ]),
    actorResolutionMode,
  );

  return rows.map((row) => ({
    ...row,
    owner: actorFromMap(row.owner_user_id, actors),
    created_by: actorFromMap(row.created_by_user_id, actors),
    revoked_by: actorFromMap(row.revoked_by_user_id, actors),
  }));
}

export async function loadExistingProjectToken(
  tokenId: string,
  projectId: string,
): Promise<ExistingTokenRow | null> {
  const [row] = await db
    .select({
      id: project_tokens.id,
      owner_user_id: project_tokens.owner_user_id,
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
      owner_user_id: project_tokens.owner_user_id,
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
        owner_user_id: input.existing.owner_user_id,
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

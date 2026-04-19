import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.js";
import { project_members, projects } from "../../db/schema.js";
import {
  hasImplicitProjectAccess,
  isTenantRole,
  shouldAutoJoinCreatedProject,
} from "../../middleware/rbac.js";

export async function listTenantProjects(input: {
  tenantId: string;
  userId: string;
  role: string;
}) {
  if (hasImplicitProjectAccess(input.role)) {
    return db
      .select()
      .from(projects)
      .where(eq(projects.tenant_id, input.tenantId))
      .orderBy(projects.created_at);
  }

  const memberRows = await db
    .select({ project_id: project_members.project_id })
    .from(project_members)
    .where(
      and(
        eq(project_members.user_id, input.userId),
        eq(project_members.tenant_id, input.tenantId),
      ),
    );

  if (memberRows.length === 0) {
    return [];
  }

  const projectIds = memberRows.map((row) => row.project_id);
  return db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.tenant_id, input.tenantId),
        inArray(projects.id, projectIds),
      ),
    )
    .orderBy(projects.created_at);
}

export async function createProject(input: {
  tenantId: string;
  userId: string;
  role: string;
  name: string;
}) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(projects)
      .values({ tenant_id: input.tenantId, name: input.name })
      .returning();

    if (isTenantRole(input.role) && shouldAutoJoinCreatedProject(input.role)) {
      await tx.insert(project_members).values({
        project_id: row.id,
        tenant_id: input.tenantId,
        user_id: input.userId,
      });
    }

    return row;
  });
}

export async function deleteProject(projectId: string) {
  const [deleted] = await db
    .delete(projects)
    .where(eq(projects.id, projectId))
    .returning({ id: projects.id });

  return deleted ?? null;
}

import {
  ACTOR_RESOLUTION_MODE,
  type ActorResolutionMode,
} from "@customs/shared-constants";
import { authAdminService } from "../../auth/admin-service.js";

export type ActorRef = {
  user_id: string;
  email: string | null;
  provider: string | null;
};

export function buildActorRef(userId: string | null | undefined): ActorRef | null {
  return userId ? { user_id: userId, email: null, provider: null } : null;
}

export async function resolveActorRefs(
  userIds: Array<string | null | undefined>,
  mode: ActorResolutionMode,
): Promise<Map<string, ActorRef>> {
  const uniqueIds = [...new Set(userIds.filter((id): id is string => !!id))];
  const refs = new Map(uniqueIds.map((id) => [id, buildActorRef(id)!]));

  if (uniqueIds.length === 0 || mode === ACTOR_RESOLUTION_MODE.IDS_ONLY) {
    return refs;
  }

  try {
    const requestedIds = new Set(uniqueIds);
    const users = await authAdminService.listUsers();
    for (const user of users) {
      if (!requestedIds.has(user.id)) continue;
      refs.set(user.id, {
        user_id: user.id,
        email: user.email ?? null,
        provider:
          typeof user.app_metadata?.provider === "string"
            ? user.app_metadata.provider
            : null,
      });
    }
  } catch {
    return refs;
  }

  return refs;
}

export function actorFromMap(
  userId: string | null | undefined,
  actors: Map<string, ActorRef>,
): ActorRef | null {
  if (!userId) return null;
  return actors.get(userId) ?? buildActorRef(userId);
}

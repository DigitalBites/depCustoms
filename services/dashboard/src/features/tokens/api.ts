import { apiFetch } from "@/lib/api";
import type {
  CreatedProjectToken,
  ProjectToken,
} from "@/features/tokens/types";

export async function fetchProjectTokens(
  projectId: string,
): Promise<ProjectToken[]> {
  const data = (await apiFetch(`/v1/projects/${projectId}/tokens`)) as {
    tokens: ProjectToken[];
  };
  return data.tokens;
}

export async function createProjectToken(
  projectId: string,
  name: string,
  expiresAt?: string | null,
): Promise<CreatedProjectToken> {
  return (await apiFetch(`/v1/projects/${projectId}/tokens`, {
    method: "POST",
    body: JSON.stringify({ name, expires_at: expiresAt || undefined }),
  })) as CreatedProjectToken;
}

export async function revokeProjectToken(
  projectId: string,
  tokenId: string,
): Promise<void> {
  await apiFetch(`/v1/projects/${projectId}/tokens/${tokenId}`, {
    method: "DELETE",
  });
}

export async function rotateProjectToken(
  projectId: string,
  tokenId: string,
): Promise<CreatedProjectToken> {
  return (await apiFetch(`/v1/projects/${projectId}/tokens/${tokenId}/rotate`, {
    method: "POST",
  })) as CreatedProjectToken;
}

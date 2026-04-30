import { useCallback, useState } from "react";
import {
  createProjectToken,
  fetchProjectTokens,
  revokeProjectToken,
  rotateProjectToken,
} from "@/features/tokens/api";
import type {
  CreatedProjectToken,
  ProjectToken,
} from "@/features/tokens/types";
import { useConfirm } from "@/components/confirm-dialog-provider";
import { getUserErrorMessage } from "@/lib/api-error";
import { useResource } from "@/hooks/useResource";

export function useProjectTokens(projectId: string | null) {
  const loadTokens = useCallback(
    () => fetchProjectTokens(projectId!),
    [projectId],
  );
  const {
    data: tokens,
    loading,
    error: loadError,
    setError,
    setData: setTokens,
    reload,
  } = useResource<ProjectToken[]>(loadTokens, {
    initialData: [],
    enabled: Boolean(projectId),
    errorPrefix: "Failed to load tokens",
    resetDataOnDisable: true,
  });
  const error = projectId ? loadError : "Invalid project identifier.";

  return {
    tokens,
    loading,
    error,
    setError,
    setTokens,
    reload,
  };
}

export function useProjectTokenMutations({
  projectId,
  onError,
}: {
  projectId: string;
  onError: (message: string) => void;
}) {
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const confirm = useConfirm();

  async function handleRevoke(tokenId: string, tokenName: string) {
    const confirmed = await confirm({
      title: `Revoke token "${tokenName}"?`,
      description:
        "Any proxy using it will be blocked immediately.",
      confirmLabel: "Revoke token",
      variant: "destructive",
    });
    if (!confirmed) {
      return false;
    }

    setRevokingId(tokenId);
    try {
      await revokeProjectToken(projectId, tokenId);
      return true;
    } catch (err) {
      onError(getUserErrorMessage(err, "Revoke failed"));
      return false;
    } finally {
      setRevokingId(null);
    }
  }

  async function handleCreate(
    name: string,
    expiresAt?: string | null,
  ): Promise<CreatedProjectToken> {
    try {
      return await createProjectToken(projectId, name, expiresAt);
    } catch (err) {
      throw new Error(getUserErrorMessage(err, "Failed to create token"));
    }
  }

  async function handleRotate(
    tokenId: string,
    tokenName: string,
  ): Promise<CreatedProjectToken | null> {
    const confirmed = await confirm({
      title: `Rotate token "${tokenName}"?`,
      description:
        "The current token will be revoked immediately.",
      confirmLabel: "Rotate token",
      variant: "destructive",
    });
    if (!confirmed) {
      return null;
    }

    setRotatingId(tokenId);
    try {
      return await rotateProjectToken(projectId, tokenId);
    } catch (err) {
      onError(getUserErrorMessage(err, "Rotation failed"));
      return null;
    } finally {
      setRotatingId(null);
    }
  }

  return {
    revokingId,
    rotatingId,
    handleRevoke,
    handleCreate,
    handleRotate,
  };
}

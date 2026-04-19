import { useCallback, useEffect, useState } from "react";
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
import { getUserErrorMessage } from "@/lib/api-error";

export function useProjectTokens(projectId: string | null) {
  const [tokens, setTokens] = useState<ProjectToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!projectId) {
      setTokens([]);
      setError("Invalid project identifier.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      setTokens(await fetchProjectTokens(projectId));
    } catch (err) {
      setTokens([]);
      setError(getUserErrorMessage(err, "Failed to load tokens"));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

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

  async function handleRevoke(tokenId: string, tokenName: string) {
    if (
      !confirm(
        `Revoke token "${tokenName}"? Any proxy using it will be blocked immediately.`,
      )
    ) {
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
    if (
      !confirm(
        `Rotate token "${tokenName}"? The current token will be revoked immediately.`,
      )
    ) {
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

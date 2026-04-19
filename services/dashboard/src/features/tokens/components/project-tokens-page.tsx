"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { useParams } from "next/navigation";
import { RotateCw, Trash2 } from "lucide-react";
import { useDashboard } from "@/components/dashboard-provider";
import { EmptyState } from "@/components/feedback/empty-state";
import { InlineError } from "@/components/feedback/inline-error";
import { PageLoading } from "@/components/feedback/page-loading";
import { ProjectBackLink } from "@/components/navigation/project-back-link";
import { SecretRevealCard } from "@/components/ui/secret-reveal-card";
import {
  useProjectTokenMutations,
  useProjectTokens,
} from "@/features/tokens/hooks";
import type {
  CreatedProjectToken,
  ProjectToken,
} from "@/features/tokens/types";
import { useProjectName } from "@/hooks/useProjectName";
import { canPerform } from "@/lib/dashboard-capabilities";
import { getValidUuidParam } from "@/lib/route-params";

export function ProjectTokensPage() {
  const { project_id: rawProjectId } = useParams<{ project_id: string }>();
  const projectId = getValidUuidParam(rawProjectId);
  const projectName = useProjectName(projectId ?? "");
  const { role } = useDashboard();
  const canReadAllTokens = canPerform(role, "tokens.read_all");
  const canCreateTokens = canPerform(role, "tokens.create");

  const { tokens, loading, error, setError, setTokens, reload } =
    useProjectTokens(projectId);
  const [showCreate, setShowCreate] = useState(false);
  const [created, setCreated] = useState<CreatedProjectToken | null>(null);

  if (!projectId) {
    return (
      <div className="max-w-4xl py-8">
        <p className="text-sm text-destructive">Invalid project identifier.</p>
        <div className="mt-2">
          <ProjectBackLink className="inline-block text-sm text-primary hover:underline" />
        </div>
      </div>
    );
  }

  const { revokingId, rotatingId, handleRevoke, handleCreate, handleRotate } =
    useProjectTokenMutations({
      projectId,
      onError: setError,
    });

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <ProjectBackLink />
        <div className="mt-2 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Tokens</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Bearer tokens for <strong>{projectName}</strong>. Proxies use
              these to authenticate requests.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (canCreateTokens) {
                setShowCreate(true);
                setCreated(null);
              }
            }}
            disabled={!canCreateTokens}
            title={
              canCreateTokens
                ? undefined
                : "Your role cannot create project tokens"
            }
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            New token
          </button>
        </div>
      </div>

      <InlineError message={error} className="mb-4" />

      {showCreate ? (
        <CreateTokenModal
          onCreated={async (token) => {
            setCreated(token);
            setShowCreate(false);
            await reload();
          }}
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
        />
      ) : null}

      {created ? (
        <SecretRevealCard
          message={
            <>
              Token created. Copy it now. It will not be shown again. Set it as{" "}
              <code className="text-xs">
                Authorization: Bearer &lt;token&gt;
              </code>{" "}
              in your proxy config.
              {created.expires_at ? (
                <>
                  {" "}
                  It expires at{" "}
                  <strong>
                    {new Date(created.expires_at).toLocaleString()}
                  </strong>
                  .
                </>
              ) : null}
            </>
          }
          fields={[
            {
              label: "Token",
              value: created.token,
              sensitive: true,
              separator: ":",
              labelWidthClass: "w-32",
            },
          ]}
          dismissLabel="I've copied this - dismiss"
          onDismiss={() => setCreated(null)}
        />
      ) : null}

      {loading ? (
        <PageLoading />
      ) : tokens.length === 0 ? (
        <EmptyState message="No tokens yet." />
      ) : (
        <ProjectTokensTable
          canReadAllTokens={canReadAllTokens}
          tokens={tokens}
          revokingId={revokingId}
          rotatingId={rotatingId}
          onRevoke={async (tokenId, tokenName) => {
            const revoked = await handleRevoke(tokenId, tokenName);
            if (!revoked) {
              return;
            }

            setTokens((prev) =>
              prev.map((token) =>
                token.id === tokenId
                  ? { ...token, revoked_at: new Date().toISOString() }
                  : token,
              ),
            );
          }}
          onRotate={async (tokenId, tokenName) => {
            const rotated = await handleRotate(tokenId, tokenName);
            if (!rotated) {
              return;
            }

            setCreated(rotated);
            setTokens((prev) =>
              prev.map((token) =>
                token.id === tokenId
                  ? { ...token, revoked_at: new Date().toISOString() }
                  : token,
              ),
            );
            await reload();
          }}
        />
      )}
    </div>
  );
}

function ProjectTokensTable({
  canReadAllTokens,
  tokens,
  revokingId,
  rotatingId,
  onRevoke,
  onRotate,
}: {
  canReadAllTokens: boolean;
  tokens: ProjectToken[];
  revokingId: string | null;
  rotatingId: string | null;
  onRevoke: (tokenId: string, tokenName: string) => Promise<void>;
  onRotate: (tokenId: string, tokenName: string) => Promise<void>;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">
              Name
            </th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">
              Token suffix
            </th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">
              Status
            </th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">
              Last used
            </th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">
              Expires
            </th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">
              Created
            </th>
            {canReadAllTokens ? (
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                Created by
              </th>
            ) : null}
            {canReadAllTokens ? (
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                Revoked by
              </th>
            ) : null}
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {tokens.map((token, idx) => {
            const isRevoked = token.revoked_at !== null;
            const isExpired =
              token.expires_at !== null &&
              new Date(token.expires_at).getTime() <= Date.now();
            return (
              <tr
                key={token.id}
                className={
                  idx < tokens.length - 1 ? "border-b border-border" : ""
                }
              >
                <td
                  className={`px-4 py-3 font-medium ${
                    isRevoked
                      ? "text-muted-foreground line-through"
                      : "text-foreground"
                  }`}
                >
                  {token.name}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                  …{token.token_prefix}
                </td>
                <td className="px-4 py-3">
                  <TokenStatusBadge
                    isRevoked={isRevoked}
                    isExpired={isExpired}
                  />
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {token.last_used_at ? (
                    new Date(token.last_used_at).toLocaleString()
                  ) : (
                    <span className="italic">never</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {token.expires_at ? (
                    new Date(token.expires_at).toLocaleString()
                  ) : (
                    <span className="italic">never</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {new Date(token.created_at).toLocaleDateString()}
                </td>
                {canReadAllTokens ? (
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {token.created_by?.email ??
                      `${token.created_by_user_id.slice(0, 8)}…`}
                  </td>
                ) : null}
                {canReadAllTokens ? (
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {token.revoked_by?.email ??
                      (token.revoked_by_user_id
                        ? `${token.revoked_by_user_id.slice(0, 8)}…`
                        : "—")}
                  </td>
                ) : null}
                <td className="px-4 py-3 text-right">
                  {!isRevoked ? (
                    <div className="flex items-center justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => void onRotate(token.id, token.name)}
                        disabled={
                          rotatingId === token.id || revokingId === token.id
                        }
                        className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                        title="Rotate token"
                        aria-label={`Rotate token ${token.name}`}
                      >
                        <RotateCw className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void onRevoke(token.id, token.name)}
                        disabled={
                          revokingId === token.id || rotatingId === token.id
                        }
                        className="text-destructive hover:text-destructive/80 disabled:opacity-50"
                        title="Revoke token"
                        aria-label={`Revoke token ${token.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CreateTokenModal({
  onCreated,
  onClose,
  onCreate,
}: {
  onCreated: (token: CreatedProjectToken) => Promise<void>;
  onClose: () => void;
  onCreate: (
    name: string,
    expiresAt?: string | null,
  ) => Promise<CreatedProjectToken>;
}) {
  const [name, setName] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onCreated(
        await onCreate(
          name.trim(),
          expiresAt ? new Date(expiresAt).toISOString() : null,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create token");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-lg">
        <h2 className="mb-4 text-lg font-semibold text-foreground">
          New token
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Name{" "}
              <span className="font-normal text-muted-foreground">
                (e.g. "prod", "ci")
              </span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-token"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Expiration{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </label>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !name.trim()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TokenStatusBadge({
  isRevoked,
  isExpired,
}: {
  isRevoked: boolean;
  isExpired: boolean;
}) {
  if (isRevoked) {
    return (
      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        revoked
      </span>
    );
  }

  if (isExpired) {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
        expired
      </span>
    );
  }

  return (
    <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
      active
    </span>
  );
}

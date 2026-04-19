"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { Check, Copy, Power, RotateCw, Trash2 } from "lucide-react";
import { InlineError } from "@/components/feedback/inline-error";
import { PageLoading } from "@/components/feedback/page-loading";
import { PageHeader } from "@/components/layout/page-header";
import { ActionIconButton } from "@/components/ui/action-icon-button";
import { SecretRevealCard } from "@/components/ui/secret-reveal-card";
import {
  createProxy,
  disableProxy,
  enableProxy,
  revokeProxy,
  rotateProxySecret,
} from "@/features/proxies/api";
import { useProxies } from "@/features/proxies/hooks";
import type {
  CreatedProxy,
  ProxyRecord,
  RotatedProxySecret,
} from "@/features/proxies/types";
import { getUserErrorMessage } from "@/lib/api-error";

export function ProxyManagementPage() {
  const { proxies, loading, error, setError, setProxies, reload } =
    useProxies();
  const [showCreate, setShowCreate] = useState(false);
  const [created, setCreated] = useState<CreatedProxy | null>(null);
  const [rotated, setRotated] = useState<RotatedProxySecret | null>(null);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);

  async function handleDisable(proxy: ProxyRecord) {
    if (
      !confirm(
        `Disable "${proxy.name}"? New runtime tokens will stop issuing immediately.`,
      )
    ) {
      return;
    }

    setPendingActionId(proxy.proxy_id);
    try {
      const updated = await disableProxy(proxy.proxy_id);
      setProxies((prev) =>
        prev.map((item) =>
          item.proxy_id === updated.proxy_id
            ? { ...item, status: updated.status }
            : item,
        ),
      );
    } catch (err) {
      setError(getUserErrorMessage(err, "Disable failed"));
    } finally {
      setPendingActionId(null);
    }
  }

  async function handleEnable(proxy: ProxyRecord) {
    setPendingActionId(proxy.proxy_id);
    try {
      const updated = await enableProxy(proxy.proxy_id);
      setProxies((prev) =>
        prev.map((item) =>
          item.proxy_id === updated.proxy_id
            ? { ...item, status: updated.status }
            : item,
        ),
      );
    } catch (err) {
      setError(getUserErrorMessage(err, "Enable failed"));
    } finally {
      setPendingActionId(null);
    }
  }

  async function handleRotateSecret(proxy: ProxyRecord) {
    if (
      !confirm(
        `Rotate the bootstrap secret for "${proxy.name}"? You will need to update deployment config before the overlap window ends.`,
      )
    ) {
      return;
    }

    setPendingActionId(proxy.proxy_id);
    try {
      const nextSecret = await rotateProxySecret(proxy.proxy_id);
      setRotated(nextSecret);
      setProxies((prev) =>
        prev.map((item) =>
          item.proxy_id === proxy.proxy_id
            ? {
                ...item,
                secret_prefix: nextSecret.secret_prefix,
                secret_rotated_at: nextSecret.secret_rotated_at,
              }
            : item,
        ),
      );
    } catch (err) {
      setError(getUserErrorMessage(err, "Secret rotation failed"));
    } finally {
      setPendingActionId(null);
    }
  }

  async function handleRevoke(proxy: ProxyRecord) {
    if (
      !confirm(
        `Revoke "${proxy.name}"? This is permanent and any running instance will stop refreshing tokens.`,
      )
    ) {
      return;
    }

    setPendingActionId(proxy.proxy_id);
    try {
      const updated = await revokeProxy(proxy.proxy_id);
      setProxies((prev) =>
        prev.map((item) =>
          item.proxy_id === updated.proxy_id
            ? { ...item, status: updated.status }
            : item,
        ),
      );
    } catch (err) {
      setError(getUserErrorMessage(err, "Revoke failed"));
    } finally {
      setPendingActionId(null);
    }
  }

  return (
    <div className="w-full max-w-none">
      <PageHeader
        title="Proxies"
        description="Register proxy instances that connect to the control plane on behalf of this tenant."
        actions={
          <button
            type="button"
            onClick={() => {
              setShowCreate(true);
              setCreated(null);
            }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Register proxy
          </button>
        }
      />

      <InlineError message={error} className="mb-4" />

      {showCreate ? (
        <CreateProxyModal
          onCreated={(proxy) => {
            setCreated(proxy);
            setRotated(null);
            setShowCreate(false);
            void reload();
          }}
          onClose={() => setShowCreate(false)}
        />
      ) : null}

      {created ? (
        <SecretRevealCard
          message={
            <>
              Proxy <strong>{created.name}</strong> registered. Copy these
              values into your deployment config now. The secret will not be
              shown again.
            </>
          }
          fields={[
            { label: "PROXY_ID", value: created.proxy_id, separator: "=" },
            {
              label: "PROXY_CONTROL_PLANE_SECRET",
              value: created.secret,
              sensitive: true,
              separator: "=",
            },
          ]}
          dismissLabel="I've copied these - dismiss"
          onDismiss={() => setCreated(null)}
        />
      ) : null}

      {rotated ? (
        <SecretRevealCard
          message={
            <>
              Bootstrap secret rotated for <strong>{rotated.proxy_id}</strong>.
              Update the deployment config now. The previous secret stops
              working at{" "}
              <strong>
                {new Date(rotated.previous_secret_expires_at).toLocaleString()}
              </strong>
              .
            </>
          }
          fields={[
            {
              label: "PROXY_CONTROL_PLANE_SECRET",
              value: rotated.secret,
              sensitive: true,
              separator: "=",
            },
          ]}
          dismissLabel="I've copied the rotated secret - dismiss"
          onDismiss={() => setRotated(null)}
        />
      ) : null}

      {loading ? (
        <PageLoading />
      ) : proxies.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No proxies registered yet.
        </p>
      ) : (
        <ProxyTable
          proxies={proxies}
          pendingActionId={pendingActionId}
          onDisable={handleDisable}
          onEnable={handleEnable}
          onRotateSecret={handleRotateSecret}
          onRevoke={handleRevoke}
        />
      )}
    </div>
  );
}

function ProxyTable({
  proxies,
  pendingActionId,
  onDisable,
  onEnable,
  onRotateSecret,
  onRevoke,
}: {
  proxies: ProxyRecord[];
  pendingActionId: string | null;
  onDisable: (proxy: ProxyRecord) => void;
  onEnable: (proxy: ProxyRecord) => void;
  onRotateSecret: (proxy: ProxyRecord) => void;
  onRevoke: (proxy: ProxyRecord) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="min-w-[980px] w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th className="w-[28rem] px-4 py-3 text-left font-medium text-muted-foreground">
              Name
            </th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">
              Proxy ID
            </th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">
              Status
            </th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">
              Last seen
            </th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">
              Secret rotated
            </th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">
              Registered
            </th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {proxies.map((proxy, idx) => (
            <tr
              key={proxy.id}
              className={
                idx < proxies.length - 1 ? "border-b border-border" : ""
              }
            >
              <td
                className="px-4 py-3 font-medium text-foreground"
                title={proxy.name}
              >
                <div className="max-w-[28rem] truncate">{proxy.name}</div>
              </td>
              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <span>{formatProxyId(proxy.proxy_id)}</span>
                  <CopyProxyIdButton proxyId={proxy.proxy_id} />
                </div>
              </td>
              <td className="px-4 py-3 text-xs">
                <StatusBadge status={proxy.status} />
              </td>
              <td className="px-4 py-3 text-xs text-muted-foreground">
                {proxy.last_seen_at ? (
                  new Date(proxy.last_seen_at).toLocaleString()
                ) : (
                  <span className="italic">never</span>
                )}
              </td>
              <td className="px-4 py-3 text-xs text-muted-foreground">
                {proxy.secret_rotated_at ? (
                  new Date(proxy.secret_rotated_at).toLocaleString()
                ) : (
                  <span className="italic">never</span>
                )}
              </td>
              <td className="px-4 py-3 text-xs text-muted-foreground">
                {new Date(proxy.created_at).toLocaleDateString()}
              </td>
              <td className="px-4 py-3 text-right">
                <div className="flex items-center justify-end gap-1">
                  {proxy.status === "active" ? (
                    <ActionIconButton
                      label="Disable proxy"
                      onClick={() => onDisable(proxy)}
                      disabled={pendingActionId === proxy.proxy_id}
                      className="text-amber-700 hover:bg-amber-100/80"
                    >
                      <Power className="h-4 w-4" />
                    </ActionIconButton>
                  ) : proxy.status === "disabled" ? (
                    <ActionIconButton
                      label="Enable proxy"
                      onClick={() => onEnable(proxy)}
                      disabled={pendingActionId === proxy.proxy_id}
                      className="text-emerald-700 hover:bg-emerald-100/80"
                    >
                      <Power className="h-4 w-4" />
                    </ActionIconButton>
                  ) : null}
                  {proxy.status !== "revoked" ? (
                    <ActionIconButton
                      label="Rotate secret"
                      onClick={() => onRotateSecret(proxy)}
                      disabled={pendingActionId === proxy.proxy_id}
                      className="text-foreground hover:bg-muted"
                    >
                      <RotateCw className="h-4 w-4" />
                    </ActionIconButton>
                  ) : null}
                  {proxy.status !== "revoked" ? (
                    <ActionIconButton
                      label="Revoke proxy"
                      onClick={() => onRevoke(proxy)}
                      disabled={pendingActionId === proxy.proxy_id}
                      className="text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </ActionIconButton>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatProxyId(proxyId: string): string {
  return `${proxyId.slice(0, 8)}...`;
}

function CopyProxyIdButton({ proxyId }: { proxyId: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(proxyId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => void handleCopy()}
        title={copied ? "Copied" : "Copy proxy ID"}
        aria-label={copied ? "Copied proxy ID" : "Copy proxy ID"}
        className={`rounded p-1 transition-colors ${
          copied
            ? "text-emerald-700"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
      <span
        className={`text-[11px] font-medium transition-opacity ${
          copied ? "text-emerald-700 opacity-100" : "opacity-0"
        }`}
        aria-live="polite"
      >
        Copied
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: ProxyRecord["status"] }) {
  const className =
    status === "active"
      ? "bg-emerald-100 text-emerald-800"
      : status === "disabled"
        ? "bg-amber-100 text-amber-800"
        : "bg-rose-100 text-rose-800";

  return (
    <span
      className={`inline-flex rounded-full px-2 py-1 font-medium capitalize ${className}`}
    >
      {status}
    </span>
  );
}

function CreateProxyModal({
  onCreated,
  onClose,
}: {
  onCreated: (proxy: CreatedProxy) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
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
      onCreated(await createProxy(name.trim()));
    } catch (err) {
      setError(getUserErrorMessage(err, "Failed to create proxy"));
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-lg">
        <h2 className="mb-4 text-lg font-semibold text-foreground">
          Register proxy
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Name{" "}
              <span className="font-normal text-muted-foreground">
                (e.g. "prod-us-east-1")
              </span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-proxy"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              autoFocus
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
              {submitting ? "Registering…" : "Register"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

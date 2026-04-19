"use client";

import Link from "next/link";
import { SafeExternalLink } from "@/components/safe-external-link";
import { EmptyState } from "@/components/feedback/empty-state";
import { InlineError } from "@/components/feedback/inline-error";
import { PageLoading } from "@/components/feedback/page-loading";
import { PageHeader } from "@/components/layout/page-header";
import { useConnectors } from "@/features/connectors/hooks";

function StatusBadge({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        enabled
          ? "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400"
          : "bg-muted text-muted-foreground"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${enabled ? "bg-green-500" : "bg-muted-foreground"}`}
      />
      {enabled ? "Enabled" : "Disabled"}
    </span>
  );
}

export function ConnectorsPage() {
  const { connectors, loading, error } = useConnectors();
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="Connectors"
        description="Connectors bring external intelligence into the policy engine. Each connector enriches package decisions with additional data — such as CVE/advisory feeds — before a policy verdict is issued."
        className="mb-0"
      />
      <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        <p className="mb-1 font-medium text-foreground">How connectors work</p>
        <p>
          When the proxy requests a policy decision, the control plane evaluates
          your configured rules, then queries each enabled connector for
          enrichment data. Connector results are cached to avoid blocking live
          traffic — on a cache miss the connector races against a configurable
          response timeout. If the timeout fires the request fails closed
          (blocked) and the connector result is written to cache in the
          background so the next request gets a real verdict.
        </p>
      </div>
      {loading ? (
        <PageLoading />
      ) : error ? (
        <InlineError message={error} />
      ) : connectors.length === 0 ? (
        <EmptyState message="No connectors configured." />
      ) : (
        <div className="space-y-4">
          {connectors.map((c) => (
            <div
              key={c.id}
              className="rounded-lg border border-border bg-card p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-foreground">
                      {c.name}
                    </h2>
                    <StatusBadge enabled={c.enabled} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {c.description}
                  </p>
                  <SafeExternalLink
                    href={c.homepage}
                    className="mt-1 inline-block text-xs text-primary hover:underline"
                  >
                    {c.homepage} ↗
                  </SafeExternalLink>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <div className="rounded-md bg-muted/50 px-3 py-2">
                  <p className="text-xs text-muted-foreground">Cache TTL</p>
                  <p className="mt-0.5 text-sm font-mono font-medium text-foreground">
                    {c.config.cacheTtlSeconds}s
                  </p>
                </div>
                <div className="rounded-md bg-muted/50 px-3 py-2">
                  <p className="text-xs text-muted-foreground">
                    Response timeout
                  </p>
                  <p className="mt-0.5 text-sm font-mono font-medium text-foreground">
                    {c.config.responseTimeoutMs}ms
                  </p>
                </div>
                <div className="rounded-md bg-muted/50 px-3 py-2">
                  <p className="text-xs text-muted-foreground">
                    Background timeout
                  </p>
                  <p className="mt-0.5 text-sm font-mono font-medium text-foreground">
                    {c.config.backgroundTimeoutMs}ms
                  </p>
                </div>
              </div>
              {!c.enabled ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  To enable this connector set{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono">
                    CONNECTOR_{c.id.toUpperCase()}_ENABLED=true
                  </code>{" "}
                  in the API environment and restart.
                </p>
              ) : null}
              {c.enabled && c.id === "contributor" ? (
                <div className="mt-4 flex flex-wrap gap-3 text-xs">
                  <Link
                    href="/security?tab=contributors"
                    className="rounded-md border border-border bg-background px-3 py-1.5 text-foreground transition-colors hover:bg-accent"
                  >
                    Risk packages
                  </Link>
                  <Link
                    href="/security?tab=actors"
                    className="rounded-md border border-border bg-background px-3 py-1.5 text-foreground transition-colors hover:bg-accent"
                  >
                    Actors
                  </Link>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
      <div className="rounded-lg border border-dashed border-border p-5 text-center">
        <p className="text-sm font-medium text-foreground">
          More connectors coming
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          NVD (NIST National Vulnerability Database), GitHub Advisory Database,
          and custom webhook connectors are on the roadmap. Any source that
          implements the{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
            PackageIntelligenceConnector
          </code>{" "}
          interface can be plugged in.
        </p>
      </div>
    </div>
  );
}

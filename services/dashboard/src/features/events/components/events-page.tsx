"use client";

import React, { useState } from "react";
import CveBadge from "@/components/cve-badge";
import { useEventsFeed } from "@/features/events/hooks";
import type { EventRecord } from "@/features/events/types";

export function EventsPage() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { events, loading, error, connected, connecting, metrics } =
    useEventsFeed();

  return (
    <div className="max-w-6xl">
      <div className="mb-6 flex items-center gap-4">
        <h1 className="text-2xl font-semibold text-foreground">Events</h1>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
            connected
              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
              : connecting
                ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                : "bg-muted text-muted-foreground"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              connected
                ? "bg-green-500 animate-pulse"
                : connecting
                  ? "bg-yellow-400 animate-pulse"
                  : "bg-muted-foreground"
            }`}
          />
          {connected ? "LIVE" : connecting ? "CONNECTING" : "OFFLINE"}
        </span>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {!loading && events.length > 0 ? (
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Total events" value={String(metrics.total)} />
          <StatCard
            label="Allow / Block"
            value={`${metrics.allowed} / ${metrics.blocked}`}
          />
          <StatCard
            label="Pull / Redirect"
            value={`${metrics.pulls} / ${metrics.redirects}`}
          />
          <StatCard
            label="Data transferred"
            value={formatBytes(metrics.totalBytes)}
            sub="pull mode only"
          />
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-muted-foreground">No events recorded yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="w-6 px-2 py-3" />
                <th className="px-4 py-3 text-left font-medium whitespace-nowrap text-muted-foreground">
                  Time
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Package
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Version
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Ecosystem
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Decision
                </th>
                <th className="px-4 py-3 text-left font-medium whitespace-nowrap text-muted-foreground">
                  Serve Mode
                </th>
                <th className="px-4 py-3 text-right font-medium whitespace-nowrap text-muted-foreground">
                  Bytes
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Source
                </th>
              </tr>
            </thead>
            <tbody>
              {events.map((event, idx) => {
                const isExpanded = expandedId === event.id;
                const isLast = idx === events.length - 1;

                return (
                  <React.Fragment key={event.id ?? idx}>
                    <tr
                      className={`cursor-pointer transition-colors hover:bg-muted/30 ${
                        !isExpanded && !isLast ? "border-b border-border" : ""
                      }`}
                      onClick={() =>
                        setExpandedId(isExpanded ? null : event.id)
                      }
                    >
                      <td className="px-2 py-3 text-center text-muted-foreground select-none">
                        <span
                          className={`inline-block transition-transform duration-150 ${
                            isExpanded ? "rotate-90" : ""
                          }`}
                        >
                          ›
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                        {new Date(event.requested_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 font-mono text-foreground">
                        {event.package}
                      </td>
                      <td className="px-4 py-3 font-mono text-muted-foreground">
                        {event.version}
                      </td>
                      <td className="px-4 py-3 capitalize text-muted-foreground">
                        {event.ecosystem}
                      </td>
                      <td className="px-4 py-3">
                        <DecisionBadge decision={event.decision} />
                      </td>
                      <td className="px-4 py-3">
                        <ServeModeBadge serveMode={event.serve_mode} />
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">
                        {event.bytes_transferred !== null
                          ? formatBytes(event.bytes_transferred)
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {event.source}
                      </td>
                    </tr>
                    {isExpanded ? (
                      <tr className={!isLast ? "border-b border-border" : ""}>
                        <td />
                        <td colSpan={8} className="px-4 pb-4 pt-1">
                          <EventDetail event={event} />
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EventDetail({ event }: { event: EventRecord }) {
  const fields: { label: string; value: string | null }[] = [
    { label: "Event ID", value: event.id },
    { label: "Source", value: event.source },
    { label: "Event Type", value: event.event_type },
    {
      label: "Cache Hit",
      value:
        event.decision_cache === null ? null : String(event.decision_cache),
    },
    { label: "Reason", value: event.reason },
    { label: "Proxy ID", value: event.proxy_id },
    { label: "Token ID", value: event.project_token_id },
    { label: "Client IP", value: event.client_ip },
    { label: "Proxy IP", value: event.proxy_ip },
    { label: "Trace ID", value: event.trace_id },
    { label: "Span ID", value: event.span_id },
    { label: "Request ID", value: event.request_id },
  ];

  return (
    <>
      <dl className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs sm:grid-cols-4">
        {fields.map(({ label, value }) => (
          <div key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd
              className="truncate font-mono text-foreground"
              title={value ?? undefined}
            >
              {value ?? <span className="text-muted-foreground">—</span>}
            </dd>
          </div>
        ))}
      </dl>
      <CveBadge
        reason={event.reason}
        fixVersion={event.fix_version ?? null}
        severity={event.cve_severity ?? null}
      />
    </>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold text-foreground">{value}</p>
      {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

function DecisionBadge({ decision }: { decision: string }) {
  const normalised = decision.toLowerCase().replace("decision_", "");
  const isAllow = normalised === "allow";

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        isAllow
          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
          : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
      }`}
    >
      {isAllow ? "allow" : "block"}
    </span>
  );
}

function ServeModeBadge({ serveMode }: { serveMode: string | null }) {
  if (!serveMode) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const isPull = serveMode === "SERVE_MODE_PULL";

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        isPull
          ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {isPull ? "pull" : "redirect"}
    </span>
  );
}

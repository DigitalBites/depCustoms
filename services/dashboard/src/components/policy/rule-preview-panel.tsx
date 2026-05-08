"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getUserErrorMessage } from "@/lib/api-error";
import { SUPPORTED_ECOSYSTEMS } from "@/lib/ecosystems";
import type { Condition } from "@/features/policies/types";
import { BUILTIN_FIELD_REFS } from "./builtin-fields";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface TraceNode {
  node: "leaf" | "all" | "any" | "not";
  result: boolean;
  field?: string;
  operator?: string;
  value?: unknown;
  resolved?: unknown;
  children?: TraceNode[];
}

interface ConnectorStatus {
  status: string;
  cache_age_hours: number | null;
}

interface RulePreviewResult {
  matched: boolean;
  display_name: string;
  connector_statuses: Record<string, ConnectorStatus>;
  field_values: Record<string, unknown>;
  trace: TraceNode;
}

function extractCatalogWarningField(warning: string): string | null {
  const match = warning.match(
    /^Field "([^"]+)" is not in the connector field catalog - it may resolve to null$/,
  );
  return match?.[1] ?? null;
}

function normalizeValidationResult(result: ValidationResult): ValidationResult {
  return {
    ...result,
    warnings: result.warnings.filter((warning) => {
      const field = extractCatalogWarningField(warning);
      return !field || !BUILTIN_FIELD_REFS.has(field);
    }),
  };
}

// ---------------------------------------------------------------------------
// Trace tree renderer
// ---------------------------------------------------------------------------

function TraceNodeView({
  node,
  depth = 0,
}: {
  node: TraceNode;
  depth?: number;
}) {
  const indent = depth * 16;
  const dot = node.result ? "bg-green-500" : "bg-red-400";

  if (node.node === "leaf") {
    return (
      <div
        className="flex items-start gap-2 text-xs"
        style={{ paddingLeft: indent }}
      >
        <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${dot}`} />
        <span className="font-mono text-muted-foreground">{node.field}</span>
        <span className="text-muted-foreground">{node.operator}</span>
        <span className="font-mono text-foreground">
          {JSON.stringify(node.value)}
        </span>
        <span className="text-muted-foreground">→</span>
        <span
          className={`font-mono font-semibold ${node.result ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}
        >
          {JSON.stringify(node.resolved)}
        </span>
        <span
          className={`ml-auto shrink-0 font-semibold ${node.result ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}
        >
          {node.result ? "✓" : "✗"}
        </span>
      </div>
    );
  }

  const label =
    node.node === "all" ? "AND" : node.node === "any" ? "OR" : "NOT";
  const labelColor =
    node.node === "all"
      ? "text-indigo-600 dark:text-indigo-400"
      : "text-emerald-600 dark:text-emerald-400";

  return (
    <div style={{ paddingLeft: indent }}>
      <div className="flex items-center gap-2 text-xs mb-1">
        <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${dot}`} />
        <span className={`font-bold uppercase ${labelColor}`}>{label}</span>
        <span
          className={`ml-auto font-semibold ${node.result ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}
        >
          {node.result ? "✓" : "✗"}
        </span>
      </div>
      <div className="space-y-1 border-l-2 border-border ml-1 pl-2">
        {node.children?.map((child, i) => (
          <TraceNodeView key={i} node={child} depth={0} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RulePreviewPanelProps {
  policyId: string;
  condition: Condition;
  ecosystems?: string[];
}

function formatPreviewValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return `${value}`;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "[value]";
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RulePreviewPanel({
  policyId,
  condition,
  ecosystems = SUPPORTED_ECOSYSTEMS as unknown as string[],
}: RulePreviewPanelProps) {
  // Debounced syntax validation (always running in background)
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const validationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (validationTimer.current) clearTimeout(validationTimer.current);
    validationTimer.current = setTimeout(() => {
      void (async () => {
        if (!policyId) return;
        try {
          const data = (await apiFetch(`/v1/policies/${policyId}/validate`, {
            method: "POST",
            body: JSON.stringify({ condition }),
          })) as ValidationResult;
          setValidation(normalizeValidationResult(data));
        } catch {
          setValidation(null);
        }
      })();
    }, 600);
    return () => {
      if (validationTimer.current) clearTimeout(validationTimer.current);
    };
  }, [policyId, condition]);

  // Test-against-package state
  const [ecosystem, setEcosystem] = useState(() => ecosystems[0] ?? "npm");
  const [pkg, setPkg] = useState("");
  const [version, setVersion] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<RulePreviewResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [showFields, setShowFields] = useState(false);

  async function handleTest() {
    if (!pkg.trim() || !version.trim()) return;
    setTesting(true);
    setTestResult(null);
    setTestError(null);
    try {
      const data = (await apiFetch(`/v1/policies/${policyId}/rule-preview`, {
        method: "POST",
        body: JSON.stringify({
          condition,
          ecosystem,
          package: pkg.trim(),
          version: version.trim(),
        }),
      })) as RulePreviewResult;
      setTestResult(data);
    } catch (err) {
      setTestError(getUserErrorMessage(err, "Preview failed"));
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Syntax validation strip */}
      {validation && (
        <div
          className={`rounded-md border px-3 py-2 text-xs space-y-1 ${
            validation.valid
              ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20"
              : "border-destructive/30 bg-destructive/10"
          }`}
        >
          <p
            className={`font-semibold ${validation.valid ? "text-green-700 dark:text-green-400" : "text-destructive"}`}
          >
            {validation.valid ? "✓ Syntax valid" : "✗ Syntax errors"}
          </p>
          {validation.errors.map((e, i) => (
            <p key={i} className="text-destructive">
              ✗ {e}
            </p>
          ))}
          {validation.warnings.map((w, i) => (
            <p key={i} className="text-yellow-600 dark:text-yellow-400">
              ⚠ {w}
            </p>
          ))}
        </div>
      )}

      {/* Test against real package */}
      <div className="rounded-lg border border-border bg-muted/20">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-xs font-semibold text-foreground">
            Test against a package
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Evaluates the condition against real connector data. Uses cached OSV
            data if available.
          </p>
        </div>

        <div className="px-4 py-3 space-y-3">
          <div className="flex gap-2 flex-wrap">
            {/* Ecosystem */}
            <div className="w-24">
              <label className="block text-xs text-muted-foreground mb-1">
                Ecosystem
              </label>
              <div className="relative">
                <select
                  value={ecosystem}
                  onChange={(e) => setEcosystem(e.target.value)}
                  className="appearance-none w-full rounded border border-border bg-background px-2 py-1 pr-7 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {ecosystems.map((eco) => (
                    <option key={eco} value={eco}>
                      {eco}
                    </option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-1.5 text-muted-foreground">
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </div>
              </div>
            </div>

            {/* Package */}
            <div className="flex-1 min-w-32">
              <label className="block text-xs text-muted-foreground mb-1">
                Package
              </label>
              <input
                type="text"
                value={pkg}
                onChange={(e) => setPkg(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleTest();
                  }
                }}
                placeholder="e.g. express"
                className="w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono"
              />
            </div>

            {/* Version */}
            <div className="w-28">
              <label className="block text-xs text-muted-foreground mb-1">
                Version
              </label>
              <input
                type="text"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleTest();
                  }
                }}
                placeholder="e.g. 4.17.1"
                className="w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono"
              />
            </div>

            {/* Submit */}
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => void handleTest()}
                disabled={testing || !pkg.trim() || !version.trim()}
                className="rounded bg-primary px-3 py-1 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {testing ? "Testing…" : "Test"}
              </button>
            </div>
          </div>
        </div>

        {/* Result */}
        {testError && (
          <div className="px-4 pb-3">
            <p className="text-xs text-destructive">{testError}</p>
          </div>
        )}

        {testResult && (
          <div className="border-t border-border px-4 py-3 space-y-3">
            {/* Verdict */}
            <div
              className={`flex items-center gap-3 rounded-md px-3 py-2.5 ${
                testResult.matched
                  ? "bg-red-50 border border-red-200 dark:bg-red-900/20 dark:border-red-800"
                  : "bg-green-50 border border-green-200 dark:bg-green-900/20 dark:border-green-800"
              }`}
            >
              <span
                className={`text-xl ${testResult.matched ? "text-red-500" : "text-green-500"}`}
              >
                {testResult.matched ? "⚡" : "✓"}
              </span>
              <div>
                <p
                  className={`text-sm font-semibold ${testResult.matched ? "text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}
                >
                  {testResult.matched
                    ? "Rule would fire"
                    : "Rule would not fire"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {testResult.display_name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {Object.entries(testResult.connector_statuses).map(
                    ([key, cs]) => (
                      <span key={key} className="mr-2">
                        {key}: <span className="font-mono">{cs.status}</span>
                        {cs.cache_age_hours !== null &&
                          ` (${cs.cache_age_hours.toFixed(1)}h)`}
                      </span>
                    ),
                  )}
                </p>
              </div>
            </div>

            {/* Evaluation trace */}
            <div>
              <p className="text-xs font-semibold text-foreground mb-2">
                Evaluation trace
              </p>
              <div className="rounded-md border border-border bg-background p-3 space-y-1.5 text-xs">
                <TraceNodeView node={testResult.trace} depth={0} />
              </div>
            </div>

            {/* Field values toggle */}
            <div>
              <button
                type="button"
                onClick={() => setShowFields((v) => !v)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {showFields ? "▾ Hide" : "▸ Show"} resolved field values (
                {Object.keys(testResult.field_values).length})
              </button>
              {showFields && (
                <div className="mt-2 rounded-md border border-border overflow-auto max-h-56">
                  <table className="w-full text-xs">
                    <tbody className="divide-y divide-border">
                      {Object.entries(testResult.field_values).map(
                        ([key, val]) => (
                          <tr key={key} className="hover:bg-muted/20">
                            <td className="px-2 py-1 font-mono text-muted-foreground whitespace-nowrap">
                              {key}
                            </td>
                            <td className="px-2 py-1 font-mono text-foreground">
                              {val === null || val === undefined ? (
                                <span className="text-muted-foreground italic">
                                  null
                                </span>
                              ) : (
                                formatPreviewValue(val)
                              )}
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

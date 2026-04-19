"use client";

import Link from "next/link";
import { ConditionTreeEditor } from "./condition-tree";
import { RulePreviewPanel } from "./rule-preview-panel";
import type { Condition, RuleAction } from "@/features/policies/types";

export interface RuleFormValues {
  name: string;
  description: string;
  targetEntity: string;
  condition: Condition;
  action: RuleAction;
  enabled: boolean;
}

export const DEFAULT_RULE_FORM_VALUES: RuleFormValues = {
  name: "",
  description: "",
  targetEntity: "artifact",
  condition: { all: [] },
  action: {
    type: "violation",
    severity: "high",
    code: "",
    message_template: "",
    enforcement_mode: "enforcing",
  },
  enabled: true,
};

interface RuleFormProps {
  policyId: string;
  values: RuleFormValues;
  onChange: (values: RuleFormValues) => void;
  onSubmit: (e: React.FormEvent) => void;
  saving: boolean;
  error: string | null;
  submitLabel: string;
  ecosystems?: string[];
}

export function RuleForm({
  policyId,
  values,
  onChange,
  onSubmit,
  saving,
  error,
  submitLabel,
  ecosystems,
}: RuleFormProps) {
  const set = <K extends keyof RuleFormValues>(
    key: K,
    val: RuleFormValues[K],
  ) => onChange({ ...values, [key]: val });

  const setAction = (patch: Partial<RuleAction>) =>
    onChange({ ...values, action: { ...values.action, ...patch } });

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* Basic info */}
      <section className="rounded-lg border border-border bg-card p-5 space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Rule details</h2>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            Name <span className="text-destructive">*</span>
          </label>
          <input
            type="text"
            value={values.name}
            onChange={(e) => set("name", e.target.value)}
            required
            placeholder="e.g. Block critical CVEs"
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            Description
          </label>
          <input
            type="text"
            value={values.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="Optional"
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        <div className="flex gap-6">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Target entity
            </label>
            <div className="relative">
              <select
                value={values.targetEntity}
                onChange={(e) => set("targetEntity", e.target.value)}
                className="appearance-none w-full rounded-md border border-border bg-background px-3 py-1.5 pr-8 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="artifact">artifact</option>
                <option value="dependency">dependency</option>
                <option value="finding">finding</option>
                <option value="repository">repository</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-muted-foreground">
                <svg
                  className="h-4 w-4"
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

          <div className="flex items-end gap-2 pb-0.5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={values.enabled}
                onChange={(e) => set("enabled", e.target.checked)}
                className="rounded border-border"
              />
              <span className="text-sm font-medium text-foreground">
                Enabled
              </span>
            </label>
          </div>
        </div>
      </section>

      {/* Condition tree */}
      <section className="rounded-lg border border-border bg-card p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Condition</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            The rule fires when this condition tree evaluates to{" "}
            <code className="font-mono">true</code>.
          </p>
        </div>
        <ConditionTreeEditor
          value={values.condition}
          onChange={(c) => set("condition", c)}
        />
        <RulePreviewPanel
          policyId={policyId}
          condition={values.condition}
          ecosystems={ecosystems}
        />
      </section>

      {/* Action */}
      <section className="rounded-lg border border-border bg-card p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Action</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            What happens when this rule matches.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Type
            </label>
            <div className="relative">
              <select
                value={values.action.type}
                onChange={(e) =>
                  setAction({ type: e.target.value as RuleAction["type"] })
                }
                className="appearance-none w-full rounded-md border border-border bg-background px-3 py-1.5 pr-8 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="violation">
                  violation — blocks when enforcing
                </option>
                <option value="warning">
                  warning — records event, never blocks
                </option>
                <option value="info">info — informational only</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-muted-foreground">
                <svg
                  className="h-4 w-4"
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

          {values.action.type === "violation" && (
            <>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Severity
                </label>
                <div className="relative">
                  <select
                    value={values.action.severity ?? "high"}
                    onChange={(e) =>
                      setAction({
                        severity: e.target.value as RuleAction["severity"],
                      })
                    }
                    className="appearance-none w-full rounded-md border border-border bg-background px-3 py-1.5 pr-8 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="critical">critical</option>
                    <option value="high">high</option>
                    <option value="medium">medium</option>
                    <option value="low">low</option>
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-muted-foreground">
                    <svg
                      className="h-4 w-4"
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

              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Enforcement mode
                </label>
                <div className="relative">
                  <select
                    value={values.action.enforcement_mode ?? "enforcing"}
                    onChange={(e) =>
                      setAction({
                        enforcement_mode: e.target
                          .value as RuleAction["enforcement_mode"],
                      })
                    }
                    className="appearance-none w-full rounded-md border border-border bg-background px-3 py-1.5 pr-8 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="enforcing">enforcing</option>
                    <option value="advisory">advisory</option>
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-muted-foreground">
                    <svg
                      className="h-4 w-4"
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
            </>
          )}

          <div className="col-span-2">
            <label className="block text-sm font-medium text-foreground mb-1">
              Code
              <span className="ml-1 text-xs text-muted-foreground font-normal">
                — machine-readable identifier
              </span>
            </label>
            <input
              type="text"
              value={values.action.code ?? ""}
              onChange={(e) => setAction({ code: e.target.value })}
              placeholder="e.g. CVE_THRESHOLD_EXCEEDED"
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="col-span-2">
            <label className="block text-sm font-medium text-foreground mb-1">
              Message template
              <span className="ml-1 text-xs text-muted-foreground font-normal">
                — supports {"{{field.ref}}"} interpolation
              </span>
            </label>
            <textarea
              value={values.action.message_template ?? ""}
              onChange={(e) => setAction({ message_template: e.target.value })}
              rows={2}
              placeholder="e.g. Package has {{source.osv.critical_count}} critical CVEs"
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
          </div>

          <div className="col-span-2">
            <label className="block text-sm font-medium text-foreground mb-1">
              Recommended remediation
            </label>
            <textarea
              value={values.action.recommended_remediation ?? ""}
              onChange={(e) =>
                setAction({ recommended_remediation: e.target.value })
              }
              rows={2}
              placeholder="Optional guidance shown in the violation detail"
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving || !values.name.trim()}
          className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {submitLabel}
        </button>
        <Link
          href={`/policy-engine/${policyId}`}
          className="rounded-lg border border-border px-5 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}

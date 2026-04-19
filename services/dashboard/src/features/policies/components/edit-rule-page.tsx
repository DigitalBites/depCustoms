"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { RuleForm } from "@/components/policy/rule-form";
import { useDashboard } from "@/components/dashboard-provider";
import {
  usePolicyRuleFormEcosystems,
  useRuleEditor,
} from "@/features/policies/hooks";

export function EditRulePage({
  policyId,
  ruleId,
}: {
  policyId: string | null;
  ruleId: string | null;
}) {
  const { tenantId } = useDashboard();
  const router = useRouter();
  const ecosystems = usePolicyRuleFormEcosystems(tenantId);
  const { loading, loadError, values, setValues, saving, saveError, save } =
    useRuleEditor(ruleId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!policyId || !ruleId || !values) return;

    const ok = await save(policyId, values);
    if (ok) {
      router.push(`/policy-engine/${policyId}`);
    }
  }

  if (loading)
    return <p className="py-8 text-sm text-muted-foreground">Loading…</p>;
  if (!policyId || !ruleId) {
    return (
      <div className="py-8">
        <p className="text-sm text-destructive">
          {!policyId
            ? "Invalid policy identifier."
            : "Invalid rule identifier."}
        </p>
        <Link
          href="/policy-engine"
          className="mt-2 inline-block text-sm text-primary hover:underline"
        >
          ← Back
        </Link>
      </div>
    );
  }
  if (loadError || !values) {
    return (
      <div className="py-8">
        <p className="text-sm text-destructive">
          {loadError ?? "Failed to load rule"}
        </p>
        <Link
          href={`/policy-engine/${policyId}`}
          className="mt-2 inline-block text-sm text-primary hover:underline"
        >
          ← Back
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <Link
          href={`/policy-engine/${policyId}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Policy
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-foreground">
          Edit Rule
        </h1>
      </div>
      <RuleForm
        policyId={policyId}
        values={values}
        onChange={setValues}
        onSubmit={handleSubmit}
        saving={saving}
        error={saveError}
        submitLabel={saving ? "Saving…" : "Save rule"}
        ecosystems={ecosystems}
      />
    </div>
  );
}

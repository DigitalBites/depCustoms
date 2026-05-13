"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  RuleForm,
  DEFAULT_RULE_FORM_VALUES,
  type RuleFormValues,
} from "@/components/policy/rule-form";
import { useDashboard } from "@/components/dashboard-provider";
import {
  usePolicyRuleFormEcosystems,
  usePolicyRuleMutations,
} from "@/features/policies/hooks";

export function NewRulePage({ policyId }: { policyId: string | null }) {
  const { tenantId } = useDashboard();
  const router = useRouter();
  const [values, setValues] = useState<RuleFormValues>(
    DEFAULT_RULE_FORM_VALUES,
  );
  const [error, setError] = useState<string | null>(null);
  const ecosystems = usePolicyRuleFormEcosystems(tenantId);
  const { createRuleForPolicy } = usePolicyRuleMutations(
    policyId ?? "",
    setError,
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!policyId) {
      setError("Invalid policy identifier.");
      return;
    }

    const result = await createRuleForPolicy(values);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    router.push(`/policy-engine/${result.policyId ?? policyId}`);
  }

  return (
    <div className="max-w-3xl">
      {!policyId ? (
        <div className="mb-4 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Invalid policy identifier.
        </div>
      ) : null}
      <div className="mb-6">
        <Link
          href={policyId ? `/policy-engine/${policyId}` : "/policy-engine"}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Policy
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-foreground">
          New Rule
        </h1>
      </div>
      {policyId ? (
        <RuleForm
          policyId={policyId}
          values={values}
          onChange={setValues}
          onSubmit={handleSubmit}
          saving={false}
          error={error}
          submitLabel="Create rule"
          ecosystems={ecosystems}
        />
      ) : null}
    </div>
  );
}

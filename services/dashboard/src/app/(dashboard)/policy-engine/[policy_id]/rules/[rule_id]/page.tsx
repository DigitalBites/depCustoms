import { getValidUuidParam } from "@/lib/route-params";
import { EditRulePage } from "@/features/policies/components/edit-rule-page";

export default async function EditRuleRoute({
  params,
}: {
  params: Promise<{ policy_id: string; rule_id: string }>;
}) {
  const { policy_id: rawPolicyId, rule_id: rawRuleId } = await params;
  const policyId = getValidUuidParam(rawPolicyId);
  const ruleId = getValidUuidParam(rawRuleId);

  return <EditRulePage policyId={policyId} ruleId={ruleId} />;
}

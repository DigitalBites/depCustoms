import { getValidUuidParam } from "@/lib/route-params";
import { NewRulePage } from "@/features/policies/components/new-rule-page";

export default async function NewRuleRoute({
  params,
}: {
  params: Promise<{ policy_id: string }>;
}) {
  const { policy_id: rawPolicyId } = await params;
  const policyId = getValidUuidParam(rawPolicyId);

  return <NewRulePage policyId={policyId} />;
}

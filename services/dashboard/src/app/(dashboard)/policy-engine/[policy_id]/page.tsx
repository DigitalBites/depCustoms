import { getValidUuidParam } from "@/lib/route-params";
import { PolicyDetailPage } from "@/features/policies/components/policy-detail-page";

export default async function PolicyDetailRoute({
  params,
}: {
  params: Promise<{ policy_id: string }>;
}) {
  const { policy_id: rawPolicyId } = await params;
  const policyId = getValidUuidParam(rawPolicyId);

  return <PolicyDetailPage policyId={policyId} />;
}

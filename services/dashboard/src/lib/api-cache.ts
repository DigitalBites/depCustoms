import { parseAccessTokenMetadata } from "@/lib/jwt-metadata";

export function getApiFetchCachePartition(accessToken: string | null): string {
  if (!accessToken) {
    return "anonymous";
  }

  const metadata = parseAccessTokenMetadata(accessToken);
  const tenantId = metadata?.tenantId ?? "tenant:unknown";
  const role = metadata?.role ?? "role:unknown";
  return `${tenantId}:${role}:${accessToken}`;
}

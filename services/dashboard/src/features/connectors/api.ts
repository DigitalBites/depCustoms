import { apiFetch } from "@/lib/api";
import type { Connector } from "@/features/connectors/types";

export async function fetchConnectors(): Promise<Connector[]> {
  const data = (await apiFetch("/v1/connectors")) as {
    connectors: Connector[];
  };
  return data.connectors;
}

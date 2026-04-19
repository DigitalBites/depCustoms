import { apiFetch } from "@/lib/api";
import type {
  CreatedProxy,
  ProxyRecord,
  ProxyStatusUpdate,
  RotatedProxySecret,
} from "@/features/proxies/types";

export async function fetchProxies(): Promise<ProxyRecord[]> {
  const data = (await apiFetch("/v1/proxies")) as { proxies: ProxyRecord[] };
  return data.proxies;
}

export async function createProxy(name: string): Promise<CreatedProxy> {
  return (await apiFetch("/v1/proxies", {
    method: "POST",
    body: JSON.stringify({ name }),
  })) as CreatedProxy;
}

export async function disableProxy(
  proxyId: string,
): Promise<ProxyStatusUpdate> {
  return (await apiFetch(`/v1/proxies/${proxyId}/disable`, {
    method: "POST",
  })) as ProxyStatusUpdate;
}

export async function enableProxy(proxyId: string): Promise<ProxyStatusUpdate> {
  return (await apiFetch(`/v1/proxies/${proxyId}/enable`, {
    method: "POST",
  })) as ProxyStatusUpdate;
}

export async function rotateProxySecret(
  proxyId: string,
): Promise<RotatedProxySecret> {
  return (await apiFetch(`/v1/proxies/${proxyId}/rotate-secret`, {
    method: "POST",
  })) as RotatedProxySecret;
}

export async function revokeProxy(proxyId: string): Promise<ProxyStatusUpdate> {
  return (await apiFetch(`/v1/proxies/${proxyId}`, {
    method: "DELETE",
  })) as ProxyStatusUpdate;
}

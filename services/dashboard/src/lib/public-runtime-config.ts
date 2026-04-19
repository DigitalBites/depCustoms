export type PublicRuntimeConfig = {
  authUrl: string;
  anonKey: string;
  apiUrl: string;
  authProxyEnabled: boolean;
  apiProxyEnabled: boolean;
};

declare global {
  interface Window {
    __CUSTOMS_PUBLIC_CONFIG__?: PublicRuntimeConfig;
  }
}

export function getServerPublicRuntimeConfig(): PublicRuntimeConfig {
  return {
    authUrl: process.env.NEXT_PUBLIC_AUTH_URL ?? "",
    anonKey: process.env.NEXT_PUBLIC_GOTRUE_ANON_KEY ?? "",
    apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "",
    authProxyEnabled: process.env.AUTH_PROXY_ENABLED === "true",
    apiProxyEnabled: process.env.DASHBOARD_API_PROXY_ENABLED === "true",
  };
}

export function resolveBrowserPublicRuntimeConfig(
  config: PublicRuntimeConfig,
  origin: string,
): PublicRuntimeConfig {
  return {
    ...config,
    authUrl: config.authProxyEnabled ? origin : config.authUrl,
    apiUrl: config.apiProxyEnabled ? origin : config.apiUrl,
  };
}

export function getPublicRuntimeConfig(): PublicRuntimeConfig {
  if (typeof window === "undefined") {
    return getServerPublicRuntimeConfig();
  }

  const config = window.__CUSTOMS_PUBLIC_CONFIG__;
  if (!config) {
    throw new Error("Public runtime config is not initialized");
  }

  return resolveBrowserPublicRuntimeConfig(config, window.location.origin);
}

import type { NextConfig } from "next";
import { buildContentSecurityPolicy } from "./src/lib/csp";

console.log(
  JSON.stringify({
    ts: new Date().toISOString(),
    level: "info",
    service: "dashboard",
    msg: "startup_config",
    config: {
      general: {
        port: process.env.PORT ?? "3001",
      },
      auth: {
        url: process.env.NEXT_PUBLIC_AUTH_URL ?? "[NOT SET]",
        anon_key_configured: Boolean(process.env.NEXT_PUBLIC_GOTRUE_ANON_KEY),
      },
      api: {
        public_url: process.env.NEXT_PUBLIC_API_URL ?? "[NOT SET]",
        internal_url_configured: Boolean(process.env.API_INTERNAL_URL),
        same_origin_dev_proxy_enabled:
          process.env.DASHBOARD_API_PROXY_ENABLED === "true",
      },
    },
  }),
);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",

  async headers() {
    const isProduction = process.env.NODE_ENV === "production";
    const apiProxyEnabled =
      process.env.DASHBOARD_API_PROXY_ENABLED === "true";
    const authProxyEnabled = process.env.AUTH_PROXY_ENABLED === "true";
    const csp = buildContentSecurityPolicy(isProduction, {
      apiUrl: apiProxyEnabled ? undefined : process.env.NEXT_PUBLIC_API_URL,
      authUrl: authProxyEnabled ? undefined : process.env.NEXT_PUBLIC_AUTH_URL,
    });

    return [
      {
        source: "/:path*",
        headers: [
          {
            key: isProduction
              ? "Content-Security-Policy"
              : "Content-Security-Policy-Report-Only",
            value: csp,
          },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },

  // When explicitly enabled, the same-origin dev proxy forwards API and auth
  // paths to API_INTERNAL_URL so browser requests stay same-origin.
  // This is mainly for localhost dev, where Safari is stricter about
  // cross-origin localhost behavior.
  async rewrites() {
    const internalUrl = process.env.API_INTERNAL_URL;
    const proxyEnabled = process.env.DASHBOARD_API_PROXY_ENABLED === "true";
    if (!proxyEnabled || !internalUrl) return [];

    return [
      {
        source: "/v1/:path*",
        destination: `${internalUrl}/v1/:path*`,
      },
      {
        source: "/internal/:path*",
        destination: `${internalUrl}/internal/:path*`,
      },
      {
        source: "/auth/v1/:path*",
        destination: `${internalUrl}/auth/v1/:path*`,
      },
      {
        source: "/oauth/:path*",
        destination: `${internalUrl}/oauth/:path*`,
      },
      {
        source: "/.well-known/:path*",
        destination: `${internalUrl}/.well-known/:path*`,
      },
      {
        source: "/mcp/.well-known/:path*",
        destination: `${internalUrl}/mcp/.well-known/:path*`,
      },
    ];
  },
};

export default nextConfig;

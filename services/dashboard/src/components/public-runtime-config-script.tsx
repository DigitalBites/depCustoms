import { getServerPublicRuntimeConfig } from "@/lib/public-runtime-config";

function escapeJsonForInlineScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function PublicRuntimeConfigScript() {
  const config = getServerPublicRuntimeConfig();

  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `window.__CUSTOMS_PUBLIC_CONFIG__=${escapeJsonForInlineScript(config)};`,
      }}
    />
  );
}

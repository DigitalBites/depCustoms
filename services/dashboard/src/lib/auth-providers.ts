export type AuthProvider = {
  id: string;
  label: string;
  known: boolean;
};

export type AuthProviderPresentation = {
  label: string;
  order: number;
};

export const AUTH_PROVIDER_PRESENTATION: Record<
  string,
  AuthProviderPresentation
> = {
  github: {
    label: "GitHub",
    order: 10,
  },
  google: {
    label: "Google",
    order: 20,
  },
};

const NON_OAUTH_AUTH_METHODS = new Set([
  "anonymous",
  "email",
  "phone",
  "saml",
  "sms",
  "sso",
]);

function normalizeProviderId(provider: string): string | null {
  const normalized = provider.trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,64}$/.test(normalized)) {
    return null;
  }
  if (NON_OAUTH_AUTH_METHODS.has(normalized)) {
    return null;
  }
  return normalized;
}

export function getProviderFallbackLabel(providerId: string): string {
  return providerId
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function buildAuthProvidersFromSettingsExternal(
  external: unknown,
  presentation = AUTH_PROVIDER_PRESENTATION,
): AuthProvider[] {
  if (!external || typeof external !== "object" || Array.isArray(external)) {
    return [];
  }

  const providers = Object.entries(external)
    .filter(([, enabled]) => enabled === true)
    .map(([provider]) => normalizeProviderId(provider))
    .filter((provider): provider is string => provider !== null)
    .map((provider) => {
      const metadata = presentation[provider];
      return {
        id: provider,
        label: metadata?.label ?? getProviderFallbackLabel(provider),
        known: Boolean(metadata),
      };
    });

  return providers.sort((a, b) => {
    const orderA = presentation[a.id]?.order ?? Number.MAX_SAFE_INTEGER;
    const orderB = presentation[b.id]?.order ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    return a.label.localeCompare(b.label);
  });
}

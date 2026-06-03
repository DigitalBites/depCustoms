import { config } from "@/config";
import { buildApiUrl } from "@/lib/api-path";
import {
  buildAuthProvidersFromSettingsExternal,
  type AuthProvider,
} from "@/lib/auth-providers";

type SettingsCache = {
  expiresAt: number;
  providers: AuthProvider[];
};

const CACHE_TTL_MS = 60_000;
let cache: SettingsCache | null = null;

type SupabaseAuthSettings = {
  external?: unknown;
};

export async function getEnabledAuthProviders(): Promise<AuthProvider[]> {
  if (cache && cache.expiresAt > Date.now()) {
    return cache.providers;
  }

  const providers = await fetchEnabledAuthProvidersWithDependencies({
    authUrl: config.authUrl,
    anonKey: config.anonKey,
    fetchImpl: fetch,
  });
  cache = {
    providers,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  return providers;
}

export async function fetchEnabledAuthProvidersWithDependencies(input: {
  authUrl: string;
  anonKey: string;
  fetchImpl: typeof fetch;
}): Promise<AuthProvider[]> {
  if (!input.authUrl || !input.anonKey) {
    return [];
  }

  try {
    const response = await input.fetchImpl(
      buildApiUrl(input.authUrl, "/auth/v1/settings"),
      {
        headers: {
          apikey: input.anonKey,
        },
        cache: "no-store",
      },
    );

    if (!response.ok) {
      return [];
    }

    const settings = (await response.json()) as SupabaseAuthSettings;
    return buildAuthProvidersFromSettingsExternal(settings.external);
  } catch {
    return [];
  }
}

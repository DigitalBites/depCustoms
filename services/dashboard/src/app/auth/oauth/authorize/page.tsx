import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase-server";
import { config } from "@/config";
import { buildApiUrl } from "@/lib/api-path";
import { getValidPathSegmentParam } from "@/lib/route-params";
import type { McpOAuthAuthorizationDetails } from "@/features/mcp/types";
import { ConsentActions } from "./consent-actions";

type AuthorizationPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function getSearchParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | null {
  const value = params[key];
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && value.length > 0) {
    return value[0] ?? null;
  }
  return null;
}

function getApiBaseUrl(): string {
  return config.apiInternalUrl || config.apiUrl;
}

type AuthorizationLoadResult =
  | { kind: "details"; details: McpOAuthAuthorizationDetails }
  | { kind: "redirect"; redirectUrl: string };

async function requireSessionToken(nextPath: string): Promise<string> {
  const supabase = await createServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  return session.access_token;
}

async function loadAuthorizationDetails(
  accessToken: string,
  authorizationId: string,
): Promise<AuthorizationLoadResult> {
  const encodedAuthorizationId = encodeURIComponent(authorizationId);
  const response = await fetch(
    buildApiUrl(
      getApiBaseUrl(),
      `/oauth/authorizations/${encodedAuthorizationId}`,
    ),
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error("Failed to load authorization request");
  }

  const raw = (await response.json()) as
    | (Partial<McpOAuthAuthorizationDetails> & { redirect_url?: string })
    | null;

  if (typeof raw?.redirect_url === "string" && raw.redirect_url.length > 0) {
    return {
      kind: "redirect",
      redirectUrl: raw.redirect_url,
    };
  }

  return {
    kind: "details",
    details: {
      authorization_id: raw?.authorization_id ?? authorizationId,
      redirect_uri: raw?.redirect_uri,
      scope: raw?.scope,
      client: {
        id: raw?.client?.id ?? "unknown",
        name: raw?.client?.name,
        uri: raw?.client?.uri,
        logo_uri: raw?.client?.logo_uri,
      },
      user: {
        id: raw?.user?.id,
        email: raw?.user?.email,
      },
    },
  };
}

export default async function OAuthAuthorizationPage({
  searchParams,
}: AuthorizationPageProps) {
  const params = searchParams ? await searchParams : {};
  const rawAuthorizationId = getSearchParam(params, "authorization_id");
  const authorizationId = getValidPathSegmentParam(rawAuthorizationId);
  const error = getSearchParam(params, "error");

  if (!authorizationId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
        <div className="w-full max-w-2xl rounded-2xl border border-border bg-card p-8 shadow-sm">
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Missing authorization request.
          </div>
        </div>
      </div>
    );
  }

  const nextPath = `/auth/oauth/authorize?authorization_id=${encodeURIComponent(authorizationId)}`;
  const accessToken = await requireSessionToken(nextPath);

  let details: McpOAuthAuthorizationDetails | null = null;
  let detailsError: string | null = error;

  try {
    const result = await loadAuthorizationDetails(accessToken, authorizationId);
    if (result.kind === "redirect") {
      redirect(result.redirectUrl);
    }
    details = result.details;
  } catch {
    detailsError = detailsError ?? "Failed to load authorization request";
  }

  const scopes = details?.scope?.split(/\s+/).filter(Boolean) ?? [];

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-2xl rounded-2xl border border-border bg-card p-8 shadow-sm">
        <div className="mb-6">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
            MCP Authorization
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-foreground">
            Authorize developer tool access
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This allows the requesting MCP client to access Customs as your
            signed-in user within the tenant represented by your current
            session.
          </p>
        </div>

        {detailsError ? (
          <div className="mb-6 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {detailsError}
          </div>
        ) : null}

        {details ? (
          <div className="space-y-6">
            <section className="rounded-xl border border-border bg-muted/30 p-5">
              <h2 className="text-base font-semibold text-foreground">
                Client
              </h2>
              <div className="mt-3 space-y-2 text-sm">
                <div>
                  <span className="font-medium text-foreground">Name:</span>{" "}
                  <span className="text-muted-foreground">
                    {details.client.name || "Unnamed client"}
                  </span>
                </div>
                <div>
                  <span className="font-medium text-foreground">
                    Client ID:
                  </span>{" "}
                  <code className="rounded bg-background px-2 py-1 text-xs text-foreground">
                    {details.client.id}
                  </code>
                </div>
                {details.client.uri ? (
                  <div>
                    <span className="font-medium text-foreground">
                      Client URI:
                    </span>{" "}
                    <span className="break-all text-muted-foreground">
                      {details.client.uri}
                    </span>
                  </div>
                ) : null}
              </div>
            </section>

            <section className="rounded-xl border border-border bg-muted/30 p-5">
              <h2 className="text-base font-semibold text-foreground">
                Requested access
              </h2>
              <div className="mt-3 space-y-3 text-sm text-muted-foreground">
                <p>
                  <span className="font-medium text-foreground">
                    Signed-in user:
                  </span>{" "}
                  {details.user.email || details.user.id || "Unknown user"}
                </p>
                <div>
                  <p className="font-medium text-foreground">Scopes</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {scopes.length > 0 ? (
                      scopes.map((scope) => (
                        <span
                          key={scope}
                          className="rounded-full border border-border bg-background px-3 py-1 text-xs text-foreground"
                        >
                          {scope}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        No scopes listed.
                      </span>
                    )}
                  </div>
                </div>
                {details.redirect_uri ? (
                  <p>
                    <span className="font-medium text-foreground">
                      Callback:
                    </span>{" "}
                    <span className="break-all">{details.redirect_uri}</span>
                  </p>
                ) : null}
              </div>
            </section>

            <ConsentActions authorizationId={authorizationId} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

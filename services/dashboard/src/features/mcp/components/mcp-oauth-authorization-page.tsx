"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase-browser";
import { getUserErrorMessage } from "@/lib/api-error";
import { getValidPathSegmentParam } from "@/lib/route-params";
import { PageLoading } from "@/components/feedback/page-loading";
import {
  fetchMcpOAuthAuthorization,
  submitMcpOAuthConsent,
} from "@/features/mcp/api";
import type { McpOAuthAuthorizationDetails } from "@/features/mcp/types";

export function McpOAuthAuthorizationPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const authorizationId = getValidPathSegmentParam(
    searchParams.get("authorization_id"),
  );
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<McpOAuthAuthorizationDetails | null>(
    null,
  );

  useEffect(() => {
    async function load() {
      if (!authorizationId) {
        setError("Missing authorization request.");
        setLoading(false);
        return;
      }

      const supabase = createBrowserClient();
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        const next = `/auth/oauth/authorize?authorization_id=${encodeURIComponent(authorizationId)}`;
        router.replace(`/login?next=${encodeURIComponent(next)}`);
        return;
      }

      try {
        const nextDetails = await fetchMcpOAuthAuthorization(authorizationId);
        setDetails(nextDetails);
        setError(null);
      } catch (err) {
        setError(
          getUserErrorMessage(err, "Failed to load authorization request"),
        );
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [authorizationId, router]);

  const scopes = useMemo(
    () => details?.scope?.split(/\s+/).filter(Boolean) ?? [],
    [details?.scope],
  );

  async function handleAction(action: "approve" | "deny") {
    if (!authorizationId) {
      setError("Missing authorization request.");
      return;
    }

    setSubmitting(action);
    setError(null);
    try {
      const result = await submitMcpOAuthConsent({ authorizationId, action });
      window.location.assign(result.redirect_url);
    } catch (err) {
      setError(getUserErrorMessage(err, `Failed to ${action} request`));
      setSubmitting(null);
    }
  }

  if (loading) {
    return <PageLoading />;
  }

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

        {error ? (
          <div className="mb-6 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
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
                    <span className="text-muted-foreground">
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

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => void handleAction("deny")}
                disabled={submitting !== null}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
              >
                {submitting === "deny" ? "Denying…" : "Deny"}
              </button>
              <button
                type="button"
                onClick={() => void handleAction("approve")}
                disabled={submitting !== null}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {submitting === "approve"
                  ? "Approving…"
                  : "Approve and continue"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

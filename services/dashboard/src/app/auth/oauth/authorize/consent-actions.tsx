"use client";

import { useEffect, useState } from "react";
import type { McpOAuthConsentResult } from "@/features/mcp/types";

type ConsentActionsProps = {
  authorizationId: string;
};

export function ConsentActions({ authorizationId }: ConsentActionsProps) {
  const [submitting, setSubmitting] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!redirectUrl) {
      return;
    }

    window.location.replace(redirectUrl);
  }, [redirectUrl]);

  async function handleAction(action: "approve" | "deny") {
    setSubmitting(action);
    setError(null);

    try {
      const formData = new FormData();
      formData.set("authorization_id", authorizationId);
      formData.set("action", action);

      const response = await fetch("/auth/oauth/authorize/consent", {
        method: "POST",
        body: formData,
        credentials: "same-origin",
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Failed to ${action} request`);
      }

      const result = (await response.json()) as McpOAuthConsentResult;
      setRedirectUrl(result.redirect_url);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : `Failed to ${action} request`,
      );
      setSubmitting(null);
    }
  }

  return (
    <div className="space-y-3">
      {redirectUrl ? (
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          Authorization complete. Returning to your MCP client...
          <div className="mt-2">
            <a
              href={redirectUrl}
              className="font-medium text-foreground underline underline-offset-4"
            >
              Continue manually
            </a>
          </div>
        </div>
      ) : null}

      {error ? (
        <div
          aria-live="polite"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => void handleAction("deny")}
          disabled={submitting !== null || redirectUrl !== null}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting === "deny" ? "Denying..." : "Deny"}
        </button>
        <button
          type="button"
          onClick={() => void handleAction("approve")}
          disabled={submitting !== null || redirectUrl !== null}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting === "approve" ? "Approving..." : "Approve and continue"}
        </button>
      </div>
    </div>
  );
}

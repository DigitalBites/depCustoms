"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase-browser";
import { syncServerSession } from "@/lib/session-sync";

type SetupFirstUserFormProps = {
  bootstrapSecret?: string;
  onBootstrapSecretChange?: (value: string) => void;
  onCreated?: () => void | Promise<void>;
  showBootstrapSecretField?: boolean;
};

export function SetupFirstUserForm({
  bootstrapSecret: bootstrapSecretProp,
  onBootstrapSecretChange,
  onCreated,
  showBootstrapSecretField = true,
}: SetupFirstUserFormProps) {
  const router = useRouter();
  const [bootstrapSecretState, setBootstrapSecretState] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = createBrowserClient();

  const bootstrapSecret = bootstrapSecretProp ?? bootstrapSecretState;

  function updateBootstrapSecret(value: string) {
    if (onBootstrapSecretChange) {
      onBootstrapSecretChange(value);
      return;
    }
    setBootstrapSecretState(value);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/internal/bootstrap/first-user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-bootstrap-secret": bootstrapSecret,
        },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string; detail?: string | null };
        } | null;
        throw new Error(
          payload?.error?.detail ||
            payload?.error?.message ||
            "Unable to create the first user.",
        );
      }

      const { data, error: signInError } = await supabase.auth.signInWithPassword(
        {
          email,
          password,
        },
      );
      if (signInError) {
        throw new Error(
          `First user created, but automatic sign-in failed: ${signInError.message}`,
        );
      }

      await syncServerSession(data.session);
      await waitForBrowserSession(supabase);
      await onCreated?.();
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to create the first user.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-3">
      {showBootstrapSecretField ? (
        <label className="block">
          <span className="text-sm font-medium text-foreground">
            Bootstrap secret
          </span>
          <input
            type="password"
            value={bootstrapSecret}
            onChange={(event) => updateBootstrapSecret(event.target.value)}
            placeholder="Paste BOOTSTRAP_FIRST_USER_SECRET"
            required
            autoComplete="off"
            className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            This secret is used only to authorize first-user creation and is
            not stored in the dashboard.
          </p>
        </label>
      ) : null}

      <label className="block">
        <span className="text-sm font-medium text-foreground">Email</span>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          required
          className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-foreground">Password</span>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="At least 8 characters"
          required
          minLength={8}
          className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-foreground">
          Confirm password
        </span>
        <input
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          placeholder="Repeat password"
          required
          minLength={8}
          className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </label>

      <button
        type="submit"
        disabled={submitting || !bootstrapSecret}
        className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        {submitting ? "Creating account…" : "Create first account"}
      </button>

      {error ? (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}

async function waitForBrowserSession(
  supabase: ReturnType<typeof createBrowserClient>,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session) {
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
}

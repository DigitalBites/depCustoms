"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase-browser";
import { getUserErrorMessage } from "@/lib/api-error";
import { syncServerSession } from "@/lib/session-sync";

export function LoginPageClient() {
  const showSocialLogin = false;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [magicSent, setMagicSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supabase = createBrowserClient();
  async function handleOAuth(provider: "github" | "google") {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setError(
        getUserErrorMessage(error, `Unable to start ${provider} sign-in.`),
      );
    }
  }

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);
    if (error) {
      setError(
        getUserErrorMessage(
          error,
          "Sign-in failed. Check your email and password.",
        ),
      );
    } else {
      await syncServerSession(data.session);
      await waitForBrowserSession(supabase);
      window.location.assign("/setup");
    }
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });

    setLoading(false);
    if (error) {
      setError(getUserErrorMessage(error, "Unable to send the magic link."));
    } else {
      setMagicSent(true);
    }
  }

  async function handleOtp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token: otp,
      type: "email",
    });

    setLoading(false);
    if (error) {
      setError(
        getUserErrorMessage(
          error,
          "Verification failed. Check the code and try again.",
        ),
      );
    } else {
      await syncServerSession(data.session);
      await waitForBrowserSession(supabase);
      window.location.assign("/setup");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            depCustoms
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Dependency policy gateway
          </p>
        </div>

        {showSocialLogin ? (
          <>
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => handleOAuth("github")}
                className="w-full flex items-center justify-center gap-2 rounded-lg border border-border bg-secondary px-4 py-2.5 text-sm font-medium text-secondary-foreground hover:bg-accent transition-colors"
              >
                <GithubIcon />
                Continue with GitHub
              </button>
              <button
                type="button"
                onClick={() => handleOAuth("google")}
                className="w-full flex items-center justify-center gap-2 rounded-lg border border-border bg-secondary px-4 py-2.5 text-sm font-medium text-secondary-foreground hover:bg-accent transition-colors"
              >
                <GoogleIcon />
                Continue with Google
              </button>
            </div>

            <div className="my-6 flex items-center gap-3">
              <div className="flex-1 border-t border-border" />
              <span className="text-xs text-muted-foreground">or</span>
              <div className="flex-1 border-t border-border" />
            </div>
          </>
        ) : null}

        {mode === "password" && (
          <form onSubmit={handlePassword} className="space-y-3">
            <label className="block">
              <span className="text-sm font-medium text-foreground">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-foreground">
                Password
              </span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("magic");
                setError(null);
              }}
              className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Send a magic link instead
            </button>
          </form>
        )}

        {mode === "magic" &&
          (magicSent ? (
            <form onSubmit={handleOtp} className="space-y-3">
              <p className="text-sm text-muted-foreground text-center">
                Email sent to{" "}
                <span className="font-medium text-foreground">{email}</span>.
                Enter the code from the email, or click the link directly.
              </p>
              <label className="block">
                <span className="text-sm font-medium text-foreground">
                  Verification code
                </span>
                <input
                  type="text"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.trim())}
                  placeholder="123456"
                  required
                  autoFocus
                  className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm tracking-widest placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {loading ? "Verifying…" : "Verify code"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMagicSent(false);
                  setOtp("");
                  setError(null);
                }}
                className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Resend email
              </button>
            </form>
          ) : (
            <form onSubmit={handleMagicLink} className="space-y-3">
              <label className="block">
                <span className="text-sm font-medium text-foreground">
                  Email
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {loading ? "Sending…" : "Send magic link"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("password");
                  setError(null);
                }}
                className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Sign in with password instead
              </button>
            </form>
          ))}

        {error && (
          <p className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
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

function GithubIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4 fill-current"
    >
      <path d="M12 .5C5.65.5.5 5.8.5 12.34c0 5.24 3.3 9.68 7.88 11.24.58.11.79-.26.79-.57 0-.28-.01-1.03-.02-2.02-3.2.71-3.88-1.58-3.88-1.58-.52-1.37-1.28-1.73-1.28-1.73-1.05-.74.08-.73.08-.73 1.16.08 1.77 1.23 1.77 1.23 1.03 1.82 2.71 1.3 3.37.99.1-.77.4-1.3.72-1.6-2.55-.3-5.24-1.32-5.24-5.9 0-1.3.45-2.37 1.19-3.21-.12-.31-.52-1.56.11-3.25 0 0 .97-.32 3.19 1.23a10.9 10.9 0 0 1 5.8 0c2.22-1.55 3.19-1.23 3.19-1.23.63 1.69.23 2.94.11 3.25.74.84 1.19 1.91 1.19 3.21 0 4.6-2.7 5.59-5.27 5.89.41.36.78 1.08.78 2.18 0 1.57-.01 2.84-.01 3.23 0 .31.21.69.8.57A11.87 11.87 0 0 0 23.5 12.34C23.5 5.8 18.35.5 12 .5Z" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
      <path
        d="M21.8 12.23c0-.77-.07-1.5-.2-2.2H12v4.17h5.49a4.7 4.7 0 0 1-2.04 3.08v2.56h3.3c1.93-1.83 3.05-4.52 3.05-7.61Z"
        fill="#4285F4"
      />
      <path
        d="M12 22c2.76 0 5.08-.94 6.77-2.56l-3.3-2.56c-.92.63-2.09 1-3.47 1-2.67 0-4.94-1.87-5.75-4.38H2.84v2.67A10 10 0 0 0 12 22Z"
        fill="#34A853"
      />
      <path
        d="M6.25 13.5A6.1 6.1 0 0 1 5.93 12c0-.52.09-1.03.25-1.5V7.83H2.84A10.24 10.24 0 0 0 2 12c0 1.47.35 2.86.96 4.17l3.29-2.67Z"
        fill="#FBBC05"
      />
      <path
        d="M12 6.12c1.5 0 2.84.53 3.9 1.56l2.93-3.02C17.07 2.99 14.75 2 12 2a10 10 0 0 0-9.16 5.83l3.34 2.67C7.06 7.99 9.33 6.12 12 6.12Z"
        fill="#EA4335"
      />
    </svg>
  );
}

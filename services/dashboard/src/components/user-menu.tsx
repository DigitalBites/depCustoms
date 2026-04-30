"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  getPasswordConfirmationError,
  PasswordConfirmationFields,
} from "@/components/ui/password-confirmation-fields";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getUserErrorMessage } from "@/lib/api-error";
import type { DashboardRole } from "@/lib/dashboard-roles";
import { createBrowserClient } from "@/lib/supabase-browser";

function providerLabel(provider: string): string {
  return provider === "email" ? "Internal" : provider;
}

export function UserMenu({
  email,
  role,
  authProvider,
  compact = false,
}: {
  email: string;
  role: DashboardRole;
  authProvider: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const compactTriggerRef = useRef<HTMLButtonElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{
    bottom: number;
    left: number;
  } | null>(null);

  const isInternal = authProvider === "email";
  const displayProvider = providerLabel(authProvider);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function handleSignOut() {
    const supabase = createBrowserClient();
    await supabase.auth.signOut();
    window.location.assign("/login");
  }

  function openPasswordModal() {
    setOpen(false);
    setNewPassword("");
    setConfirmPassword("");
    setPasswordError(null);
    setSuccess(false);
    setShowPasswordModal(true);
  }

  function closePasswordModal() {
    setShowPasswordModal(false);
    setNewPassword("");
    setConfirmPassword("");
    setPasswordError(null);
    setSuccess(false);
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    const mismatchError = getPasswordConfirmationError(
      newPassword,
      confirmPassword,
    );
    if (mismatchError) {
      setPasswordError(mismatchError);
      return;
    }
    setSaving(true);
    setPasswordError(null);
    try {
      const supabase = createBrowserClient();
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (error) {
        setPasswordError(
          getUserErrorMessage(error, "Unable to update password."),
        );
        return;
      }
      setSuccess(true);
      setTimeout(closePasswordModal, 1500);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      {compact ? (
        <div className="relative flex justify-center">
          <button
            ref={compactTriggerRef}
            type="button"
            onClick={() => {
              if (compactTriggerRef.current) {
                const r = compactTriggerRef.current.getBoundingClientRect();
                setDropdownPos({
                  bottom: window.innerHeight - r.top,
                  left: r.right + 8,
                });
              }
              setOpen((v) => !v);
            }}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            title={email}
          >
            {email.charAt(0).toUpperCase()}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full text-left px-1 py-1 rounded-md hover:bg-accent transition-colors group"
        >
          <p className="text-xs text-muted-foreground group-hover:text-foreground truncate">
            {email}
          </p>
        </button>
      )}

      {/* Dropdown content — shared between both modes */}
      {open &&
        (() => {
          const dropdownContent = (
            <div>
              <div className="px-3 py-2 border-b border-border">
                <p className="text-xs text-muted-foreground truncate">
                  {email}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <p className="text-xs text-muted-foreground capitalize">
                    {role}
                  </p>
                  <span className="text-muted-foreground/30">·</span>
                  <p className="text-xs text-muted-foreground">
                    {displayProvider}
                  </p>
                </div>
              </div>

              {isInternal ? (
                <button
                  type="button"
                  onClick={openPasswordModal}
                  className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors"
                >
                  Change password
                </button>
              ) : (
                <div title={`Password is managed by ${displayProvider}`}>
                  <button
                    type="button"
                    disabled
                    className="w-full text-left px-3 py-2 text-sm text-foreground opacity-40 cursor-not-allowed"
                  >
                    Change password
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={handleSignOut}
                className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors"
              >
                Sign out
              </button>
            </div>
          );

          if (compact && dropdownPos) {
            // Portal to escape the sidebar's overflow:hidden
            return createPortal(
              <div
                style={{
                  position: "fixed",
                  bottom: dropdownPos.bottom,
                  left: dropdownPos.left,
                  zIndex: 9999,
                }}
                className="w-52 rounded-lg border border-border bg-card shadow-md py-1"
              >
                {dropdownContent}
              </div>,
              document.body,
            );
          }

          return (
            <div className="absolute bottom-full left-0 mb-1 w-52 rounded-lg border border-border bg-card shadow-md py-1 z-50">
              {dropdownContent}
            </div>
          );
        })()}

      {/* Change password modal */}
      <Dialog
        open={showPasswordModal}
        onOpenChange={(open) => !open && closePasswordModal()}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Change password</DialogTitle>
          </DialogHeader>

          {success ? (
            <p className="text-sm text-green-600 dark:text-green-400">
              Password updated successfully.
            </p>
          ) : (
            <form onSubmit={handleChangePassword} className="space-y-3">
              <PasswordConfirmationFields
                passwordLabel="New password"
                password={newPassword}
                confirmPassword={confirmPassword}
                onPasswordChange={setNewPassword}
                onConfirmPasswordChange={setConfirmPassword}
                autoFocus
              />

              {passwordError && (
                <p className="text-xs text-destructive">{passwordError}</p>
              )}

              <DialogFooter className="pt-1 sm:justify-start">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Update password"}
                </button>
                <button
                  type="button"
                  onClick={closePasswordModal}
                  className="rounded-md border border-border px-4 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
                >
                  Cancel
                </button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

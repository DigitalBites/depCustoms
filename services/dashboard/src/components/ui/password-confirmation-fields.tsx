"use client";

type PasswordConfirmationFieldsProps = {
  passwordLabel?: string;
  confirmLabel?: string;
  password: string;
  confirmPassword: string;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  autoFocus?: boolean;
};

export function getPasswordConfirmationError(
  password: string,
  confirmPassword: string,
): string | null {
  if (!confirmPassword) {
    return null;
  }

  return password === confirmPassword ? null : "Passwords do not match.";
}

export function PasswordConfirmationFields({
  passwordLabel = "Password",
  confirmLabel = "Confirm password",
  password,
  confirmPassword,
  onPasswordChange,
  onConfirmPasswordChange,
  autoFocus = false,
}: PasswordConfirmationFieldsProps) {
  const mismatchError = getPasswordConfirmationError(password, confirmPassword);

  return (
    <>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          {passwordLabel}
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
          autoFocus={autoFocus}
          className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          {confirmLabel}
        </label>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => onConfirmPasswordChange(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
          className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
        {mismatchError ? (
          <p className="mt-1 text-xs text-destructive">{mismatchError}</p>
        ) : null}
      </div>
    </>
  );
}

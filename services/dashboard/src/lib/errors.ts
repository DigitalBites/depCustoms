type ErrorLike = {
  code?: unknown;
  status?: unknown;
  message?: unknown;
};

function errorFields(error: unknown): ErrorLike {
  if (!error || typeof error !== "object") return {};
  return error as ErrorLike;
}

export function getErrorCode(error: unknown): string | undefined {
  const fields = errorFields(error);
  return typeof fields.code === "string" ? fields.code : undefined;
}

export function getErrorStatus(error: unknown): number | undefined {
  const fields = errorFields(error);
  return typeof fields.status === "number" ? fields.status : undefined;
}

export function getErrorMessage(error: unknown): string | undefined {
  const fields = errorFields(error);
  return typeof fields.message === "string" ? fields.message : undefined;
}

export function errorLogFields(error: unknown) {
  return {
    error_code: getErrorCode(error),
    status: getErrorStatus(error),
  };
}

export function isSessionExpiredAuthError(error: unknown): boolean {
  const code = getErrorCode(error) ?? "";
  const message = getErrorMessage(error) ?? "";

  return (
    code === "session_expired" ||
    message.toLowerCase().includes("session expired")
  );
}

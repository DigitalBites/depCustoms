export type DashboardApiError = Error & {
  status?: number;
  code?: string;
  detail?: unknown;
  apiMessage?: string;
};

const CODE_MESSAGES: Record<string, string> = {
  auth_failed: "Authentication failed. Please sign in again.",
  invalid_credentials:
    "Authentication failed. Check your credentials and try again.",
  forbidden: "You do not have permission to perform that action.",
  not_found: "The requested resource was not found.",
  rate_limited: "Too many requests. Please try again shortly.",
  validation_error: "The submitted form contains invalid values.",
};

export function getApiErrorMessage(status: number, code?: string): string {
  if (code && CODE_MESSAGES[code]) {
    return CODE_MESSAGES[code];
  }

  switch (status) {
    case 400:
      return "The request could not be processed. Check the submitted values and try again.";
    case 401:
      return "Authentication failed. Please sign in again.";
    case 403:
      return "You do not have permission to perform that action.";
    case 404:
      return "The requested resource was not found.";
    case 409:
      return "The request could not be completed because it conflicts with the current state.";
    case 429:
      return "Too many requests. Please try again shortly.";
    default:
      return "The request failed. Please try again.";
  }
}

export function getUserErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object") {
    const candidate = error as DashboardApiError;
    if (typeof candidate.code === "string" && CODE_MESSAGES[candidate.code]) {
      return CODE_MESSAGES[candidate.code];
    }
    if (typeof candidate.status === "number") {
      return getApiErrorMessage(candidate.status, candidate.code);
    }
  }

  return fallback;
}

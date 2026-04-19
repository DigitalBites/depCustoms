export const THEME_COOKIE_NAME = "customs-theme";

export type DashboardTheme = "light" | "dark";

export function normalizeTheme(
  value: string | null | undefined,
): DashboardTheme {
  return value === "dark" ? "dark" : "light";
}

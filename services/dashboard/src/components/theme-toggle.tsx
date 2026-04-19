"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  normalizeTheme,
  THEME_COOKIE_NAME,
  type DashboardTheme,
} from "@/lib/theme";

export function ThemeToggle({
  initialTheme,
  compact = false,
}: {
  initialTheme: DashboardTheme;
  compact?: boolean;
}) {
  const [theme, setTheme] = useState<DashboardTheme>(initialTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function handleToggle() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    document.cookie = `${THEME_COOKIE_NAME}=${nextTheme}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }

  const isDark = normalizeTheme(theme) === "dark";

  if (compact) {
    return (
      <div className="relative flex justify-center">
        <button
          type="button"
          onClick={handleToggle}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          title={isDark ? "Switch to light mode" : "Switch to dark mode"}
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground",
        "transition-colors hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {isDark ? (
        <Sun className="h-4 w-4 shrink-0" />
      ) : (
        <Moon className="h-4 w-4 shrink-0" />
      )}
      <span>{isDark ? "Light mode" : "Dark mode"}</span>
    </button>
  );
}

function applyTheme(theme: DashboardTheme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

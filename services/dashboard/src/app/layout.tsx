import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Inter } from "next/font/google";
import { PublicRuntimeConfigScript } from "@/components/public-runtime-config-script";
import { normalizeTheme, THEME_COOKIE_NAME } from "@/lib/theme";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "depCustoms",
  description: "Multi-tenant dependency policy gateway",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const theme = normalizeTheme(cookieStore.get(THEME_COOKIE_NAME)?.value);

  return (
    <html
      lang="en"
      className={theme === "dark" ? "dark" : undefined}
      style={{ colorScheme: theme }}
      suppressHydrationWarning
    >
      <body className={inter.className}>
        <PublicRuntimeConfigScript />
        {children}
      </body>
    </html>
  );
}

import { Suspense } from "react";
import { env } from "cloudflare:workers";
import { getGoogleUser } from "@/lib/auth/google";
import { readAccount } from "@/lib/accounts/service";
import { isAdministrator } from "@/lib/accounts/access";
import AppNavigation from "@/components/app-navigation";
import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Event — Explore events",
  description:
    "Events, markets and your practice portfolio.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};
export const dynamic = "force-dynamic";
export const viewport: Viewport = { width: "device-width", initialScale: 1 };
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let admin = false,
    signedIn = false;
  try {
    const identity = await getGoogleUser();
    signedIn = Boolean(identity);
    if (identity && env.DB)
      admin = isAdministrator(
        await readAccount(env.DB, identity),
        (env as unknown as Record<string, string | undefined>).ADMIN_ACCOUNT_ID,
      );
  } catch {
    /* Public navigation remains available if authentication is unavailable. */
  }
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <Suspense
          fallback={
            <header className="app-topbar">
              <a className="brand" href="/">
                event.
              </a>
            </header>
          }
        >
          <AppNavigation admin={admin} signedIn={signedIn} />
        </Suspense>
        {children}
      </body>
    </html>
  );
}

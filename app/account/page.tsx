import { getGoogleUser, googleConfig } from "@/lib/auth/google";
import { Button } from "@/components/ui/button";
import AccountPanel from "./account-panel";
export const dynamic = "force-dynamic";
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ auth?: string; reason?: string }>;
}) {
  let user = null;
  let storageFailed = false;
  try {
    user = await getGoogleUser();
  } catch {
    storageFailed = true;
  }
  const config = googleConfig();
  const { auth, reason } = await searchParams;
  return (
    <div className="account-page">
      <main id="main-content" tabIndex={-1} className="account-layout">
        <section className="account-intro">
          <h1>Account</h1>
          <nav className="account-settings-links" aria-label="Account settings">
            <a href="/account/eligibility">Verification &amp; access →</a>
            <a href="/practice/fees">Fees →</a>
          </nav>
        </section>
        {user ? (
          <AccountPanel email={user.email} suggestedName={user.displayName} />
        ) : (
          <section className="account-card">
            <h2>Sign in</h2>
            {storageFailed && (
              <p role="alert" className="account-error">
                Account services are temporarily unavailable. Please reload to
                try again.
              </p>
            )}
            {auth === "failed" && (
              <p role="alert" className="account-error">
                {reason === "browser_cookie_missing"
                  ? "Your browser did not retain the sign-in cookie. Open this site in your browser, allow cookies, and start sign-in again."
                  : reason === "login_expired" || reason === "code_rejected"
                    ? "This sign-in attempt expired or was already used. Start a new sign-in below."
                    : reason === "google_declined"
                      ? "Google sign-in was cancelled. You can try again below."
                      : "Sign-in could not be completed. Please start a new sign-in below."}
              </p>
            )}
            {auth === "deactivated" && (
              <p role="status">
                Your Event account is deactivated. Sign in again to reactivate
                it.
              </p>
            )}
            {config.ready ? (
              <a
                className="account-primary"
                href="/api/auth/google"
                target="_top"
              >
                Continue with Google <span>→</span>
              </a>
            ) : (
              <>
                <Button disabled className="w-full my-6">
                  Continue with Google
                </Button>
                <p role="status" className="account-caption">
                  Google sign-in is currently unavailable.
                </p>
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

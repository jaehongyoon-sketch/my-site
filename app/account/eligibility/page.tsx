import { env } from "cloudflare:workers";
import { getGoogleUser } from "@/lib/auth/google";
import { eligibility } from "@/lib/eligibility/service";
export const dynamic = "force-dynamic";
export default async function EligibilityPage() {
  let data: Awaited<ReturnType<typeof eligibility>> | null = null,
    error = "";
  try {
    const identity = await getGoogleUser();
    if (!identity) error = "Sign in to view your account eligibility.";
    else if (env.DB) data = await eligibility(env.DB, identity);
    else error = "Eligibility is temporarily unavailable.";
  } catch {
    error = "Eligibility is temporarily unavailable. Please refresh.";
  }
  return (
    <div className="account-page">
      <main id="main-content" tabIndex={-1} className="practice-main">
        <h1>Verification &amp; trading access</h1>
        {error && (
          <p role="alert" className="account-error">
            {error} <a href="/account">Account settings</a>
          </p>
        )}
        {data && (
          <>
            <section className="account-card">
              <h2>Real trading is unavailable</h2>
              <p>
                Google sign-in confirms your login. It does not verify your
                identity, age, location or eligibility to trade with real money.
              </p>
              <dl className="market-status-facts">
                <div>
                  <dt>Google sign-in</dt>
                  <dd>Confirmed</dd>
                </div>
                <div>
                  <dt>Event profile</dt>
                  <dd>{data.profile}</dd>
                </div>
                <div>
                  <dt>Identity &amp; age verification</dt>
                  <dd>Service not connected</dd>
                </div>
                <div>
                  <dt>Location &amp; eligibility checks</dt>
                  <dd>Service not connected</dd>
                </div>
                <div>
                  <dt>Real trading &amp; payments</dt>
                  <dd>Not connected</dd>
                </div>
              </dl>
              <p>No identity documents or bank details are collected here.</p>
            </section>
            <section className="account-card">
              <h2>Practice access</h2>
              <p>
                {data.practiceAllowed
                  ? "New practice orders are allowed. Virtual funds have no cash value."
                  : "New practice orders are unavailable for this account."}
              </p>
              {data.tradingRestricted && (
                <p className="account-error">
                  An administrator has restricted new trading. Existing orders
                  are paused from matching, not cancelled. You can still view
                  your records and cancel reservations while your profile is
                  active. Removing a restriction allows eligible open orders to
                  match again.
                </p>
              )}
              <div className="event-actions">
                <a href="/practice">Practice portfolio</a>
                <a href="/practice/activity">Funds &amp; activity</a>
              </div>
            </section>
            <h2>Before real trading can become available</h2>
            <ul>
              {data.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <p className="account-caption">
              Removing an account restriction does not approve identity
              verification or enable real trading.
            </p>
          </>
        )}
      </main>
    </div>
  );
}

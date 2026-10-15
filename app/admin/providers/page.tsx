import { env } from "cloudflare:workers";
import { getGoogleUser } from "@/lib/auth/google";
import {
  getProviderControls,
  ProviderControlError,
} from "@/lib/providers/control";
import ProviderPanel from "./provider-panel";
export const dynamic = "force-dynamic";
export default async function ProvidersPage() {
  let data: null | Awaited<ReturnType<typeof getProviderControls>> = null;
  let error = "";
  try {
    const identity = await getGoogleUser();
    if (!identity)
      throw new ProviderControlError(
        401,
        "Sign in with your administrator account.",
      );
    if (!env.DB) throw new Error("DB unavailable");
    data = await getProviderControls(
      env.DB,
      identity,
      (env as unknown as Record<string, string | undefined>).ADMIN_ACCOUNT_ID,
    );
  } catch (e) {
    error =
      e instanceof ProviderControlError
        ? e.message
        : "Connections unavailable. Reload to retry.";
  }
  return (
    <div className="account-page">
      <main id="main-content" tabIndex={-1} className="admin-main">
        <h1>Exchange connections</h1>
        <p className="sub">Track approvals before connecting an exchange.</p>
        {data ? (
          <ProviderPanel initial={data} />
        ) : (
          <section className="account-card">
            <p role="alert">{error}</p>
            <a href="/account">Go to account</a>
          </section>
        )}
      </main>
    </div>
  );
}

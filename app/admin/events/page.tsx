import { env } from "cloudflare:workers";
import { getGoogleUser } from "@/lib/auth/google";
import {
  requireEventAdmin,
  listOwnEvents,
  EventError,
} from "@/lib/events/service";
import EventManager from "./event-manager";
export const dynamic = "force-dynamic";
export default async function EventAdmin({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    q?: string;
    status?: string;
    notice?: string;
  }>;
}) {
  let data: null | Awaited<ReturnType<typeof listOwnEvents>> = null;
  let error = "";
  const p = await searchParams;
  try {
    const identity = await getGoogleUser();
    if (!identity)
      throw new EventError(401, "Sign in with your administrator account.");
    if (!env.DB) throw new Error();
    await requireEventAdmin(
      env.DB,
      identity,
      (env as unknown as Record<string, string | undefined>).ADMIN_ACCOUNT_ID,
    );
    data = await listOwnEvents(
      env.DB,
      { ...p, page: Number(p.page ?? 0) },
      true,
    );
  } catch (e) {
    error =
      e instanceof EventError
        ? e.message
        : "Events unavailable. Reload to retry.";
  }
  return (
    <div className="account-page">
      <main id="main-content" tabIndex={-1} className="admin-main">
        <h1>Your events</h1>
        {data ? (
          <>
            <p role="status">
              {p.notice === "deleted"
                ? "Draft deleted."
                : p.notice === "published"
                  ? "Event published."
                  : p.notice === "archived"
                    ? "Event hidden."
                    : p.notice === "draft"
                      ? "Draft saved."
                      : ""}{" "}
              {p.notice === "published" && <a href="/">View home page →</a>}
            </p>
            <EventManager initial={data} />
          </>
        ) : (
          <section className="account-card" role="alert">
            {error} <a href="/account">My account</a>
          </section>
        )}
      </main>
    </div>
  );
}

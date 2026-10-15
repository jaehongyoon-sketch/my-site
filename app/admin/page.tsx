import { env } from "cloudflare:workers";
import { getGoogleUser } from "@/lib/auth/google";
import { AccessError, getAdminAccounts } from "@/lib/accounts/access";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
export const dynamic = "force-dynamic";
export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  let data: null | Awaited<ReturnType<typeof getAdminAccounts>> = null;
  let error = "";
  try {
    const identity = await getGoogleUser();
    if (!identity)
      throw new AccessError(401, "Sign in with your administrator account.");
    if (!env.DB) throw new Error("DB unavailable");
    const raw = (await searchParams).page ?? "0";
    if (!/^\d{1,3}$/.test(raw)) throw new AccessError(400, "Invalid page.");
    data = await getAdminAccounts(
      env.DB,
      identity,
      (env as unknown as Record<string, string | undefined>).ADMIN_ACCOUNT_ID,
      Number(raw),
    );
  } catch (e) {
    error =
      e instanceof AccessError
        ? e.message
        : "Account list unavailable. Please reload to retry.";
  }
  return (
    <div className="account-page">
      <main id="main-content" tabIndex={-1} className="admin-main">
        <p>
          <a href="/admin/eligibility">Trading restrictions →</a>
        </p>
        <p>
          <a href="/admin/resolutions">Review event outcomes →</a>
        </p>
        <p>
          <a href="/admin/operations">Trading controls & audit log →</a>
        </p>
        <h1>Accounts</h1>
        <a className="account-link" href="/admin/events">
          Manage your events →
        </a>
        <br />
        <a className="account-link" href="/admin/providers">
          Legacy exchange connections →
        </a>
        <p className="sub">
          Registered Event profiles and their unexpired login sessions.
        </p>
        {error ? (
          <section className="account-card">
            <p role="alert">{error}</p>
            <a className="account-link" href="/account">
              Go to account
            </a>
          </section>
        ) : (
          data && (
            <>
              <div className="admin-stats">
                <section>
                  <span>Registered accounts</span>
                  <strong>{data.totals?.accounts ?? 0}</strong>
                </section>
                <section>
                  <span>Active profiles</span>
                  <strong>{data.totals?.activeAccounts ?? 0}</strong>
                </section>
              </div>
              <section className="account-card admin-table" tabIndex={0} role="region" aria-label="Account table, scroll horizontally for more columns">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Profile</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Valid sessions</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.accounts.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell>
                          <strong>{a.displayName || "No display name"}</strong>
                          <small>{a.id}</small>
                        </TableCell>
                        <TableCell>{a.role}</TableCell>
                        <TableCell>{a.status}</TableCell>
                        <TableCell>{a.sessions}</TableCell>
                        <TableCell>{a.createdAt.slice(0, 10)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {data.accounts.length === 0 && (
                  <p>No registered accounts on this page.</p>
                )}
              </section>
              <p className="account-caption">
                A valid session does not mean someone is online now. Sessions
                expire after 7 days or are removed at sign-out. Google users who
                have not created an Event profile are not listed.
              </p>
              <nav className="admin-pagination" aria-label="Account pages">
                {data.page > 0 && (
                  <a
                    className="account-link"
                    href={`/admin?page=${data.page - 1}`}
                  >
                    Previous
                  </a>
                )}
                <span>Page {data.page + 1}</span>
                {data.hasMore && (
                  <a
                    className="account-link"
                    href={`/admin?page=${data.page + 1}`}
                  >
                    Next
                  </a>
                )}
              </nav>
            </>
          )
        )}
      </main>
    </div>
  );
}

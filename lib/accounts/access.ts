import type { Account, Identity } from "./service";
export class AccessError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export function isAdministrator(
  account: Pick<Account, "id" | "status"> | null,
  configuredId: string | undefined,
) {
  return Boolean(
    configuredId && account?.status === "active" && account.id === configuredId,
  );
}
export async function activeAccount(db: D1Database, identity: Identity) {
  const row = await db
    .prepare("SELECT id, status FROM app_users WHERE auth_subject = ?")
    .bind(`google:${identity.userId}`)
    .first<{ id: string; status: string }>();
  if (!row || row.status !== "active")
    throw new AccessError(
      403,
      "Create or reactivate your Event profile to use this feature.",
    );
  return row;
}
export async function listWatchlist(db: D1Database, identity: Identity) {
  const account = await activeAccount(db, identity);
  const result = await db
    .prepare(
      "SELECT market_id AS marketId FROM watchlist_entries WHERE user_id = ? ORDER BY created_at DESC, market_id LIMIT 100",
    )
    .bind(account.id)
    .all<{ marketId: string }>();
  return result.results.map((r) => r.marketId);
}
export async function setWatchlist(
  db: D1Database,
  identity: Identity,
  marketId: string,
  saved: boolean,
) {
  const account = await activeAccount(db, identity);
  if (saved)
    await db
      .prepare(
        "INSERT INTO watchlist_entries (user_id,market_id,created_at) SELECT id, ?, ? FROM app_users WHERE id = ? AND status = 'active' ON CONFLICT(user_id,market_id) DO NOTHING",
      )
      .bind(marketId, new Date().toISOString(), account.id)
      .run();
  else
    await db
      .prepare(
        "DELETE FROM watchlist_entries WHERE user_id = ? AND market_id = ?",
      )
      .bind(account.id, marketId)
      .run();
  return listWatchlist(db, identity);
}
export async function getAdminAccounts(
  db: D1Database,
  identity: Identity,
  configuredId: string | undefined,
  page = 0,
) {
  const actor = await activeAccount(db, identity);
  if (!isAdministrator(actor as Pick<Account, "id" | "status">, configuredId))
    throw new AccessError(403, "Administrator access required.");
  if (!Number.isInteger(page) || page < 0 || page > 200)
    throw new AccessError(400, "Invalid page.");
  const now = Date.now();
  // Only account information and aggregate session counts; never return auth subjects or tokens.
  const results = await db
    .prepare(
      `SELECT u.id, u.status, u.created_at AS createdAt, COALESCE(p.display_name,'') AS displayName,
    (SELECT count(*) FROM google_sessions s WHERE 'google:' || s.google_subject = u.auth_subject AND s.expires_at > ?) AS sessions
    FROM app_users u LEFT JOIN app_profiles p ON p.user_id = u.id ORDER BY u.created_at DESC,u.id LIMIT 51 OFFSET ?`,
    )
    .bind(now, page * 50)
    .all<{
      id: string;
      status: string;
      createdAt: string;
      displayName: string;
      sessions: number;
    }>();
  const totals = await db
    .prepare(
      `SELECT count(*) AS accounts, COALESCE(sum(status = 'active'),0) AS activeAccounts FROM app_users`,
    )
    .first<{ accounts: number; activeAccounts: number }>();
  return {
    accounts: results.results
      .slice(0, 50)
      .map((r) => ({ ...r, role: r.id === configuredId ? "admin" : "member" })),
    totals,
    page,
    hasMore: results.results.length > 50,
  };
}

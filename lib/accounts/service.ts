import { z } from "zod";

export type Identity = { userId: string; email: string; displayName: string };
export type Account = {
  id: string;
  status: "active" | "closed" | "suspended";
  createdAt: string;
  displayName: string;
  updatedAt: string | null;
  nameChangedAt?: number | null;
};
export const profileSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .refine((v) => !/[\u0000-\u001f\u007f]/.test(v)),
  })
  .strict();
export class AccountError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
// Verified Google subject from a server-side session, never client-supplied JSON.
export function accountSubject(identity: Identity) {
  return `google:${identity.userId}`;
}
export function checkMutationOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (
    !origin ||
    origin !== new URL(request.url).origin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new AccountError(403, "Please reload this page before trying again.");
  if (
    !request.headers
      .get("content-type")
      ?.split(";")[0]
      .trim()
      .toLowerCase()
      .match(/^application\/json$/)
  )
    throw new AccountError(415, "A JSON request is required.");
}
export async function readAccount(
  db: D1Database,
  identity: Identity,
): Promise<Account | null> {
  return db
    .prepare(
      `SELECT u.id, u.status, u.created_at AS createdAt, COALESCE(p.display_name, '') AS displayName, p.updated_at AS updatedAt, (SELECT changed_at FROM name_change_limits WHERE user_id=u.id) AS nameChangedAt
    FROM app_users u LEFT JOIN app_profiles p ON p.user_id = u.id WHERE u.auth_subject = ?`,
    )
    .bind(accountSubject(identity))
    .first<Account>();
}
export async function createAccount(
  db: D1Database,
  identity: Identity,
  input: unknown,
) {
  const { displayName } = profileSchema.parse(input);
  const now = new Date().toISOString();
  const subject = accountSubject(identity);
  // A batch is atomic. Concurrent registration uses the same unique auth subject.
  await db.batch([
    db
      .prepare(
        "INSERT INTO app_users (id, auth_subject, status, created_at) VALUES (?, ?, 'active', ?) ON CONFLICT(auth_subject) DO NOTHING",
      )
      .bind(crypto.randomUUID(), subject, now),
    db
      .prepare(
        "INSERT INTO app_profiles (user_id, display_name, updated_at) SELECT id, ?, ? FROM app_users WHERE auth_subject = ? AND status = 'active' ON CONFLICT(user_id) DO NOTHING",
      )
      .bind(displayName, now, subject),
  ]);
  const account = await readAccount(db, identity);
  if (!account || account.status !== "active")
    throw new AccountError(
      409,
      "This account cannot be registered again. Use the account controls.",
    );
  return account;
}
export const NAME_CHANGE_INTERVAL = 7 * 24 * 60 * 60 * 1000;
async function changeName(
  db: D1Database,
  identity: Identity,
  input: unknown,
  adminId: string | undefined,
  reactivate: boolean,
  now = Date.now(),
) {
  const { displayName } = profileSchema.parse(input);
  const account = await readAccount(db, identity);
  if (!account || account.status !== (reactivate ? "closed" : "active"))
    throw new AccountError(
      409,
      reactivate
        ? "Only a deactivated account can be reactivated."
        : "An active account is required.",
    );
  if (!reactivate && account.displayName === displayName) return account;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(displayName),
  );
  const hash = Array.from(new Uint8Array(digest), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
  const op = crypto.randomUUID();
  const result = await db.batch([
    db
      .prepare(
        `INSERT INTO name_change_limits (user_id,name_hash,changed_at,operation_id)
      SELECT u.id,?,?,? FROM app_users u WHERE u.id=? AND u.status=?
      ON CONFLICT(user_id) DO UPDATE SET name_hash=excluded.name_hash,
      changed_at=CASE WHEN name_change_limits.name_hash=excluded.name_hash THEN name_change_limits.changed_at ELSE excluded.changed_at END,
      operation_id=excluded.operation_id
      WHERE name_change_limits.changed_at<=? OR name_change_limits.name_hash=excluded.name_hash OR excluded.user_id=?`,
      )
      .bind(
        hash,
        now,
        op,
        account.id,
        reactivate ? "closed" : "active",
        now - NAME_CHANGE_INTERVAL,
        adminId ?? "",
      ),
    db
      .prepare(
        "UPDATE app_profiles SET display_name=?,updated_at=? WHERE user_id=? AND EXISTS (SELECT 1 FROM name_change_limits WHERE user_id=? AND operation_id=?)",
      )
      .bind(
        displayName,
        new Date(now).toISOString(),
        account.id,
        account.id,
        op,
      ),
    db
      .prepare(
        "UPDATE app_users SET status='active' WHERE id=? AND status='closed' AND EXISTS (SELECT 1 FROM name_change_limits WHERE user_id=? AND operation_id=?)",
      )
      .bind(account.id, account.id, op),
  ]);
  if (!result[0].meta.changes)
    throw new AccountError(
      429,
      "You can change your display name once every 7 days. Reload your account to see the next available date. When reactivating, use your last display name or wait until the restriction ends.",
    );
  return readAccount(db, identity);
}
export async function updateAccount(
  db: D1Database,
  identity: Identity,
  input: unknown,
  adminId?: string,
  now = Date.now(),
) {
  return changeName(db, identity, input, adminId, false, now);
}
export async function deactivateAccount(db: D1Database, identity: Identity) {
  const subject = accountSubject(identity);
  await db.batch([
    db
      .prepare(
        "UPDATE app_users SET status = 'closed' WHERE auth_subject = ? AND status = 'active'",
      )
      .bind(subject),
    db
      .prepare(
        "UPDATE app_profiles SET display_name = '', updated_at = ? WHERE user_id IN (SELECT id FROM app_users WHERE auth_subject = ? AND status = 'closed')",
      )
      .bind(new Date().toISOString(), subject),
    db
      .prepare("DELETE FROM google_sessions WHERE google_subject = ?")
      .bind(identity.userId),
  ]);
  return readAccount(db, identity);
}
export async function reactivateAccount(
  db: D1Database,
  identity: Identity,
  input: unknown,
  adminId?: string,
  now = Date.now(),
) {
  return changeName(db, identity, input, adminId, true, now);
}

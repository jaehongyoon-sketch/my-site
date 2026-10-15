import { AccountError } from "../accounts/service";
export function mutationLimit(path: string) {
  if (path.startsWith("/api/admin/")) return { scope: "admin", limit: 20 };
  if (path.endsWith("/cancel")) return { scope: "cancel", limit: 60 };
  if (path.startsWith("/api/practice/") && !path.endsWith("/events"))
    return { scope: "practice", limit: 60 };
  return { scope: "account-and-sync", limit: 30 };
}
// Persistent fixed-minute quota, shared across sessions for one verified Google subject.
// Hash subjects before storage; no cookie, token, IP or email is persisted here.
export async function limitMutation(
  db: D1Database,
  subject: string,
  path: string,
  clock = Date.now(),
) {
  const { scope, limit } = mutationLimit(path);
  const start = Math.floor(clock / 60000) * 60000;
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(scope + ":" + subject),
    ),
  );
  const key = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  const r = await db.batch([
    db
      .prepare(
        "DELETE FROM request_limits WHERE key IN (SELECT key FROM request_limits WHERE window_start<? LIMIT 100)",
      )
      .bind(start - 3600000),
    db
      .prepare(
        `INSERT INTO request_limits (key,window_start,count) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,count=CASE WHEN request_limits.window_start=excluded.window_start THEN request_limits.count+1 ELSE 1 END WHERE request_limits.window_start<>excluded.window_start OR request_limits.count<?`,
      )
      .bind(key, start, limit),
  ]);
  if (!r[1].meta.changes)
    throw new AccountError(
      429,
      "Too many requests. Wait up to 60 seconds, then retry. Existing orders are unchanged by this rejected request.",
    );
}

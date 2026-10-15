import { z } from "zod";
import { activeAccount, AccessError } from "../accounts/access";
import type { Identity } from "../accounts/service";
import { syncTradeEvents } from "../trade-events/service";
export type Notice = {
  id: string;
  kind: string;
  eventTitle: string;
  outcome: string;
  quantity: number;
  occurredAt: string;
  readAt: string | null;
};
export async function readNotifications(
  db: D1Database,
  identity: Identity,
  page = 0,
) {
  if (!Number.isInteger(page) || page < 0 || page > 10000)
    throw new AccessError(400, "Invalid page.");
  const a = await activeAccount(db, identity);
  const r = await db.batch([
    db
      .prepare(
        "SELECT enabled,revision FROM notification_settings WHERE user_id=?",
      )
      .bind(a.id),
    db
      .prepare(
        `SELECT n.id,e.kind,e.event_title AS eventTitle,e.outcome,e.quantity,e.occurred_at AS occurredAt,n.read_at AS readAt FROM notifications n JOIN practice_trade_events e ON e.id=n.id AND e.user_id=n.user_id WHERE n.user_id=? AND n.visible=1 ORDER BY e.occurred_at DESC,n.id DESC LIMIT 26 OFFSET ?`,
      )
      .bind(a.id, page * 25),
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM notifications WHERE user_id=? AND visible=1 AND read_at IS NULL",
      )
      .bind(a.id),
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM practice_trade_events e WHERE e.user_id=? AND NOT EXISTS(SELECT 1 FROM notifications n WHERE n.id=e.id)",
      )
      .bind(a.id),
  ]);
  const settings = r[0].results[0] as
    { enabled: number; revision: number } | undefined;
  return {
    enabled: settings ? !!settings.enabled : true,
    revision: settings?.revision ?? 0,
    entries: (r[1].results as Notice[]).slice(0, 25),
    hasMore: r[1].results.length > 25,
    page,
    unread: (r[2].results[0] as { count: number }).count,
    pending: (r[3].results[0] as { count: number }).count,
  };
}
const mutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sync") }).strict(),
  z
    .object({
      action: z.literal("settings"),
      enabled: z.boolean(),
      expectedRevision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({ action: z.literal("read"), id: z.string().min(1).max(200) })
    .strict(),
]);
export async function updateNotifications(
  db: D1Database,
  identity: Identity,
  raw: unknown,
) {
  const parsed = mutation.safeParse(raw);
  if (!parsed.success)
    throw new AccessError(400, "Invalid notification request.");
  const input = parsed.data,
    a = await activeAccount(db, identity),
    now = new Date().toISOString();
  let moreSource = false;
  if (input.action === "sync") {
    const events = await syncTradeEvents(db, identity, { action: "sync" });
    moreSource = events.counts.unrecorded > 0;
    await db.batch([
      db
        .prepare(
          `INSERT INTO notifications (id,user_id,visible,created_at) SELECT e.id,e.user_id,COALESCE(s.enabled,1),? FROM practice_trade_events e LEFT JOIN notification_settings s ON s.user_id=e.user_id WHERE e.user_id=? AND NOT EXISTS(SELECT 1 FROM notifications n WHERE n.id=e.id) AND EXISTS(SELECT 1 FROM app_users WHERE id=e.user_id AND status='active') ORDER BY e.occurred_at,e.id LIMIT 100 ON CONFLICT(id) DO NOTHING`,
        )
        .bind(now, a.id),
    ]);
  } else if (input.action === "settings") {
    const r = await db.batch([
      db
        .prepare(
          `INSERT INTO notification_settings (user_id,enabled,revision,updated_at) SELECT ?,?,1,? WHERE EXISTS(SELECT 1 FROM app_users WHERE id=? AND status='active') AND (?=0 OR EXISTS(SELECT 1 FROM notification_settings WHERE user_id=?)) ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,revision=notification_settings.revision+1,updated_at=excluded.updated_at WHERE notification_settings.revision=?`,
        )
        .bind(
          a.id,
          Number(input.enabled),
          now,
          a.id,
          input.expectedRevision,
          a.id,
          input.expectedRevision,
        ),
    ]);
    if (!r[0].meta.changes)
      throw new AccessError(409, "Settings changed. Refresh before saving.");
  } else {
    const r = await db.batch([
      db
        .prepare(
          "UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND user_id=? AND visible=1 AND EXISTS(SELECT 1 FROM app_users WHERE id=? AND status='active')",
        )
        .bind(now, input.id, a.id, a.id),
    ]);
    if (!r[0].meta.changes)
      throw new AccessError(404, "Notification not found.");
  }
  const result = await readNotifications(db, identity);
  return { ...result, hasMoreToSync: moreSource || result.pending > 0 };
}

import { activeAccount, AccessError } from "../accounts/access";
import type { Identity } from "../accounts/service";
import { z } from "zod";
// Only committed server-side receipts supply payloads. No event JSON is accepted
// from clients. Existing accounting remains authoritative and is never replayed.
const sourceSQL = `SELECT 'buy:'||o.id id,'buy_accepted' kind,o.id sourceId,o.event_id eventId,o.event_title eventTitle,o.outcome,o.quantity,o.created_at occurredAt FROM practice_orders o WHERE o.user_id=?
UNION ALL SELECT 'fill:'||x.match_id||':'||x.order_id,'buy_filled',x.match_id||':'||x.order_id,o.event_id,o.event_title,o.outcome,m.quantity,m.created_at FROM practice_match_entries x JOIN practice_matches m ON m.id=x.match_id JOIN practice_orders o ON o.id=x.order_id WHERE x.user_id=?
UNION ALL SELECT 'release:'||c.id,'buy_released',c.id,o.event_id,o.event_title,o.outcome,COALESCE(k.cancelled_quantity,o.quantity-p.filled_quantity),c.created_at FROM practice_cash_entries c JOIN practice_orders o ON o.id=c.order_id JOIN practice_order_progress p ON p.order_id=o.id LEFT JOIN practice_cancellations k ON k.order_id=o.id WHERE c.user_id=? AND c.kind='release'
UNION ALL SELECT 'sell:'||s.id,'sell_reserved',s.id,s.event_id,s.event_title,s.outcome,s.quantity,s.created_at FROM practice_sell_orders s WHERE s.user_id=?
UNION ALL SELECT 'sell-release:'||s.id,'sell_released',s.id,s.event_id,s.event_title,s.outcome,s.quantity,s.released_at FROM practice_sell_orders s WHERE s.user_id=? AND s.released_at IS NOT NULL`;
const sourceArgs = (user: string) => [user, user, user, user, user];
export type TradeEvent = {
  id: string;
  kind:
    | "buy_accepted"
    | "buy_filled"
    | "buy_released"
    | "sell_reserved"
    | "sell_released";
  sourceId: string;
  eventId: string;
  eventTitle: string;
  outcome: string;
  quantity: number;
  occurredAt: string;
  recordedAt: string;
  processedAt: string | null;
};
export async function readTradeEvents(
  db: D1Database,
  identity: Identity,
  page = 0,
) {
  const actor = await activeAccount(db, identity);
  if (!Number.isInteger(page) || page < 0 || page > 10000)
    throw new AccessError(400, "Invalid activity page.");
  const r = await db.batch([
    db
      .prepare(
        `SELECT e.id,e.kind,e.source_id AS sourceId,e.event_id AS eventId,e.event_title AS eventTitle,e.outcome,e.quantity,e.occurred_at AS occurredAt,e.recorded_at AS recordedAt,r.processed_at AS processedAt FROM practice_trade_events e LEFT JOIN practice_trade_receipts r ON r.event_id=e.id WHERE e.user_id=? ORDER BY e.occurred_at DESC,e.id DESC LIMIT 26 OFFSET ?`,
      )
      .bind(actor.id, page * 25),
    db
      .prepare(
        `SELECT COUNT(*) AS recorded,COALESCE(SUM(r.event_id IS NULL),0) AS pending,COALESCE(SUM(r.event_id IS NOT NULL),0) AS processed FROM practice_trade_events e LEFT JOIN practice_trade_receipts r ON r.event_id=e.id WHERE e.user_id=?`,
      )
      .bind(actor.id),
    db
      .prepare(
        `SELECT COUNT(*) AS unrecorded FROM (${sourceSQL}) s WHERE NOT EXISTS(SELECT 1 FROM practice_trade_events e WHERE e.id=s.id)`,
      )
      .bind(...sourceArgs(actor.id)),
  ]);
  const rows = r[0].results as TradeEvent[],
    counts = r[1].results[0] as {
      recorded: number;
      pending: number;
      processed: number;
    },
    unrecorded = (r[2].results[0] as { unrecorded: number }).unrecorded;
  return {
    mode: "practice" as const,
    events: rows.slice(0, 25),
    page,
    hasMore: rows.length > 25,
    counts: { ...counts, unrecorded },
    hasMoreToSync: counts.pending + unrecorded > 0,
  };
}
export async function syncTradeEvents(
  db: D1Database,
  identity: Identity,
  raw: unknown,
) {
  if (
    !z
      .object({ action: z.literal("sync") })
      .strict()
      .safeParse(raw).success
  )
    throw new AccessError(400, "Invalid sync request.");
  const actor = await activeAccount(db, identity),
    now = new Date().toISOString();
  // Pull at most 100 missing facts, without a time watermark. Late/reordered
  // facts and pre-Day-17 history remain discoverable after a crash or retry.
  await db.batch([
    db
      .prepare(
        `INSERT INTO practice_trade_events (id,user_id,kind,source_id,event_id,event_title,outcome,quantity,occurred_at,recorded_at)
 SELECT s.id,?,s.kind,s.sourceId,s.eventId,s.eventTitle,s.outcome,s.quantity,s.occurredAt,? FROM (${sourceSQL}) s WHERE NOT EXISTS(SELECT 1 FROM practice_trade_events e WHERE e.id=s.id) AND EXISTS(SELECT 1 FROM app_users WHERE id=? AND status='active') ORDER BY s.occurredAt,s.id LIMIT 100 ON CONFLICT(id) DO NOTHING`,
      )
      .bind(actor.id, now, ...sourceArgs(actor.id), actor.id),
  ]);
  // A separate durable phase lets interrupted processing resume from pending
  // events. The receipt IS the activity projection; it has no money side effect.
  await db.batch([
    db
      .prepare(
        `INSERT INTO practice_trade_receipts (event_id,handler,processed_at) SELECT e.id,'activity-v1',? FROM practice_trade_events e WHERE e.user_id=? AND NOT EXISTS(SELECT 1 FROM practice_trade_receipts r WHERE r.event_id=e.id) AND EXISTS(SELECT 1 FROM app_users WHERE id=? AND status='active') ORDER BY e.occurred_at,e.id LIMIT 50 ON CONFLICT(event_id) DO NOTHING`,
      )
      .bind(now, actor.id, actor.id),
  ]);
  return readTradeEvents(db, identity);
}

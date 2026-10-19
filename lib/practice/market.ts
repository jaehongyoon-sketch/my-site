import { z } from "zod";
const cents = z.number().int().min(1).max(99);
export const marketDataSchema = z.object({
  eventId: z.string(),
  checkedAt: z.string(),
  closed: z.boolean(),
  paused: z.boolean(),
  lastYesCents: cents.nullable(),
  previousYesCents: cents.nullable(),
  volume: z.number(),
  lastTradedAt: z.string().nullable(),
  bids: z.array(
    z.object({
      outcome: z.enum(["yes", "no"]),
      price: cents,
      quantity: z.number(),
    }),
  ),
  trades: z.array(
    z.object({
      id: z.string(),
      yesCents: cents,
      quantity: z.number(),
      at: z.string(),
    }),
  ),
});
export type MarketData = z.infer<typeof marketDataSchema>;
// A NO maker's execution must be complemented to express a YES price.
export const yesTradePrice =
  "CASE WHEN maker.outcome='yes' THEN m.maker_price ELSE 100-m.maker_price END";
export async function readMarket(
  db: D1Database,
  event: { id: string; revision: number; closesAt: string; status: string },
  clock = Date.now(),
): Promise<MarketData> {
  const now = new Date(clock).toISOString();
  const [history, totals, book, control] = await db.batch([
    db
      .prepare(
        `SELECT m.id,${yesTradePrice} yesCents,m.quantity,m.created_at at FROM practice_matches m JOIN practice_orders maker ON maker.id=m.maker_id WHERE m.event_id=? ORDER BY m.rowid DESC LIMIT 120`,
      )
      .bind(event.id),
    db
      .prepare(
        `SELECT COALESCE(SUM(quantity),0) volume FROM practice_matches WHERE event_id=?`,
      )
      .bind(event.id),
    db
      .prepare(
        `SELECT o.outcome,o.price_cents price,SUM(o.quantity-p.filled_quantity) quantity
      FROM practice_orders o JOIN practice_order_progress p ON p.order_id=o.id JOIN app_users u ON u.id=o.user_id
      WHERE o.event_id=? AND o.event_revision=? AND o.status='open' AND o.expires_at>? AND u.status='active'
      AND p.filled_quantity<o.quantity AND NOT EXISTS(SELECT 1 FROM trading_restrictions r WHERE r.user_id=u.id AND r.blocked=1)
      GROUP BY o.outcome,o.price_cents ORDER BY o.price_cents DESC`,
      )
      .bind(event.id, event.revision, now),
    db.prepare("SELECT paused FROM practice_control WHERE id='global'"),
  ]);
  const trades = history.results as MarketData["trades"];
  const closed = event.status !== "published" || event.closesAt <= now;
  return marketDataSchema.parse({
    eventId: event.id,
    checkedAt: now,
    closed,
    paused:
      (control.results[0] as { paused?: number } | undefined)?.paused === 1,
    lastYesCents: trades[0]?.yesCents ?? null,
    previousYesCents: trades[1]?.yesCents ?? null,
    volume: (totals.results[0] as { volume?: number } | undefined)?.volume ?? 0,
    lastTradedAt: trades[0]?.at ?? null,
    bids: closed ? [] : book.results,
    trades: trades.reverse(),
  });
}
export async function readLastPrices(db: D1Database, ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const unique = [...new Set(ids)];
  const rows = await db
    .prepare(
      `SELECT m.event_id eventId,${yesTradePrice} price FROM practice_matches m JOIN practice_orders maker ON maker.id=m.maker_id
    WHERE m.event_id IN (${unique.map(() => "?").join(",")}) AND m.rowid=(SELECT MAX(n.rowid) FROM practice_matches n WHERE n.event_id=m.event_id)`,
    )
    .bind(...unique)
    .all<{ eventId: string; price: number }>();
  return new Map(rows.results.map((r) => [r.eventId, r.price]));
}

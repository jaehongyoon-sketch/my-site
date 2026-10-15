import { assertPracticeEligible } from "../eligibility/service";
import { z } from "zod";
import { activeAccount } from "../accounts/access";
import type { Identity } from "../accounts/service";
import { orderIntentSchema } from "../orders/model";
import { costUnits, feeUnits } from "./money";
export class SellError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const fail = (code: string, message: string, status = 409): never => {
  throw new SellError(status, code, message);
};
const sellSchema = z
  .object({
    clientOrderId: z.string().uuid(),
    intent: orderIntentSchema.extend({ side: z.literal("sell") }).strict(),
  })
  .strict();
export type SellOrder = {
  id: string;
  eventId: string;
  eventTitle: string;
  outcome: string;
  quantity: number;
  priceCents: number;
  status: string;
  expiresAt: string;
  createdAt: string;
  releasedAt: string | null;
};
const columns =
  "id,event_id AS eventId,event_title AS eventTitle,outcome,quantity,price_cents AS priceCents,status,expires_at AS expiresAt,created_at AS createdAt,released_at AS releasedAt";
// No cash moves or fills are created: Day 14 is validation + share reservation only.
export async function expireSells(
  db: D1Database,
  userId: string,
  clock?: number,
) {
  const op = crypto.randomUUID(),
    now = new Date(clock ?? Date.now()).toISOString();
  await db.batch([
    db
      .prepare(
        `UPDATE practice_sell_orders SET status=CASE WHEN expires_at<=? THEN 'expired' ELSE 'voided' END,released_at=?,release_id=? WHERE user_id=? AND status='open' AND (expires_at<=? OR NOT EXISTS(SELECT 1 FROM own_events e WHERE e.id=event_id AND e.status='published' AND e.revision=event_revision))`,
      )
      .bind(now, now, op, userId, now),
    db
      .prepare(
        `INSERT INTO practice_share_entries SELECT id||':release',id,user_id,'release',-quantity,? FROM practice_sell_orders WHERE release_id=?`,
      )
      .bind(now, op),
  ]);
}
export function sellHistoryQuery(db: D1Database, userId: string, page: number) {
  return db
    .prepare(
      `SELECT ${columns} FROM practice_sell_orders WHERE user_id=? ORDER BY rowid DESC LIMIT 21 OFFSET ?`,
    )
    .bind(userId, page * 20);
}
export async function reserveSell(
  db: D1Database,
  identity: Identity,
  raw: unknown,
  clock?: number,
) {
  const parsed = sellSchema.safeParse(raw);
  if (!parsed.success)
    fail(
      "INVALID_SELL",
      "Enter a limit of 1–99 whole cents and 1–10,000 whole contracts.",
      400,
    );
  const { clientOrderId, intent } = parsed.data!,
    actor = await activeAccount(db, identity),
    canonical = JSON.stringify(intent);
  const existing = () =>
    db
      .prepare(
        `SELECT ${columns},intent_json FROM practice_sell_orders WHERE user_id=? AND client_id=?`,
      )
      .bind(actor.id, clientOrderId)
      .first<SellOrder & { intent_json: string }>();
  const receipt = (
    row: SellOrder & { intent_json: string },
    replayed: boolean,
  ) => {
    if (row.intent_json !== canonical)
      fail("KEY_CONFLICT", "This request was used for different sell terms.");
    const { intent_json, ...safe } = row;
    const gross = costUnits(row.priceCents, row.quantity),
      fee = feeUnits(row.priceCents, row.quantity);
    return {
      mode: "practice",
      executionEnabled: false,
      order: safe,
      replayed,
      estimate: { grossUnits: gross, feeUnits: fee, netUnits: gross - fee },
    };
  };
  await expireSells(db, actor.id, clock);
  const before = await existing();
  if (before) return receipt(before, true);
  await assertPracticeEligible(db, actor.id);
  const id = crypto.randomUUID(),
    now = new Date(clock ?? Date.now()).toISOString();
  // Holding and outstanding-reservation predicates run in the same atomic batch
  // as admission. Concurrent requests cannot reserve the same contracts twice.
  await db.batch([
    db
      .prepare(
        `INSERT INTO practice_sell_orders (id,user_id,event_id,client_id,intent_json,event_revision,event_title,outcome,quantity,price_cents,status,expires_at,created_at)
 SELECT ?,u.id,e.id,?,?,e.revision,e.title,?,?,?,'open',e.closes_at,? FROM app_users u JOIN own_events e ON e.id=? WHERE u.id=? AND u.status='active' AND NOT EXISTS(SELECT 1 FROM practice_control WHERE id='global' AND paused=1) AND NOT EXISTS(SELECT 1 FROM trading_restrictions r WHERE r.user_id=u.id AND r.blocked=1) AND e.status='published' AND e.revision=? AND e.closes_at>?
 AND COALESCE((SELECT SUM(m.quantity) FROM practice_match_entries x JOIN practice_matches m ON m.id=x.match_id JOIN practice_orders o ON o.id=x.order_id WHERE x.user_id=u.id AND o.event_id=e.id AND o.outcome=?),0)-COALESCE((SELECT SUM(s.quantity) FROM practice_sell_orders s WHERE s.user_id=u.id AND s.event_id=e.id AND s.outcome=? AND s.status='open'),0)>=?
 ON CONFLICT(user_id,client_id) DO NOTHING`,
      )
      .bind(
        id,
        clientOrderId,
        canonical,
        intent.outcome,
        intent.quantity,
        intent.limitPriceCents,
        now,
        intent.eventId,
        actor.id,
        intent.eventRevision,
        now,
        intent.outcome,
        intent.outcome,
        intent.quantity,
      ),
    db
      .prepare(
        `INSERT INTO practice_share_entries SELECT id||':reserve',id,user_id,'reserve',quantity,? FROM practice_sell_orders WHERE id=?`,
      )
      .bind(now, id),
  ]);
  const row = await existing();
  if (row) return receipt(row, row.id !== id);
  fail(
    "SELL_UNAVAILABLE",
    "Not enough unreserved contracts, or the account/event changed or closed. Refresh holdings before retrying.",
  );
}
export async function cancelSell(
  db: D1Database,
  identity: Identity,
  raw: unknown,
  clock?: number,
) {
  const parsed = z
    .object({ orderId: z.string().uuid() })
    .strict()
    .safeParse(raw);
  if (!parsed.success)
    fail("INVALID_CANCELLATION", "Invalid sell cancellation.", 400);
  const actor = await activeAccount(db, identity),
    id = parsed.data!.orderId;
  const get = () =>
    db
      .prepare(
        `SELECT ${columns} FROM practice_sell_orders WHERE id=? AND user_id=?`,
      )
      .bind(id, actor.id)
      .first<SellOrder>();
  if (!(await get()))
    fail("SELL_NOT_FOUND", "Sell reservation not found.", 404);
  await expireSells(db, actor.id, clock);
  const op = crypto.randomUUID(),
    now = new Date(clock ?? Date.now()).toISOString();
  await db.batch([
    db
      .prepare(
        `UPDATE practice_sell_orders SET status='cancelled',released_at=?,release_id=? WHERE id=? AND user_id=? AND status='open' AND EXISTS(SELECT 1 FROM app_users WHERE id=? AND status='active')`,
      )
      .bind(now, op, id, actor.id, actor.id),
    db
      .prepare(
        `INSERT INTO practice_share_entries SELECT id||':release',id,user_id,'release',-quantity,? FROM practice_sell_orders WHERE release_id=?`,
      )
      .bind(now, op),
  ]);
  await activeAccount(db, identity);
  return { mode: "practice", executionEnabled: false, order: await get() };
}

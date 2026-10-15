import { assertPracticeEligible } from "../eligibility/service";
import { expireSells, sellHistoryQuery, type SellOrder } from "./sells";
import {
  positionQueries,
  type PracticePosition,
  type PositionTotals,
} from "./positions";
import { z } from "zod";
import { activeAccount } from "../accounts/access";
import type { Identity } from "../accounts/service";
import { orderIntentSchema } from "../orders/model";
import { matchEvent } from "./matching";
import { reserveUnits, GRANT_UNITS } from "./money";
export class PracticeError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const fail = (code: string, message: string, status = 409): never => {
  throw new PracticeError(status, code, message);
};
export const submissionSchema = z
  .object({ clientOrderId: z.string().uuid(), intent: orderIntentSchema })
  .strict();
export type PracticeOrder = {
  id: string;
  event_id: string;
  event_title: string;
  outcome: string;
  price_cents: number;
  quantity: number;
  status: string;
  expires_at: string;
  created_at: string;
  filled_quantity: number;
  remaining_quantity: number;
  executedPrincipalCents: number;
  chargedFeeCents: number;
  heldCents: number;
  feePolicy: string;
  cancelledAt: string | null;
  cancelledQuantity: number;
  refundedCents: number;
};
const columns = `o.id,event_id,event_title,outcome,price_cents,quantity,CASE WHEN EXISTS(SELECT 1 FROM practice_cancellations c WHERE c.order_id=o.id) THEN 'cancelled' ELSE status END AS status,expires_at,created_at,filled_quantity,quantity-filled_quantity AS remaining_quantity,executed_principal_units/400.0 AS executedPrincipalCents,charged_fee_units/400.0 AS chargedFeeCents,held_units/400.0 AS heldCents,fee_policy AS feePolicy,(SELECT created_at FROM practice_cancellations c WHERE c.order_id=o.id) AS cancelledAt,COALESCE((SELECT cancelled_quantity FROM practice_cancellations c WHERE c.order_id=o.id),0) AS cancelledQuantity,COALESCE((SELECT refunded_units/400.0 FROM practice_cancellations c WHERE c.order_id=o.id),0) AS refundedCents`;
export async function startPractice(db: D1Database, identity: Identity) {
  const actor = await activeAccount(db, identity),
    id = crypto.randomUUID(),
    now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        "INSERT INTO practice_wallets SELECT id,100000,0,?,? FROM app_users WHERE id=? AND status='active' ON CONFLICT(user_id) DO NOTHING",
      )
      .bind(id, now, actor.id),
    db
      .prepare(
        "INSERT INTO practice_cash SELECT user_id,?,0,0 FROM practice_wallets WHERE grant_id=? ON CONFLICT(user_id) DO NOTHING",
      )
      .bind(GRANT_UNITS, id),
    db
      .prepare(
        "INSERT INTO practice_cash_entries SELECT ?,user_id,NULL,'grant',?,0,? FROM practice_wallets WHERE grant_id=?",
      )
      .bind(id, GRANT_UNITS, now, id),
  ]);
  return practiceAccount(db, identity);
}
async function release(db: D1Database, user: string, now: string) {
  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `UPDATE practice_orders SET status=CASE WHEN expires_at<=? THEN 'expired' ELSE 'voided' END,release_id=? WHERE user_id=? AND status='open' AND EXISTS(SELECT 1 FROM practice_order_progress p WHERE p.order_id=practice_orders.id AND p.filled_quantity<practice_orders.quantity) AND (expires_at<=? OR NOT EXISTS(SELECT 1 FROM own_events e WHERE e.id=event_id AND e.status='published' AND e.revision=event_revision))`,
      )
      .bind(now, id, user, now),
    db
      .prepare(
        `UPDATE practice_cash SET available_units=available_units+COALESCE((SELECT SUM(held_units) FROM practice_orders o JOIN practice_order_progress p ON p.order_id=o.id WHERE release_id=?),0),reserved_units=reserved_units-COALESCE((SELECT SUM(held_units) FROM practice_orders o JOIN practice_order_progress p ON p.order_id=o.id WHERE release_id=?),0) WHERE user_id=?`,
      )
      .bind(id, id, user),
    db
      .prepare(
        `INSERT INTO practice_cash_entries SELECT o.id||':release',user_id,o.id,'release',held_units,-held_units,? FROM practice_orders o JOIN practice_order_progress p ON p.order_id=o.id WHERE release_id=?`,
      )
      .bind(now, id),
    db
      .prepare(
        "UPDATE practice_order_progress SET held_units=0,revision=revision+1 WHERE order_id IN (SELECT id FROM practice_orders WHERE release_id=?)",
      )
      .bind(id),
  ]);
}
export async function practiceAccount(
  db: D1Database,
  identity: Identity,
  page = 0,
  clock?: number,
  positionPage = 0,
  sellPage = 0,
) {
  if (!Number.isInteger(sellPage) || sellPage < 0 || sellPage > 10000)
    fail("INVALID_PAGE", "Invalid sell page.", 400);
  if (
    !Number.isInteger(positionPage) ||
    positionPage < 0 ||
    positionPage > 10000
  )
    fail("INVALID_PAGE", "Invalid holdings page.", 400);
  if (!Number.isInteger(page) || page < 0 || page > 10000)
    fail("INVALID_PAGE", "Invalid page.", 400);
  const actor = await activeAccount(db, identity);
  await release(db, actor.id, new Date(clock ?? Date.now()).toISOString());
  await expireSells(db, actor.id, clock);
  const results = await db.batch([
    db
      .prepare(
        "SELECT available_units/400.0 AS availableCents,reserved_units/400.0 AS reservedCents,spent_units/400.0 AS spentCents FROM practice_cash WHERE user_id=?",
      )
      .bind(actor.id),
    db
      .prepare(
        `SELECT ${columns} FROM practice_orders o JOIN practice_order_progress p ON p.order_id=o.id WHERE user_id=? ORDER BY o.rowid DESC LIMIT 21 OFFSET ?`,
      )
      .bind(actor.id, page * 20),
    db
      .prepare(
        `SELECT x.match_id AS id,x.order_id AS orderId,o.event_title AS eventTitle,o.outcome,m.quantity,x.principal_units/400.0 AS principalCents,x.fee_units/400.0 AS feeCents,x.released_units/400.0 AS releasedCents,m.created_at AS createdAt FROM practice_match_entries x JOIN practice_matches m ON m.id=x.match_id JOIN practice_orders o ON o.id=x.order_id WHERE x.user_id=? ORDER BY m.rowid DESC LIMIT 50`,
      )
      .bind(actor.id),
    ...positionQueries(db, actor.id, positionPage),
    sellHistoryQuery(db, actor.id, sellPage),
  ]);
  const wallet = (results[0].results[0] ?? null) as {
    availableCents: number;
    reservedCents: number;
    spentCents: number;
  } | null;
  const orders = results[1].results as PracticeOrder[];
  const fills = results[2].results as {
    id: string;
    orderId: string;
    eventTitle: string;
    outcome: string;
    quantity: number;
    principalCents: number;
    feeCents: number;
    releasedCents: number;
    createdAt: string;
  }[];
  const positions = (results[3].results as PracticePosition[]).map((p) => ({
    ...p,
    availableQuantity: p.quantity - p.reservedQuantity,
  }));
  const positionTotals = results[4].results[0] as PositionTotals;
  const sellOrders = results[5].results as SellOrder[];
  return {
    sellOrders: sellOrders.slice(0, 20),
    sellPage,
    sellsHasMore: sellOrders.length > 20,
    positions: positions.slice(0, 20),
    positionTotals,
    positionPage,
    positionsHasMore: positions.length > 20,
    positionsReconciled:
      positionTotals.costBasisUnits === positionTotals.spentUnits,
    mode: "practice" as const,
    accountId: actor.id,
    wallet,
    orders: orders.slice(0, 20),
    fills,
    page,
    hasMore: orders.length > 20,
  };
}
export async function placePractice(
  db: D1Database,
  identity: Identity,
  raw: unknown,
  clock?: number,
) {
  const parsed = submissionSchema.safeParse(raw);
  if (!parsed.success) fail("INVALID_ORDER", "Invalid practice order.", 400);
  const { clientOrderId, intent } = parsed.data!,
    actor = await activeAccount(db, identity),
    canonical = JSON.stringify(intent);
  const existing = () =>
    db
      .prepare(
        `SELECT ${columns},intent_json FROM practice_orders o JOIN practice_order_progress p ON p.order_id=o.id WHERE user_id=? AND client_id=?`,
      )
      .bind(actor.id, clientOrderId)
      .first<PracticeOrder & { intent_json: string }>();
  const replay = (order: PracticeOrder & { intent_json: string }) => {
    if (order.intent_json !== canonical)
      fail(
        "KEY_CONFLICT",
        "This request was already used for different terms.",
      );
    const { intent_json, ...safe } = order;
    return { mode: "practice", order: safe, replayed: true };
  };
  await release(db, actor.id, new Date(clock ?? Date.now()).toISOString());
  const before = await existing();
  if (before) {
    replay(before);
    await matchEvent(db, intent.eventId, clock);
    return replay((await existing())!);
  }
  await assertPracticeEligible(db, actor.id);
  const now = new Date(clock ?? Date.now()).toISOString(),
    id = crypto.randomUUID(),
    reserve = reserveUnits(intent.limitPriceCents, intent.quantity);
  // Compatibility quote columns are approximate cents; exact units are authoritative.
  const principal = intent.limitPriceCents * intent.quantity,
    legacyFee = Math.floor((principal + 200) / 400);
  await db.batch([
    db
      .prepare(
        `INSERT INTO practice_orders (id,user_id,event_id,client_id,intent_json,event_revision,event_title,outcome,price_cents,quantity,principal_cents,fee_cents,total_cents,status,expires_at,created_at)
 SELECT ?,w.user_id,e.id,?,?,e.revision,e.title,?,?,?,?,?,?,'open',e.closes_at,? FROM practice_cash w JOIN app_users u ON u.id=w.user_id JOIN own_events e ON e.id=? WHERE w.user_id=? AND u.status='active' AND NOT EXISTS(SELECT 1 FROM practice_control WHERE id='global' AND paused=1) AND NOT EXISTS(SELECT 1 FROM trading_restrictions r WHERE r.user_id=u.id AND r.blocked=1) AND w.available_units>=? AND e.status='published' AND e.revision=? AND e.closes_at>? ON CONFLICT(user_id,client_id) DO NOTHING`,
      )
      .bind(
        id,
        clientOrderId,
        canonical,
        intent.outcome,
        intent.limitPriceCents,
        intent.quantity,
        principal,
        legacyFee,
        principal + legacyFee,
        now,
        intent.eventId,
        actor.id,
        reserve,
        intent.eventRevision,
        now,
      ),
    db
      .prepare(
        "UPDATE practice_cash SET available_units=available_units-?,reserved_units=reserved_units+? WHERE user_id=? AND EXISTS(SELECT 1 FROM practice_orders WHERE id=?)",
      )
      .bind(reserve, reserve, actor.id, id),
    db
      .prepare(
        "INSERT INTO practice_cash_entries SELECT id||':reserve',user_id,id,'reserve',-?,?,? FROM practice_orders WHERE id=?",
      )
      .bind(reserve, reserve, now, id),
    db
      .prepare(
        "INSERT INTO practice_order_progress (order_id,fee_policy,filled_quantity,executed_principal_units,charged_fee_units,held_units,revision) SELECT id,'per_contract',0,0,0,?,0 FROM practice_orders WHERE id=?",
      )
      .bind(reserve, id),
  ]);
  let order = await existing();
  if (order) {
    replay(order);
    await matchEvent(db, intent.eventId, clock);
    order = (await existing())!;
    return { ...replay(order), replayed: order.id !== id };
  }
  const wallet = await db
    .prepare("SELECT available_units FROM practice_cash WHERE user_id=?")
    .bind(actor.id)
    .first<{ available_units: number }>();
  if (!wallet) fail("NOT_STARTED", "Start your practice balance first.");
  if (wallet!.available_units < reserve)
    fail(
      "INSUFFICIENT_FUNDS",
      "Not enough available practice funds. No order was placed.",
    );
  fail(
    "EVENT_UNAVAILABLE",
    "Account or event changed, closed, or is unavailable. Reload before a new order.",
  );
}
export async function continueMatching(
  db: D1Database,
  identity: Identity,
  raw: unknown,
) {
  const parsed = z
    .object({ eventId: z.string().uuid() })
    .strict()
    .safeParse(raw);
  if (!parsed.success) fail("INVALID_EVENT", "Invalid event.", 400);
  const actor = await activeAccount(db, identity),
    eventId = parsed.data!.eventId;
  const owned = await db
    .prepare(
      "SELECT id FROM practice_orders WHERE user_id=? AND event_id=? LIMIT 1",
    )
    .bind(actor.id, eventId)
    .first();
  if (!owned)
    fail("ORDER_REQUIRED", "You need a practice order for this event.", 403);
  await matchEvent(db, eventId);
  return practiceAccount(db, identity);
}

/** Natural idempotency key is the owned order ID. Every retry returns its durable receipt. */
export async function cancelPractice(
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
    fail("INVALID_CANCELLATION", "Invalid cancellation request.", 400);
  const actor = await activeAccount(db, identity),
    orderId = parsed.data!.orderId;
  const owned = await db
    .prepare("SELECT id FROM practice_orders WHERE id=? AND user_id=?")
    .bind(orderId, actor.id)
    .first();
  if (!owned) fail("ORDER_NOT_FOUND", "Order not found.", 404);
  await release(db, actor.id, new Date(clock ?? Date.now()).toISOString());
  const operation = crypto.randomUUID(),
    now = new Date(clock ?? Date.now()).toISOString();
  // Serialize with matching. Only the remaining reservation observed INSIDE this
  // transaction is returned. No stale client amount or quantity participates.
  await db.batch([
    db
      .prepare(
        `INSERT INTO practice_cancellations SELECT o.id,o.user_id,?,o.quantity-p.filled_quantity,p.held_units,? FROM practice_orders o JOIN practice_order_progress p ON p.order_id=o.id JOIN app_users u ON u.id=o.user_id WHERE o.id=? AND o.user_id=? AND u.status='active' AND o.status='open' AND p.filled_quantity<o.quantity ON CONFLICT(order_id) DO NOTHING`,
      )
      .bind(operation, now, orderId, actor.id),
    db
      .prepare(
        `UPDATE practice_orders SET status='voided',release_id=? WHERE id=? AND EXISTS(SELECT 1 FROM practice_cancellations WHERE operation_id=?)`,
      )
      .bind(operation, orderId, operation),
    db
      .prepare(
        `UPDATE practice_cash SET available_units=available_units+COALESCE((SELECT refunded_units FROM practice_cancellations WHERE operation_id=?),0),reserved_units=reserved_units-COALESCE((SELECT refunded_units FROM practice_cancellations WHERE operation_id=?),0) WHERE user_id=?`,
      )
      .bind(operation, operation, actor.id),
    db
      .prepare(
        `INSERT INTO practice_cash_entries SELECT order_id||':release',user_id,order_id,'release',refunded_units,-refunded_units,created_at FROM practice_cancellations WHERE operation_id=?`,
      )
      .bind(operation),
    db
      .prepare(
        `UPDATE practice_order_progress SET held_units=0,revision=revision+1 WHERE order_id=? AND EXISTS(SELECT 1 FROM practice_cancellations WHERE operation_id=?)`,
      )
      .bind(orderId, operation),
  ]);
  await activeAccount(db, identity);
  const receipt = await db
    .prepare(
      "SELECT cancelled_quantity AS quantity,refunded_units/400.0 AS refundedCents,created_at AS cancelledAt FROM practice_cancellations WHERE order_id=? AND user_id=?",
    )
    .bind(orderId, actor.id)
    .first<{ quantity: number; refundedCents: number; cancelledAt: string }>();
  const state = await db
    .prepare(
      "SELECT o.status,p.filled_quantity AS filled,o.quantity FROM practice_orders o JOIN practice_order_progress p ON p.order_id=o.id WHERE o.id=? AND o.user_id=?",
    )
    .bind(orderId, actor.id)
    .first<{ status: string; filled: number; quantity: number }>();
  return {
    mode: "practice",
    orderId,
    outcome: receipt
      ? "cancelled"
      : state?.filled === state?.quantity
        ? "already_filled"
        : "already_closed",
    receipt,
  };
}

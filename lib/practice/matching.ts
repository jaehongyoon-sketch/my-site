/** Binary minting: an older YES buy and a newer NO buy (or vice versa)
 * together fund exactly 100 cents of virtual collateral per matched pair.
 * Opposite orders are ranked by price, then acceptance rowid (not UUID/time).
 */
import { costUnits, feeUnits, reserveUnits } from "./money";
export type Progress = {
  quantity: number;
  price: number;
  filled: number;
  principal: number;
  fee: number;
  held: number;
  revision: number;
  policy?: string;
};
export function fillAmounts(order: Progress, price: number, quantity: number) {
  if (
    !Number.isInteger(price) ||
    price < 1 ||
    price > order.price ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > order.quantity - order.filled
  )
    throw Error("Invalid fill");
  const principal = costUnits(price, quantity);
  const legacyFee = (units: number) =>
    Math.floor((units / 400 + 200) / 400) * 400;
  const fee =
    order.policy === "legacy_order"
      ? legacyFee(order.principal + principal) - order.fee
      : feeUnits(price, quantity);
  const filled = order.filled + quantity;
  const remainingPrincipal = costUnits(order.price, order.quantity - filled);
  const held =
    order.policy === "legacy_order"
      ? remainingPrincipal +
        legacyFee(order.principal + principal + remainingPrincipal) -
        (order.fee + fee)
      : reserveUnits(order.price, order.quantity - filled);
  const debit = order.held - held,
    released = debit - principal - fee;
  if (released < 0) throw Error("Reservation invariant");
  return {
    principal,
    fee,
    filled,
    held,
    debit,
    released,
    executed: order.principal + principal,
    charged: order.fee + fee,
  };
}
type Candidate = {
  maker: string;
  taker: string;
  eventId: string;
  makerUser: string;
  takerUser: string;
  makerQty: number;
  takerQty: number;
  makerLimit: number;
  takerLimit: number;
  makerFilled: number;
  takerFilled: number;
  makerPrincipal: number;
  takerPrincipal: number;
  makerFee: number;
  takerFee: number;
  makerHeld: number;
  takerHeld: number;
  makerRevision: number;
  takerRevision: number;
  makerPolicy: string;
  takerPolicy: string;
};
const candidateSql = `SELECT mp.fee_policy makerPolicy,tp.fee_policy takerPolicy,m.id maker,t.id taker,m.event_id eventId,m.user_id makerUser,t.user_id takerUser,
 m.quantity makerQty,t.quantity takerQty,m.price_cents makerLimit,t.price_cents takerLimit,
 mp.filled_quantity makerFilled,tp.filled_quantity takerFilled,mp.executed_principal_units makerPrincipal,tp.executed_principal_units takerPrincipal,
 mp.charged_fee_units makerFee,tp.charged_fee_units takerFee,mp.held_units makerHeld,tp.held_units takerHeld,mp.revision makerRevision,tp.revision takerRevision
 FROM practice_orders t JOIN practice_order_progress tp ON tp.order_id=t.id
 JOIN practice_orders m ON m.event_id=t.event_id AND m.rowid<t.rowid
 JOIN practice_order_progress mp ON mp.order_id=m.id
 JOIN own_events e ON e.id=t.event_id
 JOIN app_users mu ON mu.id=m.user_id JOIN app_users tu ON tu.id=t.user_id
 WHERE e.id=? AND e.status='published' AND e.closes_at>? AND m.event_revision=e.revision AND t.event_revision=e.revision
 AND mu.status='active' AND tu.status='active' AND NOT EXISTS(SELECT 1 FROM practice_control WHERE id='global' AND paused=1) AND NOT EXISTS(SELECT 1 FROM trading_restrictions r WHERE r.user_id IN (mu.id,tu.id) AND r.blocked=1) AND m.user_id<>t.user_id AND m.outcome<>t.outcome
 AND m.status='open' AND t.status='open' AND m.expires_at>? AND t.expires_at>?
 AND mp.filled_quantity<m.quantity AND tp.filled_quantity<t.quantity AND m.price_cents+t.price_cents>=100
 ORDER BY t.rowid,m.price_cents DESC,m.rowid LIMIT 1`;
export async function matchEvent(
  db: D1Database,
  eventId: string,
  clock?: number,
) {
  let completed = 0;
  // Bounded work; subsequent submissions or explicit continuation finish deep books.
  for (let attempt = 0; attempt < 4; attempt++) {
    const stamp = () => new Date(clock ?? Date.now()).toISOString();
    let now = stamp();
    const c = await db
      .prepare(candidateSql)
      .bind(eventId, now, now, now)
      .first<Candidate>();
    if (!c) break;
    const quantity = Math.min(
      c.makerQty - c.makerFilled,
      c.takerQty - c.takerFilled,
    );
    const maker = fillAmounts(
      {
        quantity: c.makerQty,
        price: c.makerLimit,
        filled: c.makerFilled,
        principal: c.makerPrincipal,
        fee: c.makerFee,
        held: c.makerHeld,
        revision: c.makerRevision,
        policy: c.makerPolicy,
      },
      c.makerLimit,
      quantity,
    );
    const taker = fillAmounts(
      {
        quantity: c.takerQty,
        price: c.takerLimit,
        filled: c.takerFilled,
        principal: c.takerPrincipal,
        fee: c.takerFee,
        held: c.takerHeld,
        revision: c.takerRevision,
        policy: c.takerPolicy,
      },
      100 - c.makerLimit,
      quantity,
    );
    const id = crypto.randomUUID();
    now = stamp();
    const writes = [
      db
        .prepare(
          `INSERT INTO practice_matches SELECT ?,?,maker,taker,?,?,? FROM (${candidateSql}) chosen WHERE maker=? AND taker=? AND makerRevision=? AND takerRevision=?`,
        )
        .bind(
          id,
          eventId,
          quantity,
          c.makerLimit,
          now,
          eventId,
          now,
          now,
          now,
          c.maker,
          c.taker,
          c.makerRevision,
          c.takerRevision,
        ),
    ];
    for (const [order, user, a] of [
      [c.maker, c.makerUser, maker],
      [c.taker, c.takerUser, taker],
    ] as const) {
      writes.push(
        db
          .prepare(
            `INSERT INTO practice_match_entries SELECT ?,?,?, ?,?,?,? WHERE EXISTS(SELECT 1 FROM practice_matches WHERE id=?)`,
          )
          .bind(id, order, user, a.principal, a.fee, a.released, a.debit, id),
      );
      writes.push(
        db
          .prepare(
            `UPDATE practice_order_progress SET filled_quantity=?,executed_principal_units=?,charged_fee_units=?,held_units=?,revision=revision+1 WHERE order_id=? AND EXISTS(SELECT 1 FROM practice_matches WHERE id=?)`,
          )
          .bind(a.filled, a.executed, a.charged, a.held, order, id),
      );
      writes.push(
        db
          .prepare(
            `UPDATE practice_cash SET available_units=available_units+?,reserved_units=reserved_units-?,spent_units=spent_units+? WHERE user_id=? AND EXISTS(SELECT 1 FROM practice_matches WHERE id=?)`,
          )
          .bind(a.released, a.debit, a.principal + a.fee, user, id),
      );
    }
    const result = await db.batch(writes);
    if (result[0].meta.changes) completed++;
  }
  return { completed };
}

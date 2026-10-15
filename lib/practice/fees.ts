import { activeAccount, AccessError } from "../accounts/access";
import type { Identity } from "../accounts/service";
export type FeeRow = {
  id: string;
  eventId: string;
  title: string;
  outcome: string;
  status: string;
  createdAt: string;
  policy: string;
  quantity: number;
  chargedUnits: number;
  principalUnits: number;
  heldUnits: number;
  releasedUnits: number;
};
const query = `WITH fills AS (SELECT order_id,SUM(fee_units) charged,SUM(principal_units) principal,SUM(released_units) released FROM practice_match_entries WHERE user_id=? GROUP BY order_id), releases AS (SELECT order_id,SUM(available_delta_units) released FROM practice_cash_entries WHERE user_id=? AND kind='release' GROUP BY order_id), report AS (
 SELECT o.id,o.event_id eventId,o.event_title title,o.outcome,o.status,o.created_at createdAt,p.fee_policy policy,p.filled_quantity quantity,COALESCE(f.charged,0) chargedUnits,COALESCE(f.principal,0) principalUnits,p.held_units heldUnits,COALESCE(f.released,0)+COALESCE(r.released,0) releasedUnits
 FROM practice_orders o JOIN practice_order_progress p ON p.order_id=o.id LEFT JOIN fills f ON f.order_id=o.id LEFT JOIN releases r ON r.order_id=o.id WHERE o.user_id=? ) `;
export async function feeReport(db: D1Database, identity: Identity, page = 0) {
  if (!Number.isInteger(page) || page < 0 || page > 10000)
    throw new AccessError(400, "Invalid page.");
  const actor = await activeAccount(db, identity);
  const data = await db.batch([
    db
      .prepare(
        query +
          "SELECT * FROM report ORDER BY createdAt DESC,id DESC LIMIT 26 OFFSET ?",
      )
      .bind(actor.id, actor.id, actor.id, page * 25),
    db
      .prepare(
        query +
          "SELECT COUNT(*) orders,COALESCE(SUM(chargedUnits),0) chargedUnits,COALESCE(SUM(principalUnits),0) principalUnits,COALESCE(SUM(heldUnits),0) heldUnits,COALESCE(SUM(releasedUnits),0) releasedUnits FROM report",
      )
      .bind(actor.id, actor.id, actor.id),
  ]);
  const rows = data[0].results as FeeRow[];
  return {
    mode: "practice" as const,
    readOnly: true,
    asOf: new Date().toISOString(),
    page,
    hasMore: rows.length > 25,
    entries: rows.slice(0, 25),
    totals: data[1].results[0] as {
      orders: number;
      chargedUnits: number;
      principalUnits: number;
      heldUnits: number;
      releasedUnits: number;
    },
    refundedFeeUnits: 0,
    realRevenueUnits: 0,
  };
}

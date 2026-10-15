import { activeAccount } from "../accounts/access";
import type { Identity } from "../accounts/service";
export const checkNames = {
  cash_available: "Available funds vs cash journal",
  cash_reserved: "Reserved funds vs cash journal",
  cash_spent: "Spent funds vs fill entries",
  grant: "One-time practice grant",
  reserved_orders: "Cash reservations vs order reservations",
  order_quantity: "Order quantities vs matched contracts",
  order_principal: "Order cost vs matched prices",
  order_fee: "Order fees vs fee policy",
  order_hold: "Unfilled order reservations",
  fill_entries: "Fill receipt completeness and ownership",
  fill_principal: "Fill receipt cost vs matched prices",
  fill_fees: "Fill receipt fees vs fee policy",
  pair: "YES/NO pair funding and participants",
  share_journal: "Sell reservations vs share journal",
  share_entries: "Share reservation/release receipts",
  holdings: "Sell reservations within matched holdings",
} as const;
type Code = keyof typeof checkNames;
export type Difference = {
  code: Code;
  reference: string;
  expected: number;
  actual: number;
  unit: "units" | "contracts" | "count" | "valid";
};
// Scope once, then compare independent durable records in a single D1 snapshot.
// Separate comparison queries stay below Workers SQLite compound limits.
// No latest-N history is used to compute totals. No writes, repairs or releases.
const base = `WITH me AS (SELECT ? AS id),
 owned AS (SELECT o.*,p.fee_policy,p.filled_quantity,p.executed_principal_units,p.charged_fee_units,p.held_units FROM practice_orders o LEFT JOIN practice_order_progress p ON p.order_id=o.id WHERE o.user_id=(SELECT id FROM me)),
 facts AS (SELECT o.id,o.event_id,o.outcome,o.quantity,o.price_cents,o.status,o.fee_policy,o.filled_quantity,o.executed_principal_units,o.charged_fee_units,o.held_units,
 COALESCE(SUM(m.quantity),0) AS qty,COALESCE(SUM(m.quantity*(CASE WHEN m.maker_id=o.id THEN m.maker_price ELSE 100-m.maker_price END)*400),0) AS principal,
 COALESCE(SUM(x.principal_units),0) AS entryPrincipal,COALESCE(SUM(x.fee_units),0) AS entryFees,COALESCE(SUM(CASE WHEN m.id IS NOT NULL AND (x.match_id IS NULL OR x.user_id<>(SELECT id FROM me)) THEN 1 ELSE 0 END),0) AS missing
 FROM owned o LEFT JOIN practice_matches m ON m.maker_id=o.id OR m.taker_id=o.id LEFT JOIN practice_match_entries x ON x.match_id=m.id AND x.order_id=o.id GROUP BY o.id),
 calculated AS (SELECT *,CASE WHEN fee_policy='legacy_order' THEN CAST((principal+80000)/160000 AS INTEGER)*400 ELSE principal/400 END AS fee FROM facts),
 orders AS (SELECT *,CASE WHEN status='open' THEN (quantity-qty)*price_cents*400+CASE WHEN fee_policy='legacy_order' THEN CAST((principal+(quantity-qty)*price_cents*400+80000)/160000 AS INTEGER)*400-fee ELSE (quantity-qty)*price_cents END ELSE 0 END AS expectedHold FROM calculated),
 cash AS (SELECT * FROM practice_cash WHERE user_id=(SELECT id FROM me)),
 journal AS (SELECT COALESCE(SUM(available_delta_units),0) AS a,COALESCE(SUM(reserved_delta_units),0) AS r,COALESCE(SUM(CASE WHEN kind='grant' THEN available_delta_units ELSE 0 END),0) AS grants,SUM(kind='grant') AS grantCount FROM practice_cash_entries WHERE user_id=(SELECT id FROM me)),
 entries AS (SELECT COALESCE(SUM(released_units),0) AS released,COALESCE(SUM(reserved_debit_units),0) AS debit,COALESCE(SUM(principal_units+fee_units),0) AS spent FROM practice_match_entries WHERE user_id=(SELECT id FROM me)),
 sales AS (SELECT s.*,COALESCE(SUM(x.reserved_delta),0) AS net,COALESCE(SUM(x.kind='reserve'),0) AS reserves,COALESCE(SUM(x.kind='release'),0) AS releases,COALESCE(SUM(x.user_id<>s.user_id),0) AS wrongUser FROM practice_sell_orders s LEFT JOIN practice_share_entries x ON x.sell_id=s.id WHERE s.user_id=(SELECT id FROM me) GROUP BY s.id),
 pairs AS (SELECT DISTINCT m.* FROM practice_matches m JOIN owned o ON o.id=m.maker_id OR o.id=m.taker_id) `;
const comparisons = [
  `SELECT 'cash_available' code,'account' reference,j.a+x.released expected,COALESCE(c.available_units,-1) actual,'units' unit FROM journal j CROSS JOIN entries x LEFT JOIN cash c ON 1=1 WHERE EXISTS(SELECT 1 FROM practice_wallets WHERE user_id=(SELECT id FROM me))`,
  `SELECT 'cash_reserved','account',j.r-x.debit,COALESCE(c.reserved_units,-1),'units' FROM journal j CROSS JOIN entries x LEFT JOIN cash c ON 1=1 WHERE EXISTS(SELECT 1 FROM practice_wallets WHERE user_id=(SELECT id FROM me))`,
  `SELECT 'cash_spent','account',x.spent,COALESCE(c.spent_units,-1),'units' FROM entries x LEFT JOIN cash c ON 1=1 WHERE EXISTS(SELECT 1 FROM practice_wallets WHERE user_id=(SELECT id FROM me))`,
  `SELECT 'grant','amount',40000000,grants,'units' FROM journal WHERE EXISTS(SELECT 1 FROM practice_wallets WHERE user_id=(SELECT id FROM me))`,
  `SELECT 'grant','count',1,COALESCE(grantCount,0),'count' FROM journal WHERE EXISTS(SELECT 1 FROM practice_wallets WHERE user_id=(SELECT id FROM me))`,
  `SELECT 'reserved_orders','account',COALESCE((SELECT SUM(held_units) FROM owned),0),reserved_units,'units' FROM cash`,
  `SELECT 'order_quantity',id,qty,COALESCE(filled_quantity,-1),'contracts' FROM orders`,
  `SELECT 'order_quantity',id||':within-order',1,CASE WHEN qty<=quantity THEN 1 ELSE 0 END,'valid' FROM orders`,
  `SELECT 'order_principal',id,principal,COALESCE(executed_principal_units,-1),'units' FROM orders`,
  `SELECT 'order_fee',id,fee,COALESCE(charged_fee_units,-1),'units' FROM orders`,
  `SELECT 'order_hold',id,expectedHold,COALESCE(held_units,-1),'units' FROM orders`,
  `SELECT 'fill_entries',id,0,missing,'count' FROM orders`,
  `SELECT 'fill_principal',id,principal,entryPrincipal,'units' FROM orders`,
  `SELECT 'fill_fees',id,fee,entryFees,'units' FROM orders`,
  `SELECT 'pair',p.id,1,CASE WHEN (SELECT COUNT(*) FROM practice_match_entries WHERE match_id=p.id)=2 AND (SELECT SUM(principal_units) FROM practice_match_entries WHERE match_id=p.id)=p.quantity*40000 AND EXISTS(SELECT 1 FROM practice_orders a JOIN practice_orders b ON a.id=p.maker_id AND b.id=p.taker_id WHERE a.user_id<>b.user_id AND a.outcome<>b.outcome AND a.event_id=p.event_id AND b.event_id=p.event_id AND (SELECT COUNT(*) FROM practice_match_entries x WHERE x.match_id=p.id AND ((x.order_id=a.id AND x.user_id=a.user_id) OR (x.order_id=b.id AND x.user_id=b.user_id)))=2) THEN 1 ELSE 0 END,'valid' FROM pairs p`,
  `SELECT 'share_journal',id,CASE WHEN status='open' THEN quantity ELSE 0 END,net,'contracts' FROM sales`,
  `SELECT 'share_entries',id||':reserve',1,reserves,'count' FROM sales`,
  `SELECT 'share_entries',id||':release',CASE WHEN status='open' THEN 0 ELSE 1 END,releases,'count' FROM sales`,
  `SELECT 'share_entries',id||':owner',0,wrongUser,'count' FROM sales`,
  `SELECT 'holdings',s.event_id||':'||s.outcome,1,CASE WHEN SUM(s.quantity)<=COALESCE((SELECT SUM(o.qty) FROM orders o WHERE o.event_id=s.event_id AND o.outcome=s.outcome),0) THEN 1 ELSE 0 END,'valid' FROM sales s WHERE s.status='open' GROUP BY s.event_id,s.outcome`,
];

export async function reconcilePractice(db: D1Database, identity: Identity) {
  const actor = await activeAccount(db, identity);
  const result = await db.batch([
    ...comparisons.flatMap((query) => [
      db
        .prepare(
          base +
            `, comparison(code,reference,expected,actual,unit) AS (${query}) SELECT code,COUNT(*) AS checked,COALESCE(SUM(expected<>actual),0) AS failed FROM comparison`,
        )
        .bind(actor.id),
      db
        .prepare(
          base +
            `, comparison(code,reference,expected,actual,unit) AS (${query}) SELECT * FROM comparison WHERE expected<>actual ORDER BY reference LIMIT 51`,
        )
        .bind(actor.id),
    ]),
    db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM practice_wallets WHERE user_id=?) AS started,(SELECT COUNT(*) FROM practice_orders WHERE user_id=?) AS orders,(SELECT COUNT(*) FROM practice_match_entries WHERE user_id=?) AS fillEntries,(SELECT COUNT(*) FROM practice_sell_orders WHERE user_id=?) AS sellReservations`,
      )
      .bind(actor.id, actor.id, actor.id, actor.id),
  ]);
  const rows = result
    .slice(0, -1)
    .filter((_, i) => i % 2 === 0)
    .flatMap((r) => r.results) as {
    code: Code | null;
    checked: number;
    failed: number;
  }[];
  const differences = (
    result
      .slice(0, -1)
      .filter((_, i) => i % 2 === 1)
      .flatMap((r) => r.results) as Difference[]
  ).sort(
    (a, b) =>
      a.code.localeCompare(b.code) || a.reference.localeCompare(b.reference),
  );
  const scope = result[result.length - 1].results[0] as {
    started: number;
    orders: number;
    fillEntries: number;
    sellReservations: number;
  };
  const checks = Object.entries(checkNames).map(([code, label]) => {
    const matching = rows.filter((r) => r.code === code),
      checked = matching.reduce((n, r) => n + r.checked, 0),
      failed = matching.reduce((n, r) => n + r.failed, 0);
    return {
      code,
      label,
      checked,
      failed,
      status: !checked ? "not_applicable" : failed ? "mismatch" : "passed",
    };
  });
  const failureCount = checks.reduce((n, c) => n + c.failed, 0);
  return {
    mode: "practice" as const,
    checkedAt: new Date().toISOString(),
    status: failureCount
      ? "mismatch"
      : scope.started
        ? "passed"
        : "not_started",
    failureCount,
    scope,
    checks,
    differences: differences.slice(0, 50),
    detailsTruncated: failureCount > 50,
    readOnly: true,
  };
}

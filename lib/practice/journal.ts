import { z } from "zod";
import { activeAccount, AccessError } from "../accounts/access";
import type { Identity } from "../accounts/service";
const querySchema = z
  .object({
    page: z.number().int().min(0).max(10000).default(0),
    kind: z.enum(["all", "grant", "reserve", "fill", "release"]).default("all"),
  })
  .strict();
export type CashJournalEntry = {
  id: string;
  kind: "grant" | "reserve" | "fill" | "release";
  orderId: string | null;
  eventId: string | null;
  eventTitle: string | null;
  outcome: string | null;
  quantity: number | null;
  availableUnits: number;
  reservedUnits: number;
  spentUnits: number;
  principalUnits: number;
  feeUnits: number;
  createdAt: string;
  reason: string | null;
};
// Each source is already a committed accounting fact. Never also include the
// legacy practice_ledger: migration 0006 copied it into practice_cash_entries.
const journalSQL = `WITH journal AS (
 SELECT 'cash:'||c.id AS id,c.kind,c.order_id AS orderId,o.event_id AS eventId,o.event_title AS eventTitle,o.outcome,NULL AS quantity,c.available_delta_units AS availableUnits,c.reserved_delta_units AS reservedUnits,0 AS spentUnits,0 AS principalUnits,0 AS feeUnits,c.created_at AS createdAt,
 CASE WHEN c.kind='release' THEN CASE WHEN k.order_id IS NOT NULL THEN 'cancelled' ELSE o.status END ELSE NULL END AS reason
 FROM practice_cash_entries c LEFT JOIN practice_orders o ON o.id=c.order_id LEFT JOIN practice_cancellations k ON k.order_id=c.order_id WHERE c.user_id=?
 UNION ALL
 SELECT 'fill:'||x.match_id||':'||x.order_id,'fill',x.order_id,o.event_id,o.event_title,o.outcome,m.quantity,x.released_units,-x.reserved_debit_units,x.principal_units+x.fee_units,x.principal_units,x.fee_units,m.created_at,NULL
 FROM practice_match_entries x JOIN practice_matches m ON m.id=x.match_id JOIN practice_orders o ON o.id=x.order_id WHERE x.user_id=?
 ) `;
type Totals = {
  entryCount: number;
  availableUnits: number;
  reservedUnits: number;
  spentUnits: number;
  principalUnits: number;
  feeUnits: number;
  grantUnits: number;
};
type Cash = {
  availableUnits: number;
  reservedUnits: number;
  spentUnits: number;
};
export async function cashJournal(
  db: D1Database,
  identity: Identity,
  raw: unknown = {},
) {
  const parsed = querySchema.safeParse(raw);
  if (!parsed.success)
    throw new AccessError(400, "Invalid activity filter or page.");
  const { page, kind } = parsed.data,
    actor = await activeAccount(db, identity);
  // Entries, all-history totals, filtered count and wallet are one snapshot.
  const result = await db.batch([
    db
      .prepare(
        journalSQL +
          `SELECT * FROM journal WHERE (?='all' OR kind=?) ORDER BY createdAt DESC,id DESC LIMIT 26 OFFSET ?`,
      )
      .bind(actor.id, actor.id, kind, kind, page * 25),
    db
      .prepare(
        journalSQL +
          `SELECT COUNT(*) AS entryCount,COALESCE(SUM(availableUnits),0) AS availableUnits,COALESCE(SUM(reservedUnits),0) AS reservedUnits,COALESCE(SUM(spentUnits),0) AS spentUnits,COALESCE(SUM(principalUnits),0) AS principalUnits,COALESCE(SUM(feeUnits),0) AS feeUnits,COALESCE(SUM(CASE WHEN kind='grant' THEN availableUnits ELSE 0 END),0) AS grantUnits FROM journal`,
      )
      .bind(actor.id, actor.id),
    db
      .prepare(
        "SELECT available_units AS availableUnits,reserved_units AS reservedUnits,spent_units AS spentUnits FROM practice_cash WHERE user_id=?",
      )
      .bind(actor.id),
    db
      .prepare(
        journalSQL +
          `SELECT COUNT(*) AS count FROM journal WHERE (?='all' OR kind=?)`,
      )
      .bind(actor.id, actor.id, kind, kind),
  ]);
  const entries = result[0].results as CashJournalEntry[],
    totals = result[1].results[0] as Totals,
    wallet = (result[2].results[0] as Cash | undefined) ?? null;
  const reconciled = wallet
    ? wallet.availableUnits === totals.availableUnits &&
      wallet.reservedUnits === totals.reservedUnits &&
      wallet.spentUnits === totals.spentUnits
    : totals.entryCount === 0;
  return {
    mode: "practice" as const,
    asOf: new Date().toISOString(),
    entries: entries.slice(0, 25),
    page,
    kind,
    hasMore: entries.length > 25,
    filteredCount: (result[3].results[0] as { count: number }).count,
    totals,
    wallet,
    reconciled,
  };
}

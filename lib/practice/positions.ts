// Read-only projection from every committed fill; never from order quantities
// or the UI's limited recent-fill history. Monetary sums stay in integer units.
export type PracticePosition = {
  eventId: string;
  eventTitle: string;
  outcome: "yes" | "no";
  eventStatus: string;
  closesAt: string;
  quantity: number;
  principalUnits: number;
  feeUnits: number;
  costBasisUnits: number;
  lastFilledAt: string;
  eventRevision: number;
  reservedQuantity: number;
  availableQuantity: number;
};
export type PositionTotals = {
  positionCount: number;
  quantity: number;
  principalUnits: number;
  feeUnits: number;
  costBasisUnits: number;
  spentUnits: number;
  reservedQuantity: number;
};
export function positionQueries(db: D1Database, userId: string, page: number) {
  return [
    db
      .prepare(
        `SELECT o.event_id AS eventId,MAX(o.event_title) AS eventTitle,o.outcome,e.status AS eventStatus,e.revision AS eventRevision,COALESCE((SELECT SUM(s.quantity) FROM practice_sell_orders s WHERE s.user_id=x.user_id AND s.event_id=o.event_id AND s.outcome=o.outcome AND s.status='open'),0) AS reservedQuantity,e.closes_at AS closesAt,SUM(m.quantity) AS quantity,SUM(x.principal_units) AS principalUnits,SUM(x.fee_units) AS feeUnits,SUM(x.principal_units+x.fee_units) AS costBasisUnits,MAX(m.created_at) AS lastFilledAt
 FROM practice_match_entries x JOIN practice_matches m ON m.id=x.match_id JOIN practice_orders o ON o.id=x.order_id JOIN own_events e ON e.id=o.event_id
 WHERE x.user_id=? GROUP BY o.event_id,o.outcome ORDER BY lastFilledAt DESC,o.event_id,o.outcome LIMIT 21 OFFSET ?`,
      )
      .bind(userId, page * 20),
    db
      .prepare(
        `SELECT COUNT(DISTINCT o.event_id||':'||o.outcome) AS positionCount,COALESCE(SUM(m.quantity),0) AS quantity,COALESCE(SUM(x.principal_units),0) AS principalUnits,COALESCE(SUM(x.fee_units),0) AS feeUnits,COALESCE(SUM(x.principal_units+x.fee_units),0) AS costBasisUnits,COALESCE((SELECT spent_units FROM practice_cash WHERE user_id=?),0) AS spentUnits,COALESCE((SELECT SUM(quantity) FROM practice_sell_orders WHERE user_id=? AND status='open'),0) AS reservedQuantity
 FROM practice_match_entries x JOIN practice_matches m ON m.id=x.match_id JOIN practice_orders o ON o.id=x.order_id WHERE x.user_id=?`,
      )
      .bind(userId, userId, userId),
  ];
}

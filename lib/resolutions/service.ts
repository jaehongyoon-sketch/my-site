import { z } from "zod";
import { requireEventAdmin, EventError } from "../events/service";
import { activeAccount } from "../accounts/access";
import type { Identity } from "../accounts/service";
const https = z
  .string()
  .url()
  .max(1000)
  .refine((v) => {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password;
  });
const common = {
  eventId: z.string().uuid(),
  expectedRevision: z.number().int().min(0).max(1000000),
  requestId: z.string().uuid(),
};
const schema = z.discriminatedUnion("action", [
  z
    .object({
      ...common,
      action: z.literal("propose"),
      eventRevision: z.number().int().positive(),
      outcome: z.enum(["yes", "no", "void"]),
      evidenceUrl: https,
      rationale: z
        .string()
        .trim()
        .min(20)
        .max(5000)
        .refine(
          (v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v),
        ),
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal("confirm"),
      acknowledgement: z.literal("CONFIRM_FINAL_OUTCOME_NO_PAYOUT"),
    })
    .strict(),
]);
export type Resolution = {
  eventId: string;
  revision: number;
  eventRevision: number;
  status: "proposed" | "final";
  outcome: "yes" | "no" | "void";
  evidenceUrl: string;
  rationale: string;
  snapshotJson: string;
  proposedAt: string;
  confirmedAt: string | null;
};
const cols =
  "event_id AS eventId,revision,event_revision AS eventRevision,status,outcome,evidence_url AS evidenceUrl,rationale,snapshot_json AS snapshotJson,proposed_at AS proposedAt,confirmed_at AS confirmedAt";
export async function listResolutions(
  db: D1Database,
  identity: Identity,
  adminId: string | undefined,
  page = 0,
  clock = Date.now(),
) {
  await requireEventAdmin(db, identity, adminId);
  if (!Number.isInteger(page) || page < 0 || page > 10000)
    throw new EventError(400, "Invalid page.");
  const r = await db
    .prepare(
      `SELECT e.id,e.title,e.rules,e.source_url AS sourceUrl,e.closes_at AS closesAt,e.revision AS eventRevision,r.revision,r.status AS resolutionStatus,r.outcome,r.evidence_url AS evidenceUrl,r.rationale,r.confirmed_at AS confirmedAt FROM own_events e LEFT JOIN event_resolutions r ON r.event_id=e.id WHERE e.status<>'draft' AND e.closes_at<=? ORDER BY e.closes_at DESC,e.id LIMIT 21 OFFSET ?`,
    )
    .bind(new Date(clock).toISOString(), page * 20)
    .all<{
      id: string;
      title: string;
      rules: string;
      sourceUrl: string;
      closesAt: string;
      eventRevision: number;
      revision: number | null;
      resolutionStatus: string | null;
      outcome: string | null;
      evidenceUrl: string | null;
      rationale: string | null;
      confirmedAt: string | null;
    }>();
  return {
    events: r.results.slice(0, 20),
    page,
    hasMore: r.results.length > 20,
  };
}
export async function saveResolution(
  db: D1Database,
  identity: Identity,
  adminId: string | undefined,
  raw: unknown,
  clock = Date.now(),
) {
  const actor = await requireEventAdmin(db, identity, adminId),
    p = schema.safeParse(raw);
  if (!p.success)
    throw new EventError(
      400,
      "Provide a valid closed event, outcome, HTTPS evidence and at least 20 characters of reasoning.",
    );
  const input = p.data,
    canonical = JSON.stringify(input),
    now = new Date(clock).toISOString();
  const receipt = () =>
    db
      .prepare(
        "SELECT actor_id AS actor,intent_json AS intent,resolution_json AS resolution FROM resolution_actions WHERE id=?",
      )
      .bind(input.requestId)
      .first<{ actor: string; intent: string; resolution: string }>();
  const replay = (r: { actor: string; intent: string; resolution: string }) => {
    if (r.actor !== actor || r.intent !== canonical)
      throw new EventError(
        409,
        "This request ID was already used for different terms.",
      );
    return {
      saved: true,
      resolution: JSON.parse(r.resolution) as Resolution,
      payoutApplied: false,
    };
  };
  const old = await receipt();
  if (old) return replay(old);
  const snapshotRow = await db
    .prepare(
      "SELECT title,rules,source_url AS sourceUrl,closes_at AS closesAt,revision FROM own_events WHERE id=?",
    )
    .bind(input.eventId)
    .first<{
      title: string;
      rules: string;
      sourceUrl: string;
      closesAt: string;
      revision: number;
    }>();
  if (!snapshotRow) throw new EventError(404, "Event not found.");
  if (
    input.action === "propose" &&
    snapshotRow.revision !== input.eventRevision
  )
    throw new EventError(
      409,
      "Event changed. Refresh before proposing a result.",
    );
  const snapshot = JSON.stringify({
    ...snapshotRow,
    settlementPolicy:
      "practice-v1: winner $1; loser $0; void returns principal and paid practice fees; no payout applied",
  });
  const write =
    input.action === "propose"
      ? db
          .prepare(
            `INSERT INTO event_resolutions (event_id,revision,event_revision,status,outcome,evidence_url,rationale,snapshot_json,operation_id,proposed_by,proposed_at)
 SELECT e.id,1,e.revision,'proposed',?,?,?,?,?,?,? FROM own_events e WHERE e.id=? AND e.status<>'draft' AND e.closes_at<=? AND e.revision=? AND EXISTS(SELECT 1 FROM app_users WHERE id=? AND status='active') AND NOT EXISTS(SELECT 1 FROM resolution_actions WHERE id=?) AND (?=0 OR EXISTS(SELECT 1 FROM event_resolutions WHERE event_id=e.id))
 ON CONFLICT(event_id) DO UPDATE SET revision=event_resolutions.revision+1,event_revision=excluded.event_revision,status='proposed',outcome=excluded.outcome,evidence_url=excluded.evidence_url,rationale=excluded.rationale,snapshot_json=excluded.snapshot_json,operation_id=excluded.operation_id,proposed_by=excluded.proposed_by,proposed_at=excluded.proposed_at WHERE event_resolutions.status='proposed' AND event_resolutions.revision=?`,
          )
          .bind(
            input.outcome,
            input.evidenceUrl,
            input.rationale,
            snapshot,
            input.requestId,
            actor,
            now,
            input.eventId,
            now,
            input.eventRevision,
            actor,
            input.requestId,
            input.expectedRevision,
            input.expectedRevision,
          )
      : db
          .prepare(
            `UPDATE event_resolutions SET status='final',revision=revision+1,operation_id=?,confirmed_by=?,confirmed_at=? WHERE event_id=? AND revision=? AND status='proposed' AND EXISTS(SELECT 1 FROM own_events e WHERE e.id=event_id AND e.revision=event_revision AND e.status<>'draft' AND e.closes_at<=?) AND EXISTS(SELECT 1 FROM app_users WHERE id=? AND status='active') AND NOT EXISTS(SELECT 1 FROM resolution_actions WHERE id=?)`,
          )
          .bind(
            input.requestId,
            actor,
            now,
            input.eventId,
            input.expectedRevision,
            now,
            actor,
            input.requestId,
          );
  await db.batch([
    write,
    db
      .prepare(
        `INSERT INTO resolution_actions SELECT ?,event_id,?,?,json_object('eventId',event_id,'revision',revision,'eventRevision',event_revision,'status',status,'outcome',outcome,'evidenceUrl',evidence_url,'rationale',rationale,'snapshotJson',snapshot_json,'proposedAt',proposed_at,'confirmedAt',confirmed_at),? FROM event_resolutions WHERE event_id=? AND operation_id=? ON CONFLICT(id) DO NOTHING`,
      )
      .bind(
        input.requestId,
        actor,
        canonical,
        now,
        input.eventId,
        input.requestId,
      ),
    db
      .prepare(
        `INSERT INTO audit_entries (id,actor_user_id,action,entity_type,entity_id,correlation_id,reason,created_at) SELECT id,actor_id,?,'event_resolution',event_id,id,resolution_json,created_at FROM resolution_actions WHERE id=? ON CONFLICT(id) DO NOTHING`,
      )
      .bind("resolution." + input.action, input.requestId),
  ]);
  const result = await receipt();
  if (!result)
    throw new EventError(
      409,
      "Event is not closed, its version changed, or the result is already final. Refresh before retrying.",
    );
  return replay(result);
}
export async function publicResolution(db: D1Database, eventId: string) {
  if (!z.string().uuid().safeParse(eventId).success)
    throw new EventError(400, "Invalid event.");
  const event = await db
    .prepare("SELECT id FROM own_events WHERE id=? AND status='published'")
    .bind(eventId)
    .first();
  if (!event) throw new EventError(404, "Event not found.");
  const resolution = await db
    .prepare(
      `SELECT ${cols} FROM event_resolutions WHERE event_id=? AND status='final'`,
    )
    .bind(eventId)
    .first<Resolution>();
  return { resolution, payoutApplied: false };
}
export async function settlementPreview(
  db: D1Database,
  identity: Identity,
  eventId: string,
) {
  const actor = await activeAccount(db, identity);
  if (!z.string().uuid().safeParse(eventId).success)
    throw new EventError(400, "Invalid event.");
  const r = await db.batch([
    db
      .prepare(
        `SELECT ${cols} FROM event_resolutions WHERE event_id=? AND status='final'`,
      )
      .bind(eventId),
    db
      .prepare(
        `SELECT o.outcome,SUM(m.quantity) AS quantity,SUM(x.principal_units) AS principalUnits,SUM(x.fee_units) AS feeUnits FROM practice_match_entries x JOIN practice_matches m ON m.id=x.match_id JOIN practice_orders o ON o.id=x.order_id WHERE x.user_id=? AND o.event_id=? GROUP BY o.outcome`,
      )
      .bind(actor.id, eventId),
  ]);
  const positions = r[1].results as {
    outcome: string;
    quantity: number;
    principalUnits: number;
    feeUnits: number;
  }[];
  if (!positions.length)
    throw new EventError(404, "No filled practice holdings for this event.");
  const resolution = (r[0].results[0] as Resolution | undefined) ?? null;
  return {
    mode: "practice",
    payoutApplied: false,
    policy: "practice-v1",
    resolution,
    positions: positions.map((p) => ({
      ...p,
      estimatedCreditUnits: !resolution
        ? null
        : resolution.outcome === "void"
          ? p.principalUnits + p.feeUnits
          : resolution.outcome === p.outcome
            ? p.quantity * 40000
            : 0,
    })),
    message:
      "Calculation only. No funds credited, fees refunded or holdings redeemed.",
  };
}

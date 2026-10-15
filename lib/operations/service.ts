import { z } from "zod";
import type { Identity } from "../accounts/service";
import { requireEventAdmin, EventError } from "../events/service";
export async function operationStatus(db: D1Database) {
  const row = await db
    .prepare(
      "SELECT paused,revision,updated_at AS updatedAt FROM practice_control WHERE id='global'",
    )
    .first<{ paused: number; revision: number; updatedAt: string }>();
  return {
    paused: !!row?.paused,
    revision: row?.revision ?? 0,
    updatedAt: row?.updatedAt ?? null,
  };
}
const inputSchema = z
  .object({
    paused: z.boolean(),
    expectedRevision: z.number().int().nonnegative(),
    requestId: z.string().uuid(),
    reason: z.string().trim().min(10).max(1000),
  })
  .strict();
export async function changeOperations(
  db: D1Database,
  identity: Identity,
  adminId: string | undefined,
  raw: unknown,
) {
  const actor = await requireEventAdmin(db, identity, adminId);
  const input = inputSchema.parse(raw);
  const intent = JSON.stringify(input);
  const receipt = () =>
    db
      .prepare(
        "SELECT actor_user_id,reason FROM audit_entries WHERE id=? AND entity_type='practice_control'",
      )
      .bind(input.requestId)
      .first<{ actor_user_id: string; reason: string }>();
  const replay = (r: { actor_user_id: string; reason: string }) => {
    const saved = JSON.parse(r.reason);
    if (r.actor_user_id !== actor || saved.intent !== intent)
      throw new EventError(
        409,
        "Request ID already used. Refresh before retrying.",
      );
    return saved.result;
  };
  const old = await receipt();
  if (old) return replay(old);
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO practice_control (id,paused,revision,operation_id,reason,updated_by,updated_at)
 SELECT 'global',?,1,?,?,?,? WHERE EXISTS(SELECT 1 FROM app_users WHERE id=? AND status='active') AND NOT EXISTS(SELECT 1 FROM audit_entries WHERE id=?) AND (?=0 OR EXISTS(SELECT 1 FROM practice_control WHERE id='global'))
 ON CONFLICT(id) DO UPDATE SET paused=excluded.paused,revision=practice_control.revision+1,operation_id=excluded.operation_id,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=excluded.updated_at WHERE practice_control.revision=?`,
      )
      .bind(
        Number(input.paused),
        input.requestId,
        input.reason,
        actor,
        now,
        actor,
        input.requestId,
        input.expectedRevision,
        input.expectedRevision,
      ),
    db
      .prepare(
        `INSERT INTO audit_entries (id,actor_user_id,action,entity_type,entity_id,correlation_id,reason,created_at)
 SELECT operation_id,updated_by,CASE WHEN paused=1 THEN 'practice.pause' ELSE 'practice.resume' END,'practice_control',id,operation_id,json_object('intent',?,'result',json_object('paused',json(CASE WHEN paused=1 THEN 'true' ELSE 'false' END),'revision',revision,'updatedAt',updated_at),'reason',reason),updated_at FROM practice_control WHERE operation_id=? ON CONFLICT(id) DO NOTHING`,
      )
      .bind(intent, input.requestId),
  ]);
  const saved = await receipt();
  if (!saved)
    throw new EventError(
      409,
      "Trading controls changed. Refresh and review the current state.",
    );
  return replay(saved);
}
export async function operationAudit(
  db: D1Database,
  identity: Identity,
  adminId: string | undefined,
  options: unknown,
) {
  await requireEventAdmin(db, identity, adminId);
  const input = z
    .object({
      page: z.number().int().min(0).max(10000).default(0),
      action: z.string().max(80).default(""),
      entityId: z.string().max(160).default(""),
    })
    .strict()
    .parse(options);
  const data = await db
    .prepare(
      `SELECT id,actor_user_id AS actorId,action,entity_type AS entityType,entity_id AS entityId,correlation_id AS correlationId,reason,created_at AS createdAt FROM audit_entries WHERE (?='' OR action=?) AND (?='' OR entity_id=?) ORDER BY created_at DESC,id DESC LIMIT 26 OFFSET ?`,
    )
    .bind(
      input.action,
      input.action,
      input.entityId,
      input.entityId,
      input.page * 25,
    )
    .all();
  return {
    ...(await operationStatus(db)),
    entries: data.results.slice(0, 25),
    hasMore: data.results.length > 25,
    page: input.page,
  };
}

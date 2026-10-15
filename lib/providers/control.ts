import type { Identity } from "../accounts/service";
export const approvals = [
  "unapproved",
  "testing",
  "approved",
  "suspended",
] as const;
export type Approval = (typeof approvals)[number];
export const providerCatalog = [
  {
    id: "kalshi:sandbox",
    providerId: "kalshi",
    environment: "sandbox",
    label: "Kalshi · Sandbox",
  },
  {
    id: "kalshi:live",
    providerId: "kalshi",
    environment: "live",
    label: "Kalshi · Live",
  },
] as const;
export class ProviderControlError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export function providerAccess(
  providerId: string,
  environment: string,
  approval: string,
  capability: "marketData" | "orders",
) {
  if (
    providerId === "demo" &&
    environment === "development" &&
    capability === "marketData"
  )
    return { allowed: true, reason: "Sample markets" };
  if (
    !providerCatalog.some(
      (p) => p.providerId === providerId && p.environment === environment,
    )
  )
    return { allowed: false, reason: "Unknown provider or environment" };
  if (approval === "suspended")
    return { allowed: false, reason: "Connection suspended" };
  if (
    approval !== "approved" &&
    !(environment === "sandbox" && approval === "testing")
  )
    return { allowed: false, reason: "Approval required" };
  // Approval is an internal record. Only shipped, reviewed adapters can grant capabilities.
  return {
    allowed: false,
    reason:
      capability === "orders"
        ? "Trading connection not implemented"
        : "Market feed activation not implemented",
  };
}
async function administrator(
  db: D1Database,
  identity: Identity,
  configuredId: string | undefined,
) {
  const actor = await db
    .prepare(
      "SELECT id FROM app_users WHERE auth_subject = ? AND status = 'active'",
    )
    .bind(`google:${identity.userId}`)
    .first<{ id: string }>();
  if (!configuredId || actor?.id !== configuredId)
    throw new ProviderControlError(403, "Administrator access required.");
  return actor.id;
}
const revisionSql =
  "(SELECT count(*) FROM audit_entries a WHERE a.entity_type='provider_connection' AND a.entity_id=c.id AND a.action='provider.review')";
export async function getProviderControls(
  db: D1Database,
  identity: Identity,
  configuredId: string | undefined,
) {
  await administrator(db, identity, configuredId);
  const rows = await db
    .prepare(
      `SELECT c.id,c.approval,${revisionSql} AS revision FROM provider_connections c WHERE c.id IN ('kalshi:sandbox','kalshi:live')`,
    )
    .all<{ id: string; approval: Approval; revision: number }>();
  const history = await db
    .prepare(
      "SELECT id,entity_id AS connectionId,actor_user_id AS actorId,reason,created_at AS createdAt FROM audit_entries WHERE entity_type='provider_connection' AND action='provider.review' ORDER BY created_at DESC,id DESC LIMIT 20",
    )
    .all<{
      id: string;
      connectionId: string;
      actorId: string;
      reason: string;
      createdAt: string;
    }>();
  return {
    connections: providerCatalog.map((p) => {
      const row = rows.results.find((r) => r.id === p.id);
      const approval = row?.approval ?? "unapproved";
      return {
        ...p,
        approval,
        revision: row?.revision ?? 0,
        marketData: providerAccess(
          p.providerId,
          p.environment,
          approval,
          "marketData",
        ),
        orders: providerAccess(p.providerId, p.environment, approval, "orders"),
      };
    }),
    history: history.results,
  };
}
export type ReviewInput = {
  connectionId: string;
  approval: Approval;
  expectedRevision: number;
  note: string;
  evidence: string;
};
export async function reviewProvider(
  db: D1Database,
  identity: Identity,
  configuredId: string | undefined,
  input: ReviewInput,
) {
  const actorId = await administrator(db, identity, configuredId);
  const definition = providerCatalog.find((p) => p.id === input.connectionId);
  if (
    !definition ||
    !approvals.includes(input.approval) ||
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 0 ||
    typeof input.note !== "string" ||
    input.note.trim().length < 5 ||
    input.note.length > 500 ||
    typeof input.evidence !== "string" ||
    input.evidence.length > 500
  )
    throw new ProviderControlError(
      400,
      "Choose a connection and provide a reason (5–500 characters).",
    );
  if (input.approval === "approved" && input.evidence.trim().length < 5)
    throw new ProviderControlError(
      400,
      "Record the approval reference before marking approved.",
    );
  if (definition.environment === "live" && input.approval === "testing")
    throw new ProviderControlError(
      400,
      "Use the sandbox connection for testing.",
    );
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  // D1 batch is atomic. The conditional audit insertion is the revision compare-and-swap;
  // the state update only runs if this exact audit entry was inserted in the same batch.
  const result = await db.batch([
    db
      .prepare(
        "INSERT INTO provider_connections (id,provider_id,environment,approval,created_at) VALUES (?,?,?,'unapproved',?) ON CONFLICT(id) DO NOTHING",
      )
      .bind(definition.id, definition.providerId, definition.environment, now),
    db
      .prepare(
        `INSERT INTO audit_entries (id,actor_user_id,action,entity_type,entity_id,correlation_id,reason,created_at)
      SELECT ?,?,'provider.review','provider_connection',c.id,?,json_object('from',c.approval,'to',?,'note',?,'evidence',?,'revision',?),? FROM provider_connections c
      WHERE c.id=? AND c.provider_id=? AND c.environment=? AND ${revisionSql}=?
      AND EXISTS (SELECT 1 FROM app_users WHERE id=? AND status='active')`,
      )
      .bind(
        id,
        actorId,
        id,
        input.approval,
        input.note.trim(),
        input.evidence.trim(),
        input.expectedRevision + 1,
        now,
        definition.id,
        definition.providerId,
        definition.environment,
        input.expectedRevision,
        actorId,
      ),
    db
      .prepare(
        "UPDATE provider_connections SET approval=? WHERE id=? AND EXISTS (SELECT 1 FROM audit_entries WHERE id=?)",
      )
      .bind(input.approval, definition.id, id),
  ]);
  if (result[1].meta.changes !== 1)
    throw new ProviderControlError(
      409,
      "This connection changed. Reload before saving again.",
    );
  return getProviderControls(db, identity, configuredId);
}

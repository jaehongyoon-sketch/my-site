import { operationStatus } from "../operations/service";
import { z } from "zod";
import {
  activeAccount,
  isAdministrator,
  AccessError,
} from "../accounts/access";
import type { Identity, Account } from "../accounts/service";
export async function assertPracticeEligible(db: D1Database, userId: string) {
  if ((await operationStatus(db)).paused)
    throw new AccessError(
      403,
      "Practice trading is paused. Viewing and cancellation remain available.",
    );
  const row = await db
    .prepare("SELECT blocked FROM trading_restrictions WHERE user_id=?")
    .bind(userId)
    .first<{ blocked: number }>();
  if (row?.blocked)
    throw new AccessError(
      403,
      "New practice trading is restricted. You can still view records and cancel existing orders.",
    );
}
export async function eligibility(db: D1Database, identity: Identity) {
  const account = await db
    .prepare("SELECT id,status FROM app_users WHERE auth_subject=?")
    .bind("google:" + identity.userId)
    .first<{ id: string; status: string }>();
  const r = account
    ? await db
        .prepare(
          "SELECT blocked,updated_at AS updatedAt FROM trading_restrictions WHERE user_id=?",
        )
        .bind(account.id)
        .first<{ blocked: number; updatedAt: string }>()
    : null;
  const operations = await operationStatus(db);
  return {
    operationsPaused: operations.paused,
    policyVersion: "day16-v1",
    signIn: "confirmed",
    profile: account?.status ?? "missing",
    tradingRestricted: !!r?.blocked,
    restrictionUpdatedAt: r?.updatedAt ?? null,
    practiceAllowed:
      account?.status === "active" && !r?.blocked && !operations.paused,
    liveTradingAllowed: false,
    identityVerification: "not_connected",
    locationVerification: "not_connected",
    funding: "not_connected",
    reasons: [
      ...(operations.paused ? ["Practice trading is temporarily paused."] : []),
      ...(account?.status !== "active"
        ? ["An active Event profile is required."]
        : []),
      ...(r?.blocked
        ? ["An administrator has restricted new trading on this account."]
        : []),
      "Identity and location verification services are not connected.",
      "Real trading and payments are not connected.",
    ],
  };
}
async function admin(
  db: D1Database,
  identity: Identity,
  configuredId: string | undefined,
) {
  const actor = await activeAccount(db, identity);
  if (!isAdministrator(actor as Pick<Account, "id" | "status">, configuredId))
    throw new AccessError(403, "Administrator access required.");
  return actor;
}
export async function adminEligibility(
  db: D1Database,
  identity: Identity,
  configuredId: string | undefined,
  page = 0,
) {
  await admin(db, identity, configuredId);
  if (!Number.isInteger(page) || page < 0 || page > 10000)
    throw new AccessError(400, "Invalid page.");
  const rows = await db
    .prepare(
      `SELECT u.id,u.status,COALESCE(p.display_name,'Unnamed account') AS displayName,COALESCE(r.blocked,0) AS blocked,COALESCE(r.revision,0) AS revision,r.reason,r.updated_at AS updatedAt FROM app_users u LEFT JOIN app_profiles p ON p.user_id=u.id LEFT JOIN trading_restrictions r ON r.user_id=u.id ORDER BY u.created_at DESC,u.id LIMIT 21 OFFSET ?`,
    )
    .bind(page * 20)
    .all<{
      id: string;
      status: string;
      displayName: string;
      blocked: number;
      revision: number;
      reason: string | null;
      updatedAt: string | null;
    }>();
  const history = await db
    .prepare(
      `SELECT id,entity_id AS accountId,action,reason,created_at AS createdAt FROM audit_entries WHERE entity_type='trading_restriction' ORDER BY created_at DESC,id DESC LIMIT 30`,
    )
    .all<{
      id: string;
      accountId: string;
      action: string;
      reason: string;
      createdAt: string;
    }>();
  return {
    accounts: rows.results.slice(0, 20),
    page,
    hasMore: rows.results.length > 20,
    history: history.results,
  };
}
const changeSchema = z
  .object({
    userId: z.string().min(1).max(100),
    blocked: z.boolean(),
    expectedRevision: z.number().int().min(0).max(100000000),
    requestId: z.string().uuid(),
    reason: z
      .string()
      .trim()
      .min(8)
      .max(500)
      .refine((v) => !/[\u0000-\u001f\u007f]/.test(v)),
  })
  .strict();
export async function changeRestriction(
  db: D1Database,
  identity: Identity,
  configuredId: string | undefined,
  raw: unknown,
) {
  const actor = await admin(db, identity, configuredId),
    parsed = changeSchema.safeParse(raw);
  if (!parsed.success)
    throw new AccessError(
      400,
      "Enter an account, current revision and an 8–500 character reason.",
    );
  const p = parsed.data,
    now = new Date().toISOString();
  // Check current administrator state and expected revision inside the write,
  // then append the audit receipt in the same atomic batch. No KYC approval.
  await db.batch([
    db
      .prepare(
        `INSERT INTO trading_restrictions (user_id,blocked,revision,operation_id,reason,updated_by,updated_at)
 SELECT u.id,?,1,?,?,?,? FROM app_users u WHERE u.id=? AND EXISTS(SELECT 1 FROM app_users WHERE id=? AND status='active') AND NOT EXISTS(SELECT 1 FROM audit_entries WHERE id=?) AND (?=0 OR EXISTS(SELECT 1 FROM trading_restrictions WHERE user_id=u.id))
 ON CONFLICT(user_id) DO UPDATE SET blocked=excluded.blocked,revision=trading_restrictions.revision+1,operation_id=excluded.operation_id,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=excluded.updated_at WHERE trading_restrictions.revision=?`,
      )
      .bind(
        p.blocked ? 1 : 0,
        p.requestId,
        p.reason,
        actor.id,
        now,
        p.userId,
        actor.id,
        p.requestId,
        p.expectedRevision,
        p.expectedRevision,
      ),
    db
      .prepare(
        `INSERT INTO audit_entries (id,actor_user_id,action,entity_type,entity_id,correlation_id,reason,created_at) SELECT operation_id,updated_by,CASE WHEN blocked=1 THEN 'trading_restricted' ELSE 'trading_restriction_removed' END,'trading_restriction',user_id,operation_id,reason,updated_at FROM trading_restrictions WHERE user_id=? AND operation_id=? ON CONFLICT(id) DO NOTHING`,
      )
      .bind(p.userId, p.requestId),
  ]);
  const receipt = await db
    .prepare(
      "SELECT actor_user_id AS actor,entity_id AS target,action,reason FROM audit_entries WHERE id=? AND entity_type='trading_restriction'",
    )
    .bind(p.requestId)
    .first<{ actor: string; target: string; action: string; reason: string }>();
  if (
    !receipt ||
    receipt.actor !== actor.id ||
    receipt.target !== p.userId ||
    receipt.reason !== p.reason ||
    receipt.action !==
      (p.blocked ? "trading_restricted" : "trading_restriction_removed")
  )
    throw new AccessError(
      409,
      "Account state changed or request conflicts. Refresh before making a new change.",
    );
  return { saved: true, requestId: p.requestId };
}

import { orderIntentSchema, type OrderPreview } from "./model";
import { estimateOrder } from "../domain/order";
import type { Identity } from "../accounts/service";
export class OrderPreviewError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export async function previewOrder(
  db: D1Database,
  identity: Identity,
  raw: unknown,
  checkedAt?: number,
): Promise<OrderPreview> {
  const parsed = orderIntentSchema.safeParse(raw);
  if (!parsed.success)
    throw new OrderPreviewError(
      400,
      "INVALID_ORDER_INTENT",
      "Choose YES or NO, a limit of 1–99 whole cents, and 1–10,000 whole contracts. Only limit buys are supported.",
    );
  const intent = parsed.data;
  const actor = await db
    .prepare("SELECT id,status FROM app_users WHERE auth_subject=?")
    .bind(`google:${identity.userId}`)
    .first<{ id: string; status: string }>();
  if (!actor || actor.status !== "active")
    throw new OrderPreviewError(
      403,
      "ACCOUNT_INACTIVE",
      "Create or reactivate your Event profile before reviewing an order.",
    );
  const event = await db
    .prepare(
      "SELECT id,title,revision,status,closes_at AS closesAt FROM own_events WHERE id=? AND status='published'",
    )
    .bind(intent.eventId)
    .first<{
      id: string;
      title: string;
      revision: number;
      status: string;
      closesAt: string;
    }>();
  if (!event)
    throw new OrderPreviewError(
      404,
      "EVENT_UNAVAILABLE",
      "This event is not available. Return to the event list.",
    );
  if (event.revision !== intent.eventRevision)
    throw new OrderPreviewError(
      409,
      "EVENT_CHANGED",
      "This event has changed. Reload its page before reviewing again.",
    );
  const now = checkedAt ?? Date.now();
  const deadline = Date.parse(event.closesAt);
  if (!Number.isFinite(deadline) || deadline <= now)
    throw new OrderPreviewError(
      409,
      "EVENT_CLOSED",
      "This event has closed. No order was created.",
    );
  return {
    previewId: crypto.randomUUID(),
    intent,
    eventTitle: event.title,
    checkedAt: new Date(now).toISOString(),
    expiresAt: new Date(Math.min(now + 60000, deadline)).toISOString(),
    orderDeadline: new Date(deadline).toISOString(),
    calculation: estimateOrder(intent.limitPriceCents, intent.quantity),
    executable: false,
    priceBasis: "user_limit",
    mode: "review_only",
    checks: {
      account: "active",
      event: "published_before_close",
      balance: "not_connected",
      execution: "not_connected",
    },
  };
}

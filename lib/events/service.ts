import { z } from "zod";
import type { Identity } from "../accounts/service";
export class EventError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export const eventInput = z
  .object({
    id: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    title: z.string().trim().min(8).max(160),
    category: z.enum([
      "Economy",
      "Politics",
      "Sports",
      "Technology",
      "Science",
      "Other",
    ]),
    rules: z.string().trim().min(30).max(5000),
    sourceUrl: z
      .string()
      .url()
      .max(1000)
      .refine((v) => new URL(v).protocol === "https:", "Use an HTTPS source."),
    closesAt: z
      .string()
      .datetime()
      .transform((v) => new Date(v).toISOString()),
    status: z.enum(["draft", "published", "archived"]),
  })
  .strict();
export type OwnEvent = {
  id: string;
  revision: number;
  title: string;
  category: string;
  rules: string;
  sourceUrl: string;
  closesAt: string;
  status: "draft" | "published" | "archived";
  createdAt: string;
  updatedAt: string;
};
const columns =
  "id,revision,title,category,rules,source_url AS sourceUrl,closes_at AS closesAt,status,created_at AS createdAt,updated_at AS updatedAt";
export async function requireEventAdmin(
  db: D1Database,
  identity: Identity,
  adminId: string | undefined,
) {
  const actor = await db
    .prepare(
      "SELECT id FROM app_users WHERE auth_subject=? AND status='active'",
    )
    .bind(`google:${identity.userId}`)
    .first<{ id: string }>();
  if (!adminId || actor?.id !== adminId)
    throw new EventError(403, "Administrator access required.");
  return actor.id;
}
export async function listOwnEvents(
  db: D1Database,
  options: {
    q?: string;
    page?: number;
    status?: string;
    category?: string;
    savedUserId?: string;
  } = {},
  admin = false,
) {
  const q = options.q?.trim() ?? "";
  const page = options.page ?? 0;
  const status = options.status ?? (admin ? "all" : "open");
  const category = options.category ?? "all";
  if (
    q.length > 100 ||
    !Number.isInteger(page) ||
    page < 0 ||
    page > 10000 ||
    !(
      admin
        ? ["all", "draft", "published", "archived"]
        : ["open", "closed", "all"]
    ).includes(status) ||
    ![
      "all",
      "Economy",
      "Politics",
      "Sports",
      "Technology",
      "Science",
      "Other",
    ].includes(category)
  )
    throw new EventError(400, "Invalid search filters.");
  const clauses: string[] = [];
  const args: (string | number)[] = [];
  if (!admin) {
    clauses.push("status='published'");
    if (status !== "all") {
      clauses.push(`closes_at ${status === "open" ? ">" : "<="} ?`);
      args.push(new Date().toISOString());
    }
  } else if (status !== "all") {
    clauses.push("status=?");
    args.push(status);
  }
  if (options.savedUserId) {
    clauses.push(
      "EXISTS (SELECT 1 FROM watchlist_entries w WHERE w.market_id=own_events.id AND w.user_id=?)",
    );
    args.push(options.savedUserId);
  }
  if (category !== "all") {
    clauses.push("category=?");
    args.push(category);
  }
  if (q) {
    clauses.push("title LIKE ? ESCAPE '\\'");
    args.push("%" + q.replace(/[\\%_]/g, "\\$&") + "%");
  }
  const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";
  const result = await db
    .prepare(
      `SELECT ${columns} FROM own_events ${where} ORDER BY created_at DESC,id DESC LIMIT 13 OFFSET ?`,
    )
    .bind(...args, page * 12)
    .all<OwnEvent>();
  return {
    events: result.results.slice(0, 12),
    hasMore: result.results.length > 12,
    page,
    q,
    status,
    category,
  };
}
export async function getOwnEvent(db: D1Database, id: string) {
  return db
    .prepare(
      `SELECT ${columns} FROM own_events WHERE id=? AND status='published'`,
    )
    .bind(id)
    .first<OwnEvent>();
}
export async function saveOwnEvent(
  db: D1Database,
  identity: Identity,
  adminId: string | undefined,
  raw: unknown,
) {
  const actor = await requireEventAdmin(db, identity, adminId);
  const input = eventInput.parse(raw);
  const now = new Date().toISOString();
  if (input.status === "published" && input.closesAt <= now)
    throw new EventError(400, "A published event must close in the future.");
  const audit = crypto.randomUUID();
  if (input.revision === 0) {
    if (input.status === "archived")
      throw new EventError(400, "Create a draft first.");
    const results = await db.batch([
      db
        .prepare(
          "INSERT INTO own_events (id,title,category,rules,source_url,closes_at,status,revision,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,?,?,?) ON CONFLICT(id) DO NOTHING",
        )
        .bind(
          input.id,
          input.title,
          input.category,
          input.rules,
          input.sourceUrl,
          input.closesAt,
          input.status,
          actor,
          now,
          now,
        ),
      db
        .prepare(
          "INSERT INTO audit_entries (id,actor_user_id,action,entity_type,entity_id,correlation_id,reason,created_at) SELECT ?,?,'event.create','own_event',id,?,?,? FROM own_events WHERE id=? AND updated_at=? AND updated_by=? AND NOT EXISTS(SELECT 1 FROM audit_entries WHERE entity_type='own_event' AND entity_id=? AND action='event.create')",
        )
        .bind(
          audit,
          actor,
          audit,
          JSON.stringify({ status: input.status, revision: 1 }),
          now,
          input.id,
          now,
          actor,
          input.id,
        ),
    ]);
    if (!results[0].meta.changes)
      throw new EventError(
        409,
        "This event was already created. Reload your events.",
      );
  } else {
    const results = await db.batch([
      db
        .prepare(
          "INSERT INTO audit_entries (id,actor_user_id,action,entity_type,entity_id,correlation_id,reason,created_at) SELECT ?,?,'event.update','own_event',id,?,?,? FROM own_events WHERE id=? AND revision=? AND (status='draft' OR (status='published' AND ?='archived') OR (status='archived' AND ?='published' AND closes_at>?))",
        )
        .bind(
          audit,
          actor,
          audit,
          JSON.stringify({
            status: input.status,
            revision: input.revision + 1,
          }),
          now,
          input.id,
          input.revision,
          input.status,
          input.status,
          now,
        ),
      db
        .prepare(
          "UPDATE own_events SET title=CASE WHEN status='draft' THEN ? ELSE title END,category=CASE WHEN status='draft' THEN ? ELSE category END,rules=CASE WHEN status='draft' THEN ? ELSE rules END,source_url=CASE WHEN status='draft' THEN ? ELSE source_url END,closes_at=CASE WHEN status='draft' THEN ? ELSE closes_at END,status=?,revision=revision+1,updated_by=?,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM audit_entries WHERE id=?)",
        )
        .bind(
          input.title,
          input.category,
          input.rules,
          input.sourceUrl,
          input.closesAt,
          input.status,
          actor,
          now,
          input.id,
          audit,
        ),
    ]);
    if (!results[0].meta.changes)
      throw new EventError(
        409,
        "Event changed or is no longer editable. Reload. Published rules are locked. Archived events can be republished only before their original closing time.",
      );
  }
  return { saved: true, id: input.id };
}

export async function deleteOwnDraft(
  db: D1Database,
  identity: Identity,
  adminId: string | undefined,
  raw: unknown,
) {
  const actor = await requireEventAdmin(db, identity, adminId);
  const input = z
    .object({
      id: z.string().uuid(),
      revision: z.number().int().positive(),
      acknowledgement: z.literal("DELETE_DRAFT"),
    })
    .strict()
    .parse(raw);
  const audit = crypto.randomUUID();
  const result = await db.batch([
    db
      .prepare(
        `INSERT INTO audit_entries (id,actor_user_id,action,entity_type,entity_id,correlation_id,reason,created_at)
      SELECT ?,?,'event.delete','own_event',id,?,json_object('title',title,'revision',revision,'status',status),?
      FROM own_events WHERE id=? AND revision=? AND status='draft'
      AND NOT EXISTS (SELECT 1 FROM practice_orders WHERE event_id=own_events.id)
      AND NOT EXISTS (SELECT 1 FROM event_resolutions WHERE event_id=own_events.id)`,
      )
      .bind(
        audit,
        actor,
        audit,
        new Date().toISOString(),
        input.id,
        input.revision,
      ),
    db
      .prepare(
        "DELETE FROM watchlist_entries WHERE market_id=? AND EXISTS(SELECT 1 FROM audit_entries WHERE id=?)",
      )
      .bind(input.id, audit),
    db
      .prepare(
        "DELETE FROM own_events WHERE id=? AND status='draft' AND revision=? AND EXISTS(SELECT 1 FROM audit_entries WHERE id=?)",
      )
      .bind(input.id, input.revision, audit),
  ]);
  if (!result[2].meta.changes)
    throw new EventError(
      409,
      "Only unchanged, unused drafts can be deleted. Hide published events to preserve their trading records.",
    );
  return { deleted: true, id: input.id };
}

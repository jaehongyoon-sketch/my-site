/** Trading foundation plus Day 4 persistent application accounts. */
import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  check,
  index,
  uniqueIndex,
  foreignKey,
} from "drizzle-orm/sqlite-core";
import {
  executionStatuses,
  transferStatuses,
  accountStatuses,
  verificationStatuses,
} from "../lib/domain/lifecycle";
const now = () => text("created_at").notNull(); // ISO UTC, assigned by server; never client input.
const safe = (column: unknown) =>
  sql`typeof(${column}) = 'integer' AND ${column} BETWEEN -9007199254740991 AND 9007199254740991`;
export const users = sqliteTable(
  "app_users",
  {
    id: text("id").primaryKey(),
    authSubject: text("auth_subject").notNull(),
    status: text("status", {
      enum: ["active", "suspended", "closed"],
    }).notNull(),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex("uq_user_auth_subject").on(t.authSubject),
    check("user_status", sql`${t.status} IN ('active','suspended','closed')`),
  ],
);
export const connections = sqliteTable(
  "provider_connections",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id").notNull(),
    environment: text("environment", {
      enum: ["development", "sandbox", "live"],
    }).notNull(),
    approval: text("approval", {
      enum: ["unapproved", "testing", "approved", "suspended"],
    })
      .notNull()
      .default("unapproved"),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex("uq_provider_environment").on(t.providerId, t.environment),
    check(
      "connection_environment",
      sql`${t.environment} IN ('development','sandbox','live')`,
    ),
    check(
      "connection_approval",
      sql`${t.approval} IN ('unapproved','testing','approved','suspended')`,
    ),
  ],
);
export const accounts = sqliteTable(
  "linked_accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "restrict" }),
    externalAccountId: text("external_account_id"),
    status: text("status", { enum: accountStatuses })
      .notNull()
      .default("unlinked"),
    verification: text("verification", { enum: verificationStatuses })
      .notNull()
      .default("not_started"),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex("uq_account_scope").on(t.id, t.connectionId, t.userId),
    uniqueIndex("uq_external_account").on(t.connectionId, t.externalAccountId),
    index("idx_accounts_user").on(t.userId),
    check(
      "account_status",
      sql`${t.status} IN ('unlinked','pending','active','restricted','closed')`,
    ),
    check(
      "verification_status",
      sql`${t.verification} IN ('not_started','pending','verified','rejected')`,
    ),
  ],
);
export const instruments = sqliteTable(
  "instruments",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "restrict" }),
    externalMarketId: text("external_market_id").notNull(),
    title: text("title").notNull(),
    rulesVersion: text("rules_version").notNull(),
    status: text("status", {
      enum: ["open", "halted", "closed", "resolved"],
    }).notNull(),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex("uq_instrument_external").on(
      t.connectionId,
      t.externalMarketId,
    ),
    uniqueIndex("uq_instrument_scope").on(t.id, t.connectionId),
    check(
      "instrument_status",
      sql`${t.status} IN ('open','halted','closed','resolved')`,
    ),
  ],
);
export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    accountId: text("account_id").notNull(),
    connectionId: text("connection_id").notNull(),
    marketId: text("market_id").notNull(),
    externalOrderId: text("external_order_id"),
    clientOrderId: text("client_order_id").notNull(),
    requestHash: text("request_hash").notNull(),
    side: text("side", { enum: ["buy", "sell"] }).notNull(),
    outcome: text("outcome", { enum: ["yes", "no"] }).notNull(),
    quantity: integer("quantity").notNull(),
    limitPriceCents: integer("limit_price_cents").notNull(),
    filledQuantity: integer("filled_quantity").notNull().default(0),
    status: text("status", { enum: executionStatuses })
      .notNull()
      .default("submitting"),
    cancelRequested: integer("cancel_requested", { mode: "boolean" })
      .notNull()
      .default(false),
    providerRevision: integer("provider_revision"),
    createdAt: now(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.accountId, t.connectionId, t.userId],
      foreignColumns: [accounts.id, accounts.connectionId, accounts.userId],
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.marketId, t.connectionId],
      foreignColumns: [instruments.id, instruments.connectionId],
    }).onDelete("restrict"),
    uniqueIndex("uq_order_scope").on(t.id, t.accountId, t.connectionId),
    uniqueIndex("uq_order_request").on(t.accountId, t.clientOrderId),
    uniqueIndex("uq_order_external").on(
      t.connectionId,
      t.accountId,
      t.externalOrderId,
    ),
    index("idx_orders_user_created").on(t.userId, t.createdAt),
    check("order_side", sql`${t.side} IN ('buy','sell')`),
    check("order_outcome", sql`${t.outcome} IN ('yes','no')`),
    check(
      "order_quantity",
      sql`typeof(${t.quantity}) = 'integer' AND ${t.quantity} BETWEEN 1 AND 10000`,
    ),
    check(
      "order_price",
      sql`typeof(${t.limitPriceCents}) = 'integer' AND ${t.limitPriceCents} BETWEEN 1 AND 99`,
    ),
    check(
      "order_filled_quantity",
      sql`typeof(${t.filledQuantity}) = 'integer' AND ${t.filledQuantity} BETWEEN 0 AND ${t.quantity}`,
    ),
    check(
      "order_status",
      sql`${t.status} IN ('submitting','unknown','accepted','partially_filled','filled','canceled','rejected','expired')`,
    ),
    check("order_cancel_boolean", sql`${t.cancelRequested} IN (0,1)`),
    check(
      "order_revision",
      sql`${t.providerRevision} IS NULL OR (typeof(${t.providerRevision}) = 'integer' AND ${t.providerRevision} BETWEEN 1 AND 9007199254740991)`,
    ),
    check(
      "order_status_quantity",
      sql`(${t.status} IN ('submitting','unknown','accepted','rejected') AND ${t.filledQuantity} = 0) OR (${t.status} = 'partially_filled' AND ${t.filledQuantity} > 0 AND ${t.filledQuantity} < ${t.quantity}) OR (${t.status} = 'filled' AND ${t.filledQuantity} = ${t.quantity}) OR (${t.status} IN ('canceled','expired') AND ${t.filledQuantity} < ${t.quantity})`,
    ),
    check(
      "order_terminal_cancel",
      sql`${t.status} NOT IN ('filled','canceled','rejected','expired') OR ${t.cancelRequested} = 0`,
    ),
  ],
);
export const fills = sqliteTable(
  "fills",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull(),
    accountId: text("account_id").notNull(),
    connectionId: text("connection_id").notNull(),
    externalFillId: text("external_fill_id").notNull(),
    quantity: integer("quantity").notNull(),
    priceCents: integer("price_cents").notNull(),
    feeCents: integer("fee_cents").notNull(),
    executedAt: text("executed_at").notNull(),
    createdAt: now(),
  },
  (t) => [
    foreignKey({
      columns: [t.orderId, t.accountId, t.connectionId],
      foreignColumns: [orders.id, orders.accountId, orders.connectionId],
    }).onDelete("restrict"),
    uniqueIndex("uq_fill_external").on(
      t.connectionId,
      t.accountId,
      t.externalFillId,
    ),
    index("idx_fills_order").on(t.orderId),
    check(
      "fill_quantity",
      sql`typeof(${t.quantity}) = 'integer' AND ${t.quantity} BETWEEN 1 AND 10000`,
    ),
    check(
      "fill_price",
      sql`typeof(${t.priceCents}) = 'integer' AND ${t.priceCents} BETWEEN 1 AND 99`,
    ),
    check("fill_fee", safe(t.feeCents)),
  ],
);
export const transfers = sqliteTable(
  "cash_transfers",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    accountId: text("account_id").notNull(),
    connectionId: text("connection_id").notNull(),
    clientTransferId: text("client_transfer_id").notNull(),
    requestHash: text("request_hash").notNull(),
    externalTransferId: text("external_transfer_id"),
    direction: text("direction", { enum: ["deposit", "withdrawal"] }).notNull(),
    currency: text("currency").notNull().default("USD"),
    amountCents: integer("amount_cents").notNull(),
    status: text("status", { enum: transferStatuses })
      .notNull()
      .default("requested"),
    providerRevision: integer("provider_revision"),
    createdAt: now(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.accountId, t.connectionId, t.userId],
      foreignColumns: [accounts.id, accounts.connectionId, accounts.userId],
    }).onDelete("restrict"),
    uniqueIndex("uq_transfer_request").on(t.accountId, t.clientTransferId),
    uniqueIndex("uq_transfer_external").on(
      t.connectionId,
      t.accountId,
      t.externalTransferId,
    ),
    index("idx_transfers_user_created").on(t.userId, t.createdAt),
    check(
      "transfer_amount",
      sql`${safe(t.amountCents)} AND ${t.amountCents} > 0`,
    ),
    check("transfer_currency", sql`${t.currency} = 'USD'`),
    check(
      "transfer_direction",
      sql`${t.direction} IN ('deposit','withdrawal')`,
    ),
    check(
      "transfer_status",
      sql`${t.status} IN ('requested','unknown','pending','completed','failed','canceled','returned')`,
    ),
    check(
      "transfer_revision",
      sql`${t.providerRevision} IS NULL OR (typeof(${t.providerRevision}) = 'integer' AND ${t.providerRevision} BETWEEN 1 AND 9007199254740991)`,
    ),
  ],
);
export const balanceSnapshots = sqliteTable(
  "balance_snapshots",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    currency: text("currency").notNull().default("USD"),
    cashCents: integer("cash_cents").notNull(),
    buyingPowerCents: integer("buying_power_cents").notNull(),
    withdrawableCents: integer("withdrawable_cents").notNull(),
    reservedCents: integer("reserved_cents").notNull(),
    providerRevision: integer("provider_revision").notNull(),
    observedAt: text("observed_at").notNull(),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex("uq_balance_revision").on(t.accountId, t.providerRevision),
    check("balance_currency", sql`${t.currency} = 'USD'`),
    check("balance_cash", safe(t.cashCents)),
    check(
      "balance_buying_power",
      sql`${safe(t.buyingPowerCents)} AND ${t.buyingPowerCents} >= 0`,
    ),
    check(
      "balance_withdrawable",
      sql`${safe(t.withdrawableCents)} AND ${t.withdrawableCents} >= 0`,
    ),
    check(
      "balance_reserved",
      sql`${safe(t.reservedCents)} AND ${t.reservedCents} >= 0`,
    ),
    check(
      "balance_revision",
      sql`${safe(t.providerRevision)} AND ${t.providerRevision} > 0`,
    ),
  ],
);
export const positions = sqliteTable(
  "position_snapshots",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    connectionId: text("connection_id").notNull(),
    userId: text("user_id").notNull(),
    marketId: text("market_id").notNull(),
    outcome: text("outcome", { enum: ["yes", "no"] }).notNull(),
    quantity: integer("quantity").notNull(),
    reservedQuantity: integer("reserved_quantity").notNull(),
    providerRevision: integer("provider_revision").notNull(),
    observedAt: text("observed_at").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.accountId, t.connectionId, t.userId],
      foreignColumns: [accounts.id, accounts.connectionId, accounts.userId],
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.marketId, t.connectionId],
      foreignColumns: [instruments.id, instruments.connectionId],
    }).onDelete("restrict"),
    uniqueIndex("uq_position_revision").on(
      t.accountId,
      t.marketId,
      t.outcome,
      t.providerRevision,
    ),
    check("position_outcome", sql`${t.outcome} IN ('yes','no')`),
    check("position_quantity", sql`${safe(t.quantity)} AND ${t.quantity} >= 0`),
    check(
      "position_reserved",
      sql`${safe(t.reservedQuantity)} AND ${t.reservedQuantity} BETWEEN 0 AND ${t.quantity}`,
    ),
    check(
      "position_revision",
      sql`${safe(t.providerRevision)} AND ${t.providerRevision} > 0`,
    ),
  ],
);
export const providerEvents = sqliteTable(
  "provider_events",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "restrict" }),
    externalEventId: text("external_event_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    normalizedPayload: text("normalized_payload").notNull(),
    processingStatus: text("processing_status", {
      enum: ["received", "applied", "quarantined"],
    })
      .notNull()
      .default("received"),
    receivedAt: text("received_at").notNull(),
  },
  (t) => [
    uniqueIndex("uq_provider_event").on(t.connectionId, t.externalEventId),
    index("idx_events_processing").on(t.processingStatus, t.receivedAt),
    check(
      "event_processing_status",
      sql`${t.processingStatus} IN ('received','applied','quarantined')`,
    ),
  ],
);
export const auditEntries = sqliteTable(
  "audit_entries",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    correlationId: text("correlation_id").notNull(),
    reason: text("reason").notNull(),
    createdAt: now(),
  },
  (t) => [index("idx_audit_entity").on(t.entityType, t.entityId, t.createdAt)],
);

/** Durable app profile. Identity and session remain owned by the login provider. */
export const profiles = sqliteTable(
  "app_profiles",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "restrict" }),
    displayName: text("display_name").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [check("profile_name_length", sql`length(${t.displayName}) <= 60`)],
);

export const googleFlows = sqliteTable(
  "google_auth_flows",
  {
    stateHash: text("state_hash").primaryKey(),
    browserHash: text("browser_hash").notNull(),
    verifier: text("verifier").notNull(),
    nonce: text("nonce").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [index("idx_google_flows_expiry").on(t.expiresAt)],
);
export const googleSessions = sqliteTable(
  "google_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    googleSubject: text("google_subject").notNull(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [
    index("idx_google_sessions_expiry").on(t.expiresAt),
    index("idx_google_sessions_subject").on(t.googleSubject),
  ],
);

export const watchlistEntries = sqliteTable(
  "watchlist_entries",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    marketId: text("market_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("uq_watchlist_user_market").on(t.userId, t.marketId),
    index("idx_watchlist_user_created").on(t.userId, t.createdAt),
  ],
);

export const nameChangeLimits = sqliteTable("name_change_limits", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "restrict" }),
  nameHash: text("name_hash").notNull(),
  changedAt: integer("changed_at").notNull(),
  operationId: text("operation_id").notNull(),
});
export const ownEvents = sqliteTable(
  "own_events",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    category: text("category").notNull(),
    rules: text("rules").notNull(),
    sourceUrl: text("source_url").notNull(),
    closesAt: text("closes_at").notNull(),
    status: text("status", { enum: ["draft", "published", "archived"] })
      .notNull()
      .default("draft"),
    revision: integer("revision").notNull().default(1),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_own_events_status_close").on(t.status, t.closesAt, t.id),
    check(
      "own_event_status",
      sql`${t.status} IN ('draft','published','archived')`,
    ),
    check("own_event_revision", sql`${t.revision} > 0`),
  ],
);

// Practice funds are isolated from every real-money table.
export const practiceWallets = sqliteTable(
  "practice_wallets",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id),
    available: integer("available_cents").notNull(),
    reserved: integer("reserved_cents").notNull(),
    grantId: text("grant_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    check(
      "practice_wallet_nonnegative",
      sql`typeof(${t.available})='integer' AND typeof(${t.reserved})='integer' AND ${t.available}>=0 AND ${t.reserved}>=0 AND ${t.available}+${t.reserved}=100000`,
    ),
  ],
);
export const practiceOrders = sqliteTable(
  "practice_orders",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => practiceWallets.userId),
    eventId: text("event_id")
      .notNull()
      .references(() => ownEvents.id),
    clientId: text("client_id").notNull(),
    intent: text("intent_json").notNull(),
    eventRevision: integer("event_revision").notNull(),
    title: text("event_title").notNull(),
    outcome: text("outcome").notNull(),
    price: integer("price_cents").notNull(),
    quantity: integer("quantity").notNull(),
    principal: integer("principal_cents").notNull(),
    fee: integer("fee_cents").notNull(),
    total: integer("total_cents").notNull(),
    status: text("status").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
    releaseId: text("release_id"),
  },
  (t) => [
    uniqueIndex("practice_order_idempotency").on(t.userId, t.clientId),
    index("practice_order_book").on(t.eventId, t.status, t.outcome, t.price),
    index("practice_order_history").on(t.userId, t.createdAt),
    check(
      "practice_order_terms",
      sql`${t.outcome} IN ('yes','no') AND ${t.status} IN ('open','expired','voided') AND ${t.price} BETWEEN 1 AND 99 AND ${t.quantity} BETWEEN 1 AND 10000 AND ${t.principal}=${t.price}*${t.quantity} AND ${t.fee}=CAST((${t.principal}+200)/400 AS INTEGER) AND ${t.total}=${t.principal}+${t.fee}`,
    ),
  ],
);
export const practiceLedger = sqliteTable(
  "practice_ledger",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => practiceWallets.userId),
    orderId: text("order_id").references(() => practiceOrders.id),
    kind: text("kind").notNull(),
    availableDelta: integer("available_delta").notNull(),
    reservedDelta: integer("reserved_delta").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("practice_ledger_order_kind").on(t.orderId, t.kind),
    check(
      "practice_ledger_kind",
      sql`${t.kind} IN ('grant','reserve','release')`,
    ),
  ],
);

// Day 11 cash supersedes the immutable Day 10 wallet snapshot, preserving grants.
export const practiceCash = sqliteTable(
  "practice_cash",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => practiceWallets.userId),
    available: integer("available_units").notNull(),
    reserved: integer("reserved_units").notNull(),
    spent: integer("spent_units").notNull().default(0),
  },
  (t) => [
    check(
      "practice_cash_conserved",
      sql`typeof(${t.available})='integer' AND typeof(${t.reserved})='integer' AND typeof(${t.spent})='integer' AND ${t.available}>=0 AND ${t.reserved}>=0 AND ${t.spent}>=0 AND ${t.available}+${t.reserved}+${t.spent}=40000000`,
    ),
  ],
);
export const practiceProgress = sqliteTable(
  "practice_order_progress",
  {
    orderId: text("order_id")
      .primaryKey()
      .references(() => practiceOrders.id),
    feePolicy: text("fee_policy").notNull().default("per_contract"),
    filled: integer("filled_quantity").notNull().default(0),
    principal: integer("executed_principal_units").notNull().default(0),
    fee: integer("charged_fee_units").notNull().default(0),
    held: integer("held_units").notNull(),
    revision: integer("revision").notNull().default(0),
  },
  (t) => [
    check(
      "practice_progress_nonnegative",
      sql`${t.filled}>=0 AND ${t.principal}>=0 AND ${t.fee}>=0 AND ${t.held}>=0 AND ${t.revision}>=0`,
    ),
  ],
);
export const practiceMatches = sqliteTable(
  "practice_matches",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => ownEvents.id),
    makerId: text("maker_id")
      .notNull()
      .references(() => practiceOrders.id),
    takerId: text("taker_id")
      .notNull()
      .references(() => practiceOrders.id),
    quantity: integer("quantity").notNull(),
    makerPrice: integer("maker_price").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("practice_match_event").on(t.eventId, t.createdAt),
    check(
      "practice_match_terms",
      sql`${t.quantity}>0 AND ${t.makerPrice} BETWEEN 1 AND 99 AND ${t.makerId}<>${t.takerId}`,
    ),
  ],
);
export const practiceMatchEntries = sqliteTable(
  "practice_match_entries",
  {
    matchId: text("match_id")
      .notNull()
      .references(() => practiceMatches.id),
    orderId: text("order_id")
      .notNull()
      .references(() => practiceOrders.id),
    userId: text("user_id")
      .notNull()
      .references(() => practiceCash.userId),
    principal: integer("principal_units").notNull(),
    fee: integer("fee_units").notNull(),
    released: integer("released_units").notNull(),
    reservedDebit: integer("reserved_debit_units").notNull(),
  },
  (t) => [
    uniqueIndex("practice_entry_match_order").on(t.matchId, t.orderId),
    index("practice_entry_user").on(t.userId, t.matchId),
    check(
      "practice_entry_conservation",
      sql`${t.principal}>0 AND ${t.fee}>=0 AND ${t.released}>=0 AND ${t.reservedDebit}=${t.principal}+${t.fee}+${t.released}`,
    ),
  ],
);

export const practiceCashEntries = sqliteTable(
  "practice_cash_entries",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => practiceCash.userId),
    orderId: text("order_id").references(() => practiceOrders.id),
    kind: text("kind").notNull(),
    availableDelta: integer("available_delta_units").notNull(),
    reservedDelta: integer("reserved_delta_units").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("practice_cash_entry_order_kind").on(t.orderId, t.kind),
    index("practice_cash_entry_user_time").on(t.userId, t.createdAt),
    check(
      "practice_cash_entry_kind",
      sql`${t.kind} IN ('grant','reserve','release')`,
    ),
  ],
);

export const practiceCancellations = sqliteTable(
  "practice_cancellations",
  {
    orderId: text("order_id")
      .primaryKey()
      .references(() => practiceOrders.id),
    userId: text("user_id")
      .notNull()
      .references(() => practiceCash.userId),
    operationId: text("operation_id").notNull(),
    quantity: integer("cancelled_quantity").notNull(),
    refunded: integer("refunded_units").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("practice_cancel_operation").on(t.operationId),
    check("practice_cancel_amounts", sql`${t.quantity}>0 AND ${t.refunded}>=0`),
  ],
);

export const practiceSells = sqliteTable(
  "practice_sell_orders",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    eventId: text("event_id")
      .notNull()
      .references(() => ownEvents.id),
    clientId: text("client_id").notNull(),
    intent: text("intent_json").notNull(),
    eventRevision: integer("event_revision").notNull(),
    title: text("event_title").notNull(),
    outcome: text("outcome").notNull(),
    quantity: integer("quantity").notNull(),
    price: integer("price_cents").notNull(),
    status: text("status").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
    releasedAt: text("released_at"),
    releaseId: text("release_id"),
  },
  (t) => [
    uniqueIndex("practice_sell_idempotency").on(t.userId, t.clientId),
    index("practice_sell_position").on(
      t.userId,
      t.eventId,
      t.outcome,
      t.status,
    ),
    index("practice_sell_history").on(t.userId, t.createdAt),
    check(
      "practice_sell_terms",
      sql`${t.quantity} BETWEEN 1 AND 10000 AND ${t.price} BETWEEN 1 AND 99 AND ${t.outcome} IN ('yes','no') AND ${t.status} IN ('open','cancelled','expired','voided')`,
    ),
  ],
);
export const practiceShareEntries = sqliteTable(
  "practice_share_entries",
  {
    id: text("id").primaryKey(),
    sellId: text("sell_id")
      .notNull()
      .references(() => practiceSells.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind").notNull(),
    delta: integer("reserved_delta").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("practice_share_once").on(t.sellId, t.kind),
    check(
      "practice_share_direction",
      sql`(${t.kind}='reserve' AND ${t.delta}>0) OR (${t.kind}='release' AND ${t.delta}<0)`,
    ),
  ],
);

export const tradingRestrictions = sqliteTable(
  "trading_restrictions",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id),
    blocked: integer("blocked").notNull(),
    revision: integer("revision").notNull(),
    operationId: text("operation_id").notNull(),
    reason: text("reason").notNull(),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => users.id),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("trading_restriction_operation").on(t.operationId),
    check(
      "trading_restriction_values",
      sql`${t.blocked} IN (0,1) AND ${t.revision}>0`,
    ),
  ],
);

export const practiceTradeEvents = sqliteTable(
  "practice_trade_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind").notNull(),
    sourceId: text("source_id").notNull(),
    eventId: text("event_id")
      .notNull()
      .references(() => ownEvents.id),
    eventTitle: text("event_title").notNull(),
    outcome: text("outcome").notNull(),
    quantity: integer("quantity").notNull(),
    occurredAt: text("occurred_at").notNull(),
    recordedAt: text("recorded_at").notNull(),
  },
  (t) => [
    index("practice_trade_events_user_time").on(t.userId, t.occurredAt, t.id),
    uniqueIndex("practice_trade_events_source").on(
      t.userId,
      t.kind,
      t.sourceId,
    ),
    check(
      "practice_trade_event_terms",
      sql`${t.kind} IN ('buy_accepted','buy_filled','buy_released','sell_reserved','sell_released') AND ${t.quantity}>0 AND ${t.outcome} IN ('yes','no')`,
    ),
  ],
);
export const practiceTradeReceipts = sqliteTable(
  "practice_trade_receipts",
  {
    eventId: text("event_id")
      .primaryKey()
      .references(() => practiceTradeEvents.id),
    handler: text("handler").notNull(),
    processedAt: text("processed_at").notNull(),
  },
  (t) => [check("practice_trade_handler", sql`${t.handler}='activity-v1'`)],
);

export const eventResolutions = sqliteTable(
  "event_resolutions",
  {
    eventId: text("event_id")
      .primaryKey()
      .references(() => ownEvents.id),
    revision: integer("revision").notNull(),
    eventRevision: integer("event_revision").notNull(),
    status: text("status").notNull(),
    outcome: text("outcome").notNull(),
    evidenceUrl: text("evidence_url").notNull(),
    rationale: text("rationale").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    operationId: text("operation_id").notNull(),
    proposedBy: text("proposed_by")
      .notNull()
      .references(() => users.id),
    proposedAt: text("proposed_at").notNull(),
    confirmedBy: text("confirmed_by").references(() => users.id),
    confirmedAt: text("confirmed_at"),
  },
  (t) => [
    uniqueIndex("event_resolution_operation").on(t.operationId),
    check(
      "event_resolution_terms",
      sql`${t.revision}>0 AND ${t.status} IN ('proposed','final') AND ${t.outcome} IN ('yes','no','void') AND ((${t.status}='proposed' AND ${t.confirmedAt} IS NULL AND ${t.confirmedBy} IS NULL) OR (${t.status}='final' AND ${t.confirmedAt} IS NOT NULL AND ${t.confirmedBy} IS NOT NULL))`,
    ),
  ],
);
export const resolutionActions = sqliteTable(
  "resolution_actions",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => ownEvents.id),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id),
    intentJson: text("intent_json").notNull(),
    resolutionJson: text("resolution_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("resolution_actions_event_time").on(t.eventId, t.createdAt)],
);

export const practiceControl = sqliteTable(
  "practice_control",
  {
    id: text("id").primaryKey(),
    paused: integer("paused").notNull(),
    revision: integer("revision").notNull(),
    operationId: text("operation_id").notNull(),
    reason: text("reason").notNull(),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => users.id),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    check(
      "practice_control_terms",
      sql`${t.id}='global' AND ${t.paused} IN (0,1) AND ${t.revision}>0`,
    ),
  ],
);

export const notificationSettings = sqliteTable(
  "notification_settings",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id),
    enabled: integer("enabled").notNull(),
    revision: integer("revision").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    check(
      "notification_settings_terms",
      sql`${t.enabled} IN (0,1) AND ${t.revision}>0`,
    ),
  ],
);
export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id")
      .primaryKey()
      .references(() => practiceTradeEvents.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    visible: integer("visible").notNull(),
    readAt: text("read_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("notifications_user_time").on(t.userId, t.createdAt, t.id),
    check("notification_visible", sql`${t.visible} IN (0,1)`),
  ],
);

export const requestLimits = sqliteTable(
  "request_limits",
  {
    key: text("key").primaryKey(),
    windowStart: integer("window_start").notNull(),
    count: integer("count").notNull(),
  },
  (t) => [
    check("request_limit_positive", sql`${t.count}>0 AND ${t.windowStart}>=0`),
  ],
);

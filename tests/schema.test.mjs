import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
const time = "2026-09-26T00:00:00Z";
function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(new URL("../drizzle/", import.meta.url))
    .filter((n) => n.endsWith(".sql"))
    .sort())
    db.exec(
      readFileSync(new URL("../drizzle/" + name, import.meta.url), "utf8"),
    );
  for (const id of ["u1", "u2"])
    db.prepare("INSERT INTO app_users VALUES (?,?,?,?)").run(
      id,
      "auth:" + id,
      "active",
      time,
    );
  for (const id of ["c1", "c2"])
    db.prepare("INSERT INTO provider_connections VALUES (?,?,?,?,?)").run(
      id,
      "provider:" + id,
      "sandbox",
      "testing",
      time,
    );
  for (const [id, user, c] of [
    ["a1", "u1", "c1"],
    ["a2", "u2", "c1"],
    ["a3", "u1", "c2"],
  ])
    db.prepare("INSERT INTO linked_accounts VALUES (?,?,?,?,?,?,?)").run(
      id,
      user,
      c,
      "external:" + id,
      "active",
      "verified",
      time,
    );
  for (const [id, c] of [
    ["m1", "c1"],
    ["m2", "c2"],
  ])
    db.prepare("INSERT INTO instruments VALUES (?,?,?,?,?,?,?)").run(
      id,
      c,
      "market:" + id,
      "Sample",
      "v1",
      "open",
      time,
    );
  return db;
}
function insertOrder(db, patch = {}) {
  const row = {
    id: "o1",
    user_id: "u1",
    account_id: "a1",
    connection_id: "c1",
    market_id: "m1",
    client_order_id: "request-1",
    request_hash: "hash-1",
    side: "buy",
    outcome: "yes",
    quantity: 100,
    limit_price_cents: 60,
    status: "accepted",
    filled_quantity: 0,
    provider_revision: 1,
    created_at: time,
    updated_at: time,
    ...patch,
  };
  db.prepare(
    `INSERT INTO orders (${Object.keys(row).join(",")}) VALUES (${Object.keys(
      row,
    )
      .map(() => "?")
      .join(",")})`,
  ).run(...Object.values(row));
}
function insertFill(db, patch = {}) {
  const row = {
    id: "f1",
    order_id: "o1",
    account_id: "a1",
    connection_id: "c1",
    external_fill_id: "fill-1",
    quantity: 20,
    price_cents: 60,
    fee_cents: 0,
    executed_at: time,
    created_at: time,
    ...patch,
  };
  db.prepare(
    `INSERT INTO fills (${Object.keys(row).join(",")}) VALUES (${Object.keys(
      row,
    )
      .map(() => "?")
      .join(",")})`,
  ).run(...Object.values(row));
}
function withDB(t, fn) {
  const db = setup();
  t.after(() => db.close());
  return fn(db);
}
test("migration creates 37 tables and valid foreign keys", (t) =>
  withDB(t, (db) => {
    assert.equal(
      db
        .prepare("SELECT count(*) AS n FROM sqlite_schema WHERE type='table'")
        .get().n,
      37,
    );
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  }));
test("database rejects order ownership and provider mismatch", (t) =>
  withDB(t, (db) => {
    for (const patch of [
      { user_id: "u2" },
      { account_id: "a2" },
      { market_id: "m2" },
      { connection_id: "c2" },
    ])
      assert.throws(() => insertOrder(db, patch), /FOREIGN KEY/);
    insertOrder(db);
    assert.equal(db.prepare("SELECT count(*) AS n FROM orders").get().n, 1);
  }));
test("same client request cannot create two orders", (t) =>
  withDB(t, (db) => {
    insertOrder(db);
    assert.throws(() => insertOrder(db, { id: "o2" }), /UNIQUE/);
    // Same request string for a genuinely different account is allowed.
    insertOrder(db, { id: "o2", user_id: "u2", account_id: "a2" });
  }));
test("database enforces integer prices, status/quantity and cancellation consistency", (t) =>
  withDB(t, (db) => {
    for (const patch of [
      { quantity: 1.5 },
      { limit_price_cents: 0 },
      { limit_price_cents: 100 },
      { status: "made_up" },
      { status: "filled", filled_quantity: 99 },
      { status: "partially_filled", filled_quantity: 0 },
      { filled_quantity: 101 },
      { status: "canceled", cancel_requested: 1 },
      { provider_revision: 1.5 },
    ])
      assert.throws(() => insertOrder(db, patch), /CHECK/);
    insertOrder(db, { status: "canceled", filled_quantity: 30 });
  }));
test("fills deduplicate provider identities and cannot attach to another account", (t) =>
  withDB(t, (db) => {
    insertOrder(db);
    insertFill(db);
    assert.throws(() => insertFill(db, { id: "f2" }), /UNIQUE/);
    assert.throws(
      () =>
        insertFill(db, {
          id: "f2",
          external_fill_id: "fill-2",
          account_id: "a2",
        }),
      /FOREIGN KEY/,
    );
    // Negative fees can represent an actual provider rebate.
    insertFill(db, { id: "f2", external_fill_id: "fill-2", fee_cents: -1 });
  }));
test("failed atomic write rolls back fill and order projection together", (t) =>
  withDB(t, (db) => {
    insertOrder(db);
    db.exec("BEGIN");
    try {
      insertFill(db);
      db.prepare(
        "UPDATE orders SET filled_quantity=101,status='filled' WHERE id='o1'",
      ).run();
      db.exec("COMMIT");
      assert.fail("must reject");
    } catch (error) {
      db.exec("ROLLBACK");
      assert.match(String(error), /CHECK/);
    }
    assert.equal(db.prepare("SELECT count(*) AS n FROM fills").get().n, 0);
    assert.equal(
      db.prepare("SELECT filled_quantity FROM orders WHERE id='o1'").get()
        .filled_quantity,
      0,
    );
  }));
test("provider events reject duplicate deliveries at the same connection", (t) =>
  withDB(t, (db) => {
    const insert = db.prepare(
      "INSERT INTO provider_events VALUES (?,?,?,?,?,?,?)",
    );
    insert.run("e1", "c1", "external-1", "hash", "{}", "received", time);
    assert.throws(
      () =>
        insert.run("e2", "c1", "external-1", "hash", "{}", "received", time),
      /UNIQUE/,
    );
    insert.run("e2", "c2", "external-1", "hash", "{}", "received", time);
  }));
test("balance snapshots preserve negative cash but not negative withdrawal limits", (t) =>
  withDB(t, (db) => {
    const insert = db.prepare(
      "INSERT INTO balance_snapshots VALUES (?,?,?,?,?,?,?,?,?,?)",
    );
    insert.run("b1", "a1", "USD", -100, 0, 0, 0, 1, time, time);
    assert.throws(
      () => insert.run("b2", "a1", "USD", 10, 0, -1, 0, 2, time, time),
      /CHECK/,
    );
    assert.throws(
      () => insert.run("b2", "a1", "USD", 10, 0, 0, 0, 1, time, time),
      /UNIQUE/,
    );
  }));
test("cash transfer scope and idempotency are enforced", (t) =>
  withDB(t, (db) => {
    const insert = db.prepare(
      "INSERT INTO cash_transfers (id,user_id,account_id,connection_id,client_transfer_id,request_hash,direction,amount_cents,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    );
    insert.run(
      "t1",
      "u1",
      "a1",
      "c1",
      "request-1",
      "hash",
      "deposit",
      100,
      time,
      time,
    );
    assert.throws(
      () =>
        insert.run(
          "t2",
          "u1",
          "a1",
          "c1",
          "request-1",
          "hash",
          "deposit",
          100,
          time,
          time,
        ),
      /UNIQUE/,
    );
    assert.throws(
      () =>
        insert.run(
          "t2",
          "u2",
          "a1",
          "c1",
          "request-2",
          "hash",
          "deposit",
          100,
          time,
          time,
        ),
      /FOREIGN KEY/,
    );
    assert.throws(
      () =>
        insert.run(
          "t2",
          "u1",
          "a1",
          "c1",
          "request-2",
          "hash",
          "withdrawal",
          -100,
          time,
          time,
        ),
      /CHECK/,
    );
  }));
test("position reservations cannot exceed holdings or cross a venue", (t) =>
  withDB(t, (db) => {
    const insert = db.prepare(
      "INSERT INTO position_snapshots VALUES (?,?,?,?,?,?,?,?,?,?)",
    );
    insert.run("p1", "a1", "c1", "u1", "m1", "yes", 100, 70, 1, time);
    assert.throws(
      () => insert.run("p2", "a1", "c1", "u1", "m1", "yes", 100, 101, 2, time),
      /CHECK/,
    );
    assert.throws(
      () => insert.run("p2", "a1", "c1", "u1", "m2", "yes", 100, 70, 2, time),
      /FOREIGN KEY/,
    );
  }));
test("records cannot be deleted out from under orders; user query uses its index", (t) =>
  withDB(t, (db) => {
    insertOrder(db);
    assert.throws(
      () => db.prepare("DELETE FROM linked_accounts WHERE id='a1'").run(),
      /FOREIGN KEY/,
    );
    const plan = db
      .prepare(
        "EXPLAIN QUERY PLAN SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC",
      )
      .all("u1");
    assert.ok(plan.some((r) => r.detail.includes("idx_orders_user_created")));
  }));

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import {
  setup,
  startPractice,
  placePractice,
  practiceAccount,
  now,
  eventId,
  order,
} from "./helpers/practice.mjs";
const bundle = await build({
  entryPoints: [
    new URL("../lib/practice/matching.ts", import.meta.url).pathname,
  ],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { matchEvent, fillAmounts } = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundle.outputFiles[0].text).toString("base64")
);
const actor = (id) => ({
  userId: id,
  email: id + "@example.test",
  displayName: id,
});
async function funded() {
  const s = setup();
  for (const id of ["a", "b", "c", "d"]) await startPractice(s.db, actor(id));
  return s;
}
function audit(sql) {
  for (const row of sql.prepare("SELECT * FROM practice_cash").all()) {
    const ledger = sql
      .prepare(
        "SELECT COALESCE(sum(available_delta_units),0) a,COALESCE(sum(reserved_delta_units),0) r FROM practice_cash_entries WHERE user_id=?",
      )
      .get(row.user_id);
    const fills = sql
      .prepare(
        "SELECT COALESCE(sum(released_units),0) a,COALESCE(sum(reserved_debit_units),0) r,COALESCE(sum(principal_units+fee_units),0) s FROM practice_match_entries WHERE user_id=?",
      )
      .get(row.user_id);
    assert.equal(row.available_units, ledger.a + fills.a);
    assert.equal(row.reserved_units, ledger.r - fills.r);
    assert.equal(row.spent_units, fills.s);
    assert.equal(
      row.available_units + row.reserved_units + row.spent_units,
      40000000,
    );
  }
  for (const m of sql.prepare("SELECT * FROM practice_matches").all()) {
    const e = sql
      .prepare(
        "SELECT sum(principal_units) p,count(*) n FROM practice_match_entries WHERE match_id=?",
      )
      .get(m.id);
    assert.equal(e.n, 2);
    assert.equal(e.p, m.quantity * 40000);
  }
}
test("YES+NO fills cost exactly $1, per-contract sub-cent fee, price improvement and partial remainder", async () => {
  const { db, sql, a, b } = await funded();
  const yes = await placePractice(db, a, order({ quantity: 3 }), now);
  const input = order({ outcome: "no", limitPriceCents: 60, quantity: 2 });
  const no = await placePractice(db, b, input, now);
  assert.equal(no.order.filled_quantity, 2);
  assert.equal(no.order.remaining_quantity, 0);
  assert.equal(no.order.heldCents, 0);
  assert.equal(no.order.executedPrincipalCents, 80);
  assert.equal(no.order.chargedFeeCents, 0.2);
  const first = (await practiceAccount(db, a)).orders[0];
  assert.equal(first.filled_quantity, 2);
  assert.equal(first.remaining_quantity, 1);
  assert.equal(first.heldCents, 60.15);
  assert.equal((await practiceAccount(db, b)).fills[0].releasedCents, 40.1);
  await placePractice(db, b, input, now);
  await matchEvent(db, eventId, now);
  assert.equal(
    sql.prepare("SELECT count(*) n FROM practice_matches").get().n,
    1,
  );
  audit(sql);
});
test("maker best price wins; equal prices use acceptance order", async () => {
  for (const equal of [false, true]) {
    const { db, sql, a, b } = await funded();
    const x = await placePractice(
      db,
      a,
      order({ limitPriceCents: equal ? 60 : 50, quantity: 1 }),
      now,
    );
    const y = await placePractice(
      db,
      b,
      order({ limitPriceCents: 60, quantity: 1 }),
      now,
    );
    await placePractice(
      db,
      actor("c"),
      order({ outcome: "no", limitPriceCents: 50, quantity: 1 }),
      now,
    );
    assert.equal(
      sql.prepare("SELECT maker_id FROM practice_matches").get().maker_id,
      equal ? x.order.id : y.order.id,
    );
    audit(sql);
  }
});
test("uncrossed orders and self trades remain unfilled", async () => {
  const { db, sql, a, b } = await funded();
  await placePractice(db, a, order({ limitPriceCents: 40, quantity: 1 }), now);
  await placePractice(
    db,
    b,
    order({ outcome: "no", limitPriceCents: 59, quantity: 1 }),
    now,
  );
  assert.equal(
    sql.prepare("SELECT count(*) n FROM practice_matches").get().n,
    0,
  );
  await placePractice(
    db,
    a,
    order({ outcome: "no", limitPriceCents: 99, quantity: 1 }),
    now,
  );
  assert.equal(
    sql.prepare("SELECT count(*) n FROM practice_matches").get().n,
    0,
  );
  audit(sql);
});
test("concurrent takers and matching retries never overfill a maker", async () => {
  const { db, sql, a, b } = await funded();
  await placePractice(db, a, order({ quantity: 7 }), now);
  await Promise.all([
    placePractice(
      db,
      b,
      order({ outcome: "no", limitPriceCents: 40, quantity: 7 }),
      now,
    ),
    placePractice(
      db,
      actor("c"),
      order({ outcome: "no", limitPriceCents: 40, quantity: 7 }),
      now,
    ),
    matchEvent(db, eventId, now),
  ]);
  assert.equal(
    sql.prepare("SELECT sum(quantity) q FROM practice_matches").get().q,
    7,
  );
  await Promise.all([
    matchEvent(db, eventId, now),
    matchEvent(db, eventId, now),
  ]);
  assert.equal(
    sql.prepare("SELECT sum(quantity) q FROM practice_matches").get().q,
    7,
  );
  audit(sql);
});
test("a failed settlement rolls back both sides", async () => {
  const s = await funded();
  await placePractice(s.db, s.a, order({ quantity: 2 }), now);
  s.injectMatch();
  await assert.rejects(
    placePractice(
      s.db,
      s.b,
      order({ outcome: "no", limitPriceCents: 40, quantity: 1 }),
      now,
    ),
  );
  assert.equal(
    s.sql.prepare("SELECT count(*) n FROM practice_matches").get().n,
    0,
  );
  assert.equal(
    s.sql
      .prepare("SELECT sum(filled_quantity) n FROM practice_order_progress")
      .get().n,
    0,
  );
  audit(s.sql);
});
test("partial expiry releases only remaining reservation and keeps fills and paid fees", async () => {
  const { db, sql, a, b } = await funded();
  await placePractice(db, a, order({ quantity: 3 }), now);
  await placePractice(
    db,
    b,
    order({ outcome: "no", limitPriceCents: 40, quantity: 1 }),
    now,
  );
  const state = await practiceAccount(db, a, 0, now + 86400001);
  assert.equal(state.orders[0].status, "expired");
  assert.equal(state.orders[0].filled_quantity, 1);
  assert.equal(state.orders[0].heldCents, 0);
  assert.equal(state.wallet.spentCents, 60.15);
  assert.equal(state.wallet.availableCents, 99939.85);
  await practiceAccount(db, a, 0, now + 86400001);
  audit(sql);
});
test("every allowed price uses exact integer fee units independent of fill splitting", () => {
  for (let p = 1; p < 100; p++) {
    let x = {
      quantity: 17,
      price: p,
      filled: 0,
      principal: 0,
      fee: 0,
      held: p * 17 * 401,
      revision: 0,
    };
    for (let i = 0; i < 17; i++) {
      const a = fillAmounts(x, p, 1);
      x = {
        ...x,
        filled: a.filled,
        principal: a.executed,
        fee: a.charged,
        held: a.held,
      };
    }
    assert.equal(x.fee, p * 17);
    assert.equal(x.held, 0);
  }
});
test("Day 10 upgrade preserves open order, reservation and original fee agreement", async () => {
  const { db, sql, a, b } = setup(true),
    id = crypto.randomUUID();
  sql
    .prepare("INSERT INTO practice_wallets VALUES (?,?,?,?,?)")
    .run("a", 99999, 1, "grant-old", new Date(now).toISOString());
  sql
    .prepare("INSERT INTO practice_ledger VALUES (?,?,?,?,?,?,?)")
    .run(
      "grant-old",
      "a",
      null,
      "grant",
      100000,
      0,
      new Date(now).toISOString(),
    );
  sql
    .prepare(
      "INSERT INTO practice_orders (id,user_id,event_id,client_id,intent_json,event_revision,event_title,outcome,price_cents,quantity,principal_cents,fee_cents,total_cents,status,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      "a",
      eventId,
      crypto.randomUUID(),
      "{}",
      1,
      "Legacy test",
      "yes",
      1,
      1,
      1,
      0,
      1,
      "open",
      "2099-01-01T00:00:00.000Z",
      new Date(now).toISOString(),
    );
  sql
    .prepare("INSERT INTO practice_ledger VALUES (?,?,?,?,?,?,?)")
    .run("reserve-old", "a", id, "reserve", -1, 1, new Date(now).toISOString());
  sql.exec(
    readFileSync(
      new URL("../drizzle/0006_secret_swordsman.sql", import.meta.url),
      "utf8",
    ),
  );
  const before = await practiceAccount(db, a);
  assert.equal(before.wallet.availableCents, 99999);
  assert.equal(before.orders[0].status, "open");
  assert.equal(before.orders[0].feePolicy, "legacy_order");
  await startPractice(db, b);
  await placePractice(
    db,
    b,
    order({ outcome: "no", limitPriceCents: 99, quantity: 1 }),
    now,
  );
  assert.equal((await practiceAccount(db, a)).orders[0].chargedFeeCents, 0);
  assert.equal(
    (await practiceAccount(db, b)).orders[0].chargedFeeCents,
    0.2475,
  );
  audit(sql);
});
test("smallest per-contract fee remains nonzero and exact", async () => {
  const { db, sql, a, b } = await funded();
  await placePractice(db, a, order({ limitPriceCents: 1, quantity: 1 }), now);
  await placePractice(
    db,
    b,
    order({ outcome: "no", limitPriceCents: 99, quantity: 1 }),
    now,
  );
  const d = await practiceAccount(db, a);
  assert.equal(d.orders[0].chargedFeeCents, 0.0025);
  assert.equal(d.wallet.spentCents, 1.0025);
  audit(sql);
});
test("bounded matching can continue safely across multiple requests", async () => {
  const { db, sql, a, b } = await funded();
  for (let i = 0; i < 6; i++)
    await placePractice(db, a, order({ quantity: 1 }), now);
  await placePractice(
    db,
    b,
    order({ outcome: "no", limitPriceCents: 40, quantity: 6 }),
    now,
  );
  assert.equal(
    sql.prepare("SELECT sum(quantity) n FROM practice_matches").get().n,
    4,
  );
  await matchEvent(db, eventId, now);
  assert.equal(
    sql.prepare("SELECT sum(quantity) n FROM practice_matches").get().n,
    6,
  );
  audit(sql);
});
test("matching transaction rechecks event visibility after candidate read", async () => {
  const { db, sql, a, b } = await funded();
  await placePractice(db, a, order({ quantity: 1 }), now);
  const realBatch = db.batch;
  let intercepted = false;
  db.batch = async (stmts) => {
    if (
      !intercepted &&
      stmts[0].query.includes("INSERT INTO practice_matches")
    ) {
      intercepted = true;
      sql.prepare("UPDATE own_events SET status='archived'").run();
    }
    return realBatch(stmts);
  };
  await placePractice(
    db,
    b,
    order({ outcome: "no", limitPriceCents: 40, quantity: 1 }),
    now,
  );
  assert.equal(intercepted, true);
  assert.equal(
    sql.prepare("SELECT count(*) n FROM practice_matches").get().n,
    0,
  );
  audit(sql);
});

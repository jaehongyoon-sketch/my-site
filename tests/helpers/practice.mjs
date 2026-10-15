import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { build } from "esbuild";
const b = await build({
  entryPoints: [
    new URL("../../lib/practice/service.ts", import.meta.url).pathname,
  ],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { startPractice, placePractice, practiceAccount, cancelPractice } =
  await import(
    "data:text/javascript;base64," +
      Buffer.from(b.outputFiles[0].text).toString("base64")
  );
const now = Date.now(),
  deadline = new Date(now + 86400000).toISOString(),
  eventId = crypto.randomUUID();
const intent = (extra = {}) => ({
  eventId,
  eventRevision: 1,
  side: "buy",
  orderType: "limit",
  timeInForce: "until-close",
  outcome: "yes",
  limitPriceCents: 60,
  quantity: 100,
  ...extra,
});
const order = (extra = {}) => ({
  clientOrderId: crypto.randomUUID(),
  intent: intent(extra),
});
function setup(legacy = false) {
  const sql = new DatabaseSync(":memory:");
  sql.exec("PRAGMA foreign_keys=ON");
  for (const f of readdirSync(new URL("../../drizzle/", import.meta.url))
    .filter(
      (f) =>
        f.endsWith(".sql") &&
        (!legacy || (!f.startsWith("0006") && !f.startsWith("0010"))),
    )
    .sort())
    sql.exec(
      readFileSync(new URL("../../drizzle/" + f, import.meta.url), "utf8"),
    );
  for (const id of ["a", "b", "c", "d"])
    sql
      .prepare("INSERT INTO app_users VALUES (?,?,?,?)")
      .run(id, "google:" + id, "active", new Date(now).toISOString());
  sql
    .prepare("INSERT INTO own_events VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run(
      eventId,
      "Will the test happen?",
      "Science",
      "A valid test rule with a published source.",
      "https://example.org",
      deadline,
      "published",
      1,
      "a",
      new Date(now).toISOString(),
      new Date(now).toISOString(),
    );
  let failLedger = false,
    failMatch = false;
  const db = {
    prepare(q) {
      let args = [];
      return {
        query: q,
        bind(...a) {
          args = a;
          return this;
        },
        async first() {
          return sql.prepare(q).get(...args) ?? null;
        },
        async all() {
          return { results: sql.prepare(q).all(...args) };
        },
        runSync() {
          if (/^\s*(SELECT|WITH)\b/i.test(q))
            return {
              results: sql.prepare(q).all(...args),
              meta: { changes: 0 },
            };
          if (failMatch && q.includes("INSERT INTO practice_match_entries"))
            throw Error("injected match failure");
          if (failLedger && q.includes("':reserve'"))
            throw Error("injected ledger failure");
          return {
            meta: { changes: Number(sql.prepare(q).run(...args).changes) },
          };
        },
      };
    },
    async batch(stmts) {
      sql.exec("BEGIN");
      try {
        const results = stmts.map((s) => s.runSync());
        sql.exec("COMMIT");
        return results;
      } catch (e) {
        sql.exec("ROLLBACK");
        throw e;
      }
    },
  };
  return {
    db,
    sql,
    a: { userId: "a", email: "a@example.test", displayName: "A" },
    b: { userId: "b", email: "b@example.test", displayName: "B" },
    injectMatch: () => {
      failMatch = true;
    },
    inject: () => {
      failLedger = true;
    },
  };
}

export {
  setup,
  cancelPractice,
  startPractice,
  placePractice,
  practiceAccount,
  now,
  eventId,
  order,
};

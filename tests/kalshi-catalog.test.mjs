import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCatalog,
  createCatalogLoader,
} from "../lib/providers/kalshi/catalog.ts";
const now = Date.parse("2026-10-11T00:00:00Z");
const market = {
  status: "active",
  close_time: "2027-01-01T00:00:00Z",
  yes_ask_dollars: "0.0000",
  no_ask_dollars: "1.0000",
};
const event = {
  event_ticker: "TEST-27",
  series_ticker: "TEST",
  title: "Test event",
  category: "Economics",
  markets: [market],
};
test("preserves zero asks and uses the documented fixed-host series link", () => {
  const [e] = normalizeCatalog({ events: [event] }, now);
  assert.equal(e.yesAsk, "0.0000");
  assert.equal(e.category, "Economy");
  assert.equal(e.externalUrl, "https://kalshi.com/markets/test");
});
test("does not present a component price as the price of a multi-market event", () => {
  const [e] = normalizeCatalog(
    { events: [{ ...event, markets: [market, market] }] },
    now,
  );
  assert.equal(e.marketCount, 2);
  assert.equal(e.yesAsk, null);
});
test("rejects invalid and expired entries and deduplicates event tickers", () => {
  assert.equal(
    normalizeCatalog(
      {
        events: [
          event,
          event,
          { ...event, event_ticker: "https://bad.test" },
          {
            ...event,
            event_ticker: "CLOSED",
            markets: [{ ...market, status: "settled" }],
          },
        ],
      },
      now,
    ).length,
    1,
  );
});
test("coalesces fetches and caches briefly without credentials", async () => {
  let calls = 0;
  let time = now;
  const load = createCatalogLoader(
    async (url, options) => {
      calls++;
      assert.equal(options.credentials, "omit");
      assert.equal(options.method, "GET");
      return Response.json({ events: [event] });
    },
    () => time,
  );
  await Promise.all([load(), load()]);
  assert.equal(calls, 1);
  await load();
  assert.equal(calls, 1);
  time += 61000;
  await load();
  assert.equal(calls, 2);
});
test("upstream errors back off and never serve old quotes as fresh", async () => {
  let calls = 0;
  let time = now;
  const load = createCatalogLoader(
    async () => {
      calls++;
      return calls === 1
        ? Response.json({ events: [event] })
        : new Response("", { status: 429 });
    },
    () => time,
  );
  await load();
  time += 61000;
  await assert.rejects(load);
  await assert.rejects(load);
  assert.equal(calls, 2);
});

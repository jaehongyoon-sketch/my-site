import test from "node:test";
import assert from "node:assert/strict";
import { createKalshiReadClient } from "../lib/providers/kalshi/read-client.ts";
// Synthetic values only: no Kalshi data is fetched or redistributed by these tests.
const market = {
  ticker: "TEST-YES",
  event_ticker: "TEST",
  market_type: "binary",
  title: "Synthetic test question?",
  status: "active",
  close_time: "2027-01-01T00:00:00Z",
  yes_ask_dollars: "0.1234",
  no_ask_dollars: "0.8800",
  rules_primary: "Synthetic rules.",
};
const json = (value) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
const client = (payload) =>
  createKalshiReadClient({ fetcher: async () => json(payload) });
test("read-only requests target fixed origin and encode pagination without auth", async () => {
  const c = createKalshiReadClient({
    fetcher: async (url, init) => {
      const u = new URL(url);
      assert.equal(u.origin, "https://external-api.kalshi.com");
      assert.equal(u.pathname, "/trade-api/v2/markets");
      assert.equal(u.searchParams.get("status"), "open");
      assert.equal(u.searchParams.get("cursor"), "a&status=closed");
      assert.equal(init.method, "GET");
      assert.equal(init.credentials, "omit");
      assert.equal(init.redirect, "manual");
      assert.deepEqual(init.headers, { Accept: "application/json" });
      return json({ markets: [market], cursor: "next" });
    },
  });
  const result = await c.listMarkets({ limit: 10, cursor: "a&status=closed" });
  assert.equal(result.nextCursor, "next");
  assert.equal(result.markets[0].yesAskDollars, "0.1234");
});
test("missing quotes remain null; zero is retained", async () => {
  const result = await client({
    market: { ...market, yes_ask_dollars: undefined, no_ask_dollars: "0.0000" },
  }).getMarket("TEST-YES");
  assert.equal(result.yesAskDollars, null);
  assert.equal(result.noAskDollars, "0.0000");
});
test("empty page and empty cursor are valid", async () => {
  assert.deepEqual(await client({ markets: [], cursor: "" }).listMarkets(), {
    markets: [],
    nextCursor: null,
  });
});
test("invalid query and path never call the transport", async () => {
  let calls = 0;
  const c = createKalshiReadClient({
    fetcher: async () => {
      calls++;
      return json({});
    },
  });
  for (const input of [
    { limit: 0 },
    { limit: 101 },
    { limit: 1.5 },
    { cursor: "" },
    { extra: true },
  ])
    await assert.rejects(c.listMarkets(input));
  await assert.rejects(c.getMarket("../portfolio/orders"));
  assert.equal(calls, 0);
});
test("rejects unsupported contracts and invalid price/date data", async () => {
  for (const patch of [
    { market_type: "scalar" },
    { yes_ask_dollars: 0.5 },
    { yes_ask_dollars: "1.01" },
    { yes_ask_dollars: "0.12345" },
    { close_time: "bad" },
    { ticker: "" },
  ])
    await assert.rejects(
      client({ market: { ...market, ...patch } }).getMarket("TEST"),
      { code: "INVALID_RESPONSE" },
    );
});
test("rejects malformed and oversized pages", async () => {
  for (const payload of [
    { markets: null },
    { markets: [market, {}] },
    { markets: Array(101).fill(market) },
  ])
    await assert.rejects(client(payload).listMarkets(), {
      code: "INVALID_RESPONSE",
    });
});
test("rate limit is surfaced without automatic retry", async () => {
  let calls = 0;
  const c = createKalshiReadClient({
    fetcher: async () => {
      calls++;
      return new Response("", {
        status: 429,
        headers: { "Retry-After": "30" },
      });
    },
  });
  await assert.rejects(c.listMarkets(), {
    code: "HTTP_ERROR",
    status: 429,
    retryAfter: "30",
  });
  assert.equal(calls, 1);
});
test("HTTP failures do not become empty or sample markets", async () => {
  await assert.rejects(
    createKalshiReadClient({
      fetcher: async () => new Response("", { status: 503 }),
    }).listMarkets(),
    { code: "HTTP_ERROR", status: 503 },
  );
});
test("invalid JSON has explicit failure", async () => {
  await assert.rejects(
    createKalshiReadClient({
      fetcher: async () => new Response("invalid"),
    }).listMarkets(),
    { code: "INVALID_RESPONSE" },
  );
});
test("network and timeout errors are distinct", async () => {
  await assert.rejects(
    createKalshiReadClient({
      fetcher: async () => {
        throw new Error("private diagnostics");
      },
    }).listMarkets(),
    { code: "NETWORK_ERROR" },
  );
  const c = createKalshiReadClient({
    timeoutMs: 5,
    fetcher: async (_, init) =>
      new Promise((_, reject) =>
        init.signal.addEventListener("abort", () =>
          reject(new Error("aborted")),
        ),
      ),
  });
  await assert.rejects(c.listMarkets(), { code: "TIMEOUT" });
});
test("detail endpoint maps rules without fabricating price history", async () => {
  const result = await client({
    market: { ...market, rules_secondary: "More rules." },
  }).getMarket("TEST");
  assert.equal(result.rules, "Synthetic rules.\n\nMore rules.");
  assert.equal("history" in result, false);
});

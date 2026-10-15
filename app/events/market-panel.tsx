"use client";
import { useEffect, useState } from "react";
import { marketStateSchema, type MarketState } from "@/lib/events/market-state";
import { Button } from "@/components/ui/button";
const messages = {
  EVENT_HIDDEN: "This event is no longer published.",
  EVENT_CLOSED: "The event has closed. Its result has not been determined.",
  EVENT_INVALID: "The event status needs review.",
  PRICE_UNAVAILABLE:
    "No price feed is connected. Prices will appear when the Event order book is available.",
  PRICE_STALE: "Prices are out of date. Waiting for a new snapshot.",
  PRICE_INVALID: "The latest prices could not be verified.",
  EXECUTION_UNAVAILABLE: "Order acceptance is not connected yet.",
};
export default function MarketPanel({ initial }: { initial: MarketState }) {
  const [data, setData] = useState<MarketState | null>(initial),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [elapsed, setElapsed] = useState(0),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let stopped = false,
      inFlight = false;
    let controller: AbortController | null = null;
    let receivedAt = performance.now();
    async function refresh() {
      if (stopped || inFlight || document.hidden) return;
      inFlight = true;
      controller = new AbortController();
      setBusy(true);
      const timeout = setTimeout(() => controller?.abort(), 8000);
      try {
        const r = await fetch(`/api/events/${initial.eventId}/market-state`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!r.ok)
          throw new Error(
            r.status === 404
              ? "This event is no longer available."
              : "Status check failed. Prices are hidden until the connection recovers.",
          );
        const next = marketStateSchema.parse(await r.json());
        if (next.eventId !== initial.eventId)
          throw new Error("Unexpected event status.");
        if (!stopped) {
          setData(next);
          setError("");
          receivedAt = performance.now();
          setElapsed(0);
        }
      } catch (e) {
        if (!stopped) {
          setData(null);
          setError(
            e instanceof Error && e.name !== "AbortError"
              ? e.message
              : "Connection timed out. Please retry.",
          );
        }
      } finally {
        clearTimeout(timeout);
        inFlight = false;
        if (!stopped) setBusy(false);
      }
    }
    const tick = setInterval(
      () => setElapsed(performance.now() - receivedAt),
      1000,
    );
    const poll = setInterval(() => void refresh(), 15000);
    const resume = () => {
      if (!document.hidden) {
        setData(null);
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", resume);
    const offline = () => {
      controller?.abort();
      setData(null);
      setError("You are offline. Reconnect to check event status.");
    };
    window.addEventListener("offline", offline);
    window.addEventListener("online", resume);
    void refresh();
    return () => {
      stopped = true;
      controller?.abort();
      clearInterval(tick);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", offline);
    };
  }, [initial.eventId, retry]);
  const serverNow = data ? Date.parse(data.checkedAt) + elapsed : 0;
  const closed =
    !!data &&
    (data.phase === "closed" || Date.parse(data.closesAt) <= serverNow);
  const stale =
    !!data?.priceValidUntil && Date.parse(data.priceValidUntil) <= serverNow;
  const showPrices =
    !!data &&
    !closed &&
    !stale &&
    data.phase === "upcoming" &&
    data.pricing === "fresh";
  const code = closed
    ? "EVENT_CLOSED"
    : stale
      ? "PRICE_STALE"
      : data?.blockCode;
  const price = (value: number | null | undefined) =>
    showPrices && value != null ? `${value}¢` : "—";
  return (
    <section className="account-card market-status-panel" aria-busy={busy}>
      <div className="market-status-heading">
        <div>
          <p className="eyebrow">MARKET STATUS</p>
          <h2>
            {error
              ? "Status unavailable"
              : closed
                ? "Closed · Awaiting result"
                : "Live trading not available"}
          </h2>
        </div>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => setRetry((v) => v + 1)}
        >
          {busy ? "Checking…" : "Refresh status"}
        </Button>
      </div>
      <p role={error ? "alert" : "status"}>
        {error || (code ? messages[code] : "Checking current event status…")}
      </p>
      <div className="event-price-grid">
        <div>
          <span>YES price</span>
          <strong>{price(data?.yesAskCents)}</strong>
        </div>
        <div>
          <span>NO price</span>
          <strong>{price(data?.noAskCents)}</strong>
        </div>
      </div>
      <p className="account-caption">
        A dash means no verified price. It does not mean 0¢ or a 50% chance.
      </p>
      <dl className="market-status-facts">
        <div>
          <dt>Price source</dt>
          <dd>
            {data?.priceSource === "event-orderbook"
              ? "Event order book"
              : "Not connected"}
          </dd>
        </div>
        <div>
          <dt>Price updated</dt>
          <dd>
            {data?.priceAsOf
              ? data.priceAsOf.replace("T", " ").slice(0, 19) + " UTC"
              : "No price received"}
          </dd>
        </div>
        <div>
          <dt>Status checked</dt>
          <dd>
            {data
              ? data.checkedAt.replace("T", " ").slice(0, 19) + " UTC"
              : "Not confirmed"}
          </dd>
        </div>
        <div>
          <dt>App trading fee</dt>
          <dd>0.25% of contract cost · Not charged yet</dd>
        </div>
      </dl>
      <Button disabled className="market-disabled-order">
        {closed ? "Event closed" : "Live orders unavailable"}
      </Button>
      <p className="account-caption">
        Status checks every 15 seconds while this page is visible. No order or
        payment is submitted.
      </p>
    </section>
  );
}

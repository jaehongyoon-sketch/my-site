"use client";
import { useEffect, useState } from "react";
import { marketDataSchema, type MarketData } from "@/lib/practice/market";
import { Button } from "@/components/ui/button";
export default function MarketPanel({ eventId }: { eventId: string }) {
  const [data, setData] = useState<MarketData | null>(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let stopped = false,
      pending = false;
    const controller = new AbortController();
    async function refresh() {
      if (pending || document.hidden || stopped) return;
      pending = true;
      try {
        const response = await fetch(`/api/events/${eventId}/market`, {
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(8000),
          ]),
        });
        if (!response.ok)
          throw Error("Unable to refresh market. Please retry.");
        const next = marketDataSchema.parse(await response.json());
        if (next.eventId !== eventId)
          throw Error("Unexpected market response.");
        if (!stopped) {
          setData(next);
          setError("");
        }
      } catch {
        if (!stopped) {
          setData(null);
          setError("Market connection unavailable. Please retry.");
        }
      } finally {
        pending = false;
      }
    }
    const offline = () => {
      setData(null);
      setError("Offline. Reconnect to refresh prices.");
    };
    const timer = setInterval(() => void refresh(), 5000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("market-order-updated", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("offline", offline);
    void refresh();
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("market-order-updated", refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", offline);
    };
  }, [eventId, retry]);
  const last = data?.lastYesCents,
    previous = data?.previousYesCents;
  const change = last != null && previous != null ? last - previous : null;
  const trades = data?.trades ?? [];
  const start = Date.parse(trades[0]?.at ?? ""),
    end = Date.parse(trades.at(-1)?.at ?? "");
  const x = (i: number) =>
    end > start
      ? 10 + (580 * (Date.parse(trades[i].at) - start)) / (end - start)
      : 10 + (580 * i) / Math.max(1, trades.length - 1);
  const path = trades
    .map((t, i) => `${x(i)},${210 - t.yesCents * 2}`)
    .join(" ");
  function choose(outcome: "yes" | "no", price: number) {
    window.dispatchEvent(
      new CustomEvent("market-price-selected", {
        detail: { eventId, outcome, price },
      }),
    );
    document
      .getElementById("order-entry")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  return (
    <section className="account-card exchange-panel" aria-label="Event market">
      <div className="market-status-heading">
        <div>
          <h2>{data?.closed ? "Market closed" : "Market"}</h2>
          <p className="account-caption">
            Virtual funds · Updates every 5 seconds
          </p>
        </div>
        <Button variant="outline" onClick={() => setRetry((v) => v + 1)}>
          Refresh
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          {data.paused && <p role="status">Trading is paused.</p>}
          <div className="exchange-price">
            <strong>{last == null ? "—" : `${last}¢`}</strong>
            <span>YES · Last trade</span>
            {change != null && (
              <span className={change >= 0 ? "price-up" : "price-down"}>
                {change > 0 ? "+" : ""}
                {change}¢ since previous trade
              </span>
            )}
          </div>
          {trades.length ? (
            <>
              <svg
                viewBox="0 0 620 230"
                className="price-chart"
                role="img"
                aria-label={`YES trade history, ${trades.length} most recent trades. Latest price ${last} cents.`}
              >
                {[0, 50, 100].map((v) => (
                  <g key={v}>
                    <line
                      x1="10"
                      x2="590"
                      y1={210 - v * 2}
                      y2={210 - v * 2}
                      stroke="currentColor"
                      opacity="0.12"
                    />
                    <text
                      x="595"
                      y={214 - v * 2}
                      fontSize="10"
                      fill="currentColor"
                    >
                      {v}¢
                    </text>
                  </g>
                ))}
                <polyline
                  points={path}
                  fill="none"
                  stroke="#187754"
                  strokeWidth="3"
                />
                {trades.map((t, i) => (
                  <circle
                    key={t.id}
                    cx={x(i)}
                    cy={210 - t.yesCents * 2}
                    r={trades.length === 1 ? 4 : 2}
                    fill="#187754"
                  >
                    <title>
                      {t.at} · YES {t.yesCents}¢ · {t.quantity} contracts
                    </title>
                  </circle>
                ))}
              </svg>
              <div className="chart-dates">
                <time>{trades[0].at.replace("T", " ").slice(0, 19)} UTC</time>
                <time>
                  {trades.at(-1)?.at.replace("T", " ").slice(0, 19)} UTC
                </time>
              </div>
            </>
          ) : (
            <p className="exchange-empty">
              No trades yet. Place a limit order to open the market.
            </p>
          )}
          <p className="account-caption">
            {data.volume.toLocaleString()} matched pairs ·{" "}
            {data.lastTradedAt
              ? `Last traded ${data.lastTradedAt.replace("T", " ").slice(0, 19)} UTC`
              : "Awaiting first trade"}
          </p>
          {!data.closed && (
            <div className="exchange-books">
              {(["yes", "no"] as const).map((outcome) => {
                const opposing = data.bids
                  .filter((b) => b.outcome !== outcome)
                  .slice(0, 5);
                return (
                  <div key={outcome}>
                    <h3>Buy {outcome.toUpperCase()}</h3>
                    {opposing.length ? (
                      <table>
                        <thead>
                          <tr>
                            <th>Price</th>
                            <th>Contracts</th>
                          </tr>
                        </thead>
                        <tbody>
                          {opposing.map((b) => (
                            <tr key={b.price}>
                              <td>
                                <button
                                  type="button"
                                  disabled={data.paused}
                                  onClick={() => choose(outcome, 100 - b.price)}
                                >
                                  {100 - b.price}¢
                                </button>
                              </td>
                              <td>{b.quantity.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p>No matching orders</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <p className="account-caption">
            Prices come from matched YES/NO orders. A pair totals $1 before
            fees. Available quantities may change; your own orders cannot match
            each other.
          </p>
          <details>
            <summary>Recent trades</summary>
            <div className="trade-table">
              <table>
                <thead>
                  <tr>
                    <th>Time (UTC)</th>
                    <th>YES</th>
                    <th>NO</th>
                    <th>Contracts</th>
                  </tr>
                </thead>
                <tbody>
                  {[...trades]
                    .reverse()
                    .slice(0, 20)
                    .map((t) => (
                      <tr key={t.id}>
                        <td>{t.at.replace("T", " ").slice(0, 19)}</td>
                        <td>{t.yesCents}¢</td>
                        <td>{100 - t.yesCents}¢</td>
                        <td>{t.quantity}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}

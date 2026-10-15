"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { readTradeEvents, TradeEvent } from "@/lib/trade-events/service";
type Data = Awaited<ReturnType<typeof readTradeEvents>>;
const labels: Record<TradeEvent["kind"], string> = {
  buy_accepted: "Buy order accepted",
  buy_filled: "Buy order filled",
  buy_released: "Unfilled buy reservation released",
  sell_reserved: "Sell contracts reserved",
  sell_released: "Sell reservation released",
};
export default function EventsPanel() {
  const [data, setData] = useState<Data | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const seq = useRef(0),
    locked = useRef(false);
  async function load(sync = false, page = 0) {
    if (locked.current) return;
    locked.current = true;
    const n = ++seq.current;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(
        "/api/practice/events" + (sync ? "" : "?page=" + page),
        {
          method: sync ? "POST" : "GET",
          headers: sync ? { "Content-Type": "application/json" } : {},
          body: sync ? JSON.stringify({ action: "sync" }) : undefined,
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        },
      );
      const d = (await r.json()) as Data & { error?: string };
      if (!r.ok) throw Error(d.error ?? "Unable to load activity.");
      if (n === seq.current) setData(d);
    } catch (e) {
      if (n === seq.current)
        setError(
          e instanceof Error && e.name !== "TimeoutError"
            ? e.message
            : "Processing was not confirmed. Retry safely; events cannot be applied twice.",
        );
    } finally {
      if (n === seq.current) {
        locked.current = false;
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    void load();
    return () => {
      seq.current++;
      locked.current = false;
    };
  }, []);
  return (
    <>
      <div className="event-actions">
        <Button disabled={busy} onClick={() => load(true)}>
          {busy
            ? "Loading…"
            : data?.hasMoreToSync
              ? "Process next batch"
              : "Sync latest activity"}
        </Button>
        <Button
          disabled={busy}
          variant="outline"
          onClick={() => load(false, data?.page ?? 0)}
        >
          Refresh history
        </Button>
        <a href="/practice/activity">Cash activity</a>
      </div>
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
      <p className="account-caption">
        Use Sync to collect and process saved trade records. Each request
        collects up to 100 records and processes up to 50. This page does not
        run a background worker. Older records are included; syncing is safe to
        repeat.
      </p>
      {data && (
        <>
          <dl className="market-status-facts account-card">
            <div>
              <dt>Trade records not yet collected</dt>
              <dd>{data.counts.unrecorded}</dd>
            </div>
            <div>
              <dt>Waiting for history processing</dt>
              <dd>{data.counts.pending}</dd>
            </div>
            <div>
              <dt>Processed records</dt>
              <dd>{data.counts.processed}</dd>
            </div>
          </dl>
          <p role="status">
            {data.hasMoreToSync
              ? "More records remain. Process the next batch to continue."
              : "History matches the saved trade records checked in this request."}
          </p>
          <p className="account-caption">
            “Processed” means added to this history, not a new trade execution.
            Fills and balances are recorded by the trading system before this
            history is processed. Records sharing a timestamp have a stable
            display order, not an execution sequence.
          </p>
          {!data.events.length && (
            <p>
              No recorded activity on this page. If records remain above, select
              Process next batch.
            </p>
          )}
          {data.events.map((e) => (
            <article className="account-card practice-order" key={e.id}>
              <p className="eyebrow">
                {labels[e.kind]} · {e.processedAt ? "Processed" : "Waiting"}
              </p>
              <h2>{e.eventTitle}</h2>
              <p>
                {e.quantity} {e.outcome.toUpperCase()} contracts
              </p>
              <p className="account-caption">
                Occurred: {new Date(e.occurredAt).toLocaleString()}
                <br />
                Recorded: {new Date(e.recordedAt).toLocaleString()}
                {e.processedAt && (
                  <>
                    <br />
                    Processed: {new Date(e.processedAt).toLocaleString()}
                  </>
                )}
                <br />
                Record: {e.id}
              </p>
            </article>
          ))}
          <div className="event-actions">
            <Button
              disabled={busy || data.page === 0}
              onClick={() => load(false, data.page - 1)}
            >
              Previous activity
            </Button>
            <span>Page {data.page + 1}</span>
            <Button
              disabled={busy || !data.hasMore}
              onClick={() => load(false, data.page + 1)}
            >
              Next activity
            </Button>
          </div>
        </>
      )}
    </>
  );
}

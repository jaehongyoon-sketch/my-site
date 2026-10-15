"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { usd } from "@/lib/domain/order";
import type {
  reconcilePractice,
  Difference,
} from "@/lib/reconciliation/service";
type Data = Awaited<ReturnType<typeof reconcilePractice>>;
function amount(n: number, unit: Difference["unit"]) {
  return n === -1
    ? "Missing record"
    : unit === "units"
      ? usd(n / 400)
      : unit === "valid"
        ? n === 1
          ? "Valid"
          : "Invalid"
        : n.toLocaleString("en-US");
}
export default function Panel() {
  const [data, setData] = useState<Data | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const seq = useRef(0);
  async function load() {
    const n = ++seq.current;
    setBusy(true);
    setError("");
    setData(null);
    try {
      const r = await fetch("/api/practice/reconciliation", {
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      const d = (await r.json()) as Data & { error?: string };
      if (!r.ok) throw Error(d.error ?? "Checks unavailable.");
      if (n === seq.current) setData(d);
    } catch (e) {
      if (n === seq.current)
        setError(e instanceof Error ? e.message : "Checks unavailable.");
    } finally {
      if (n === seq.current) setBusy(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      seq.current++;
    };
  }, []);
  return (
    <>
      <div className="event-actions">
        <Button disabled={busy} onClick={load}>
          {busy ? "Checking…" : "Run checks again"}
        </Button>
        <a href="/practice/activity">Cash activity</a>
        <a href="/practice/events">Trade activity</a>
      </div>
      {error && (
        <p className="account-error" role="alert">
          {error} No successful result is available.
        </p>
      )}
      {data && (
        <>
          <section className="account-card">
            <h2>
              {data.status === "passed"
                ? "Records agree"
                : data.status === "not_started"
                  ? "Practice has not started"
                  : "Differences need review"}
            </h2>
            <p role="status">
              {data.failureCount} differences · {data.scope.orders} buy orders ·{" "}
              {data.scope.fillEntries} fill entries ·{" "}
              {data.scope.sellReservations} sell reservations
            </p>
            <p>
              Checked {new Date(data.checkedAt).toLocaleString()}. This result
              covers saved practice data at that moment; it is not proof of
              settlement or real funds.
            </p>
            {data.status === "mismatch" && (
              <p className="account-error">
                Refresh once to verify the result. If differences remain, give
                the administrator the references below. No records have been
                repaired or funds moved.
              </p>
            )}
          </section>
          <h2>Checks</h2>
          {data.checks.map((c) => (
            <div key={c.code} className="account-card practice-order">
              <h3>{c.label}</h3>
              <p>
                {c.status === "passed"
                  ? "Passed"
                  : c.status === "mismatch"
                    ? "Mismatch"
                    : "No applicable records"}{" "}
                · {c.checked} comparisons · {c.failed} differences
              </p>
            </div>
          ))}
          {data.differences.length > 0 && (
            <>
              <h2>Difference details</h2>
              {data.detailsTruncated && (
                <p>
                  Showing the first 50 differences. Totals above include all
                  differences.
                </p>
              )}
              {data.differences.map((d, i) => (
                <article
                  className="account-card practice-order"
                  key={d.code + d.reference + i}
                >
                  <h3>{data.checks.find((c) => c.code === d.code)?.label}</h3>
                  <p>Reference: {d.reference}</p>
                  <dl className="market-status-facts">
                    <div>
                      <dt>Expected from source records</dt>
                      <dd>{amount(d.expected, d.unit)}</dd>
                    </div>
                    <div>
                      <dt>Recorded / observed</dt>
                      <dd>{amount(d.actual, d.unit)}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </>
          )}
        </>
      )}
    </>
  );
}

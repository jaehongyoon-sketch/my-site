"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { feeReport } from "@/lib/practice/fees";
type Report = Awaited<ReturnType<typeof feeReport>>;
const money = (units: number) =>
  "$" + (units / 40000).toFixed(6).replace(/(\.\d{2}.*?)0+$/, "$1");
export default function Panel() {
  const [data, setData] = useState<Report | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(0);
  async function load(page = 0) {
    const id = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/practice/fees?page=" + page, {
        cache: "no-store",
      });
      const j = (await r.json()) as Report & { error?: string };
      if (!r.ok) throw Error(j.error);
      if (id === generation.current) setData(j);
    } catch (e) {
      if (id === generation.current) {
        setData(null);
        setError(e instanceof Error ? e.message : "Unable to load fees.");
      }
    } finally {
      if (id === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, []);
  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">{busy ? "Loading your records" : error || !data ? "" : "Records updated"}</p>
      <Button disabled={busy} onClick={() => void load(data?.page ?? 0)}>
        {busy ? "Loading…" : "Refresh records"}
      </Button>
      {error && (
        <p role="alert">
          {error} <a href="/account">My account</a>
        </p>
      )}
      {data && (
        <>
          <section className="account-card">
            <h2>All buy orders</h2>
            <p>
              Filled fees: <strong>{money(data.totals.chargedUnits)}</strong>
            </p>
            <p>Filled principal: {money(data.totals.principalUnits)}</p>
            <p>Unused funds released: {money(data.totals.releasedUnits)}</p>
            <p>
              Recorded reservation (principal + estimated fee):{" "}
              {money(data.totals.heldUnits)}
            </p>
            <p>Applied fee refunds: $0.00 · Real revenue: $0.00</p>
            <small>
              As recorded at {data.asOf}. This read-only view does not process
              expiry releases. Open your portfolio to refresh order lifecycle
              status.
            </small>
          </section>
          {!data.entries.length && <p>No practice buy orders yet.</p>}
          {data.entries.map((e) => (
            <section key={e.id} className="account-card">
              <h2>{e.title}</h2>
              <p>
                {e.outcome.toUpperCase()} · {e.status} · {e.quantity} filled
                contracts
              </p>
              <p>
                Fee policy:{" "}
                {e.policy === "per_contract"
                  ? "0.25% per contract, exact precision"
                  : "Legacy order fee policy (original rounding retained)"}
              </p>
              <p>
                Charged fee: {money(e.chargedUnits)} · Principal:{" "}
                {money(e.principalUnits)}
              </p>
              <p>
                Released unused funds: {money(e.releasedUnits)} · Remaining
                reservation: {money(e.heldUnits)}
              </p>
              <small style={{ overflowWrap: "anywhere" }}>Order: {e.id}</small>
            </section>
          ))}
          <nav className="admin-pagination" aria-label="Record pages">
            <Button
              disabled={busy || data.page === 0}
              onClick={() => void load(data.page - 1)}
            >
              Previous
            </Button>
            <span>Page {data.page + 1}</span>
            <Button
              disabled={busy || !data.hasMore}
              onClick={() => void load(data.page + 1)}
            >
              Next
            </Button>
          </nav>
        </>
      )}
    </>
  );
}

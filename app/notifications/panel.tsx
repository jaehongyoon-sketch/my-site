"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { readNotifications } from "@/lib/notifications/service";
type State = Awaited<ReturnType<typeof readNotifications>> & {
  hasMoreToSync?: boolean;
};
const labels: Record<string, string> = {
  buy_accepted: "Buy order accepted",
  buy_filled: "Buy order filled",
  buy_released: "Unused buy reservation released",
  sell_reserved: "Sell quantity reserved — not executed",
  sell_released: "Sell reservation released",
};
export default function Panel() {
  const [data, setData] = useState<State | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  async function request(body?: object, page = 0) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(
        "/api/notifications" + (body ? "" : "?page=" + page),
        body
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(15000),
            }
          : { cache: "no-store", signal: AbortSignal.timeout(15000) },
      );
      const j = (await r.json()) as State & { error?: string };
      if (!r.ok) throw Error(j.error);
      setData(j);
    } catch (e) {
      setData(null);
      setError(
        e instanceof Error
          ? e.message
          : "Unable to load. Refresh to check your settings.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    void request();
  }, []);
  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">{busy ? "Loading your records" : error || !data ? "" : "Records updated"}</p>
      {error && (
        <p role="alert">
          {error} <a href="/account">My account</a>
        </p>
      )}
      <Button disabled={busy} onClick={() => void request()}>
        Refresh
      </Button>
      {data && (
        <>
          <section className="account-card">
            <h2 aria-live="polite">{data.unread} unread</h2>
            <p>
              In-app trade notifications:{" "}
              <strong>{data.enabled ? "On" : "Off"}</strong>
            </p>
            <Button
              disabled={busy}
              variant="outline"
              aria-pressed={data.enabled}
              onClick={() =>
                void request({
                  action: "settings",
                  enabled: !data.enabled,
                  expectedRevision: data.revision,
                })
              }
            >
              Turn {data.enabled ? "off" : "on"}
            </Button>
            <Button
              disabled={busy}
              onClick={() => void request({ action: "sync" })}
            >
              {busy
                ? "Working…"
                : data.hasMoreToSync || data.pending
                  ? "Continue sync"
                  : "Sync notifications"}
            </Button>
            <p>
              No automatic background delivery. Refresh reads existing notices;
              Sync collects saved trade history.
            </p>
            {data.hasMoreToSync && (
              <p>More records remain. Select Continue sync.</p>
            )}
          </section>
          {!data.entries.length && (
            <p>
              No notifications on this page. Sync to collect your saved trades.
            </p>
          )}
          {data.entries.map((n) => (
            <section className="account-card" key={n.id}>
              <p className="eyebrow">
                {n.readAt ? "Read" : "Unread"} · {n.occurredAt}
              </p>
              <h2>{labels[n.kind] ?? n.kind}</h2>
              <p>{n.eventTitle}</p>
              <p>
                {n.outcome.toUpperCase()} · {n.quantity} contracts
              </p>
              {!n.readAt && (
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={() => void request({ action: "read", id: n.id })}
                >
                  Mark as read
                </Button>
              )}
            </section>
          ))}
          <nav className="admin-pagination" aria-label="Record pages">
            <Button
              disabled={busy || data.page === 0}
              onClick={() => void request(undefined, data.page - 1)}
            >
              Previous
            </Button>
            <span>Page {data.page + 1}</span>
            <Button
              disabled={busy || !data.hasMore}
              onClick={() => void request(undefined, data.page + 1)}
            >
              Next
            </Button>
          </nav>
        </>
      )}
    </>
  );
}

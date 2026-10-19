"use client";
import { SellReservations } from "./sell-controls";
import Positions from "./positions";
import CancelOrder from "./cancel-order";
import { useEffect, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { usd } from "@/lib/domain/order";
import type { practiceAccount } from "@/lib/practice/service";
type Data = Awaited<ReturnType<typeof practiceAccount>>;
export default function PracticePanel() {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const inFlight = useRef(false);
  async function load(
    page = 0,
    start = false,
    eventId?: string,
    positionPage = data?.positionPage ?? 0,
    sellPage = data?.sellPage ?? 0,
  ) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(
        eventId
          ? "/api/practice/match"
          : `/api/practice?page=${page}&positionPage=${positionPage}&sellPage=${sellPage}`,
        {
          method: start || eventId ? "POST" : "GET",
          headers:
            start || eventId ? { "Content-Type": "application/json" } : {},
          body: eventId
            ? JSON.stringify({ eventId })
            : start
              ? JSON.stringify({ acknowledgement: "PRACTICE_ONLY" })
              : undefined,
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        },
      );
      const d = (await r.json()) as Data & { error?: string };
      if (!r.ok) throw Error(d.error ?? "Unable to load practice account.");
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load account.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden && !inFlight.current) void load(data?.page ?? 0);
    };
    const timer = setInterval(refresh, 15000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [data?.page, data?.positionPage, data?.sellPage]);
  return (
    <>
      <div className="event-actions">
        <Button disabled={busy} onClick={() => load(data?.page ?? 0)}>
          {busy ? "Loading…" : "Refresh balance & orders"}
        </Button>
        <a href="/">Explore events</a>
        <a href="/notifications">Notifications</a>
        <a href="/practice/events">Trade activity</a>
        <a href="/practice/reconciliation">Check records</a>
        <a href="/account/eligibility">Trading access</a>
        <a href="/practice/fees">Fees &amp; releases</a>
        <a href="/practice/activity">Funds &amp; activity</a>
      </div>
      {notice && (
        <p role="status" className="account-success">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="account-error">
          {error} <a href="/account">Account settings</a>
        </p>
      )}
      {data && !data.wallet && (
        <section className="account-card">
          <h2>Start with $1,000 in practice funds</h2>
          <p>
            A one-time virtual balance for this account. It cannot be withdrawn,
            transferred or reset by signing in again.
          </p>
          <Button disabled={busy} onClick={() => load(0, true)}>
            Start practice · no real money
          </Button>
        </section>
      )}
      {data?.wallet && (
        <>
          <dl className="market-status-facts account-card">
            <div>
              <dt>Available practice funds</dt>
              <dd>{usd(data.wallet.availableCents)}</dd>
            </div>
            <div>
              <dt>Reserved for open orders</dt>
              <dd>{usd(data.wallet.reservedCents)}</dd>
            </div>
            <div>
              <dt>Spent on practice contracts &amp; fees</dt>
              <dd>{usd(data.wallet.spentCents)}</dd>
            </div>
          </dl>
          <p>
            Reservation includes contract cost and the estimated 0.25% fee. New
            orders charge 0.25% of each filled contract’s price, with sub-cent
            precision. Expired or hidden-event unfilled reservations are
            released when you refresh or submit another practice request.
          </p>
          <Positions
            data={data}
            busy={busy}
            onPage={(p) => load(data.page, false, undefined, p)}
            onComplete={(message) => {
              setNotice(message);
              void load(data.page);
            }}
          />
          <SellReservations
            data={data}
            busy={busy}
            onPage={(p) =>
              load(data.page, false, undefined, data.positionPage, p)
            }
            onComplete={(message) => {
              setNotice(message);
              void load(data.page);
            }}
          />
          <h2>Your buy orders</h2>
          {!data.orders.length && (
            <p>
              No practice orders yet. Open an event, review a limit buy, then
              place a practice order.
            </p>
          )}
          {data.orders.map((o) => (
            <article key={o.id} className="account-card practice-order">
              <p className="eyebrow">
                PRACTICE ·{" "}
                {o.filled_quantity === o.quantity
                  ? "filled"
                  : o.status !== "open"
                    ? o.status
                    : o.filled_quantity > 0
                      ? "partially filled"
                      : "open"}
              </p>
              <h3>
                <a href={`/events/${o.event_id}`}>{o.event_title}</a>
              </h3>
              <p>
                {o.quantity} {o.outcome.toUpperCase()} contracts · limit{" "}
                {o.price_cents}¢
              </p>
              <p>
                {o.filled_quantity} filled · {o.remaining_quantity}{" "}
                {o.status === "cancelled"
                  ? "cancelled"
                  : o.status === "open"
                    ? "remaining"
                    : "unfilled at close"}
              </p>
              <p>
                Reserved: {usd(o.heldCents)} · Filled cost:{" "}
                {usd(o.executedPrincipalCents)} · Practice fee:{" "}
                {usd(o.chargedFeeCents)}
              </p>
              <p className="account-caption">
                {o.feePolicy === "legacy_order"
                  ? "Earlier order: original 0.25% fee rounded per order."
                  : "0.25% per filled contract · sub-cent precision."}
              </p>
              {o.status === "open" && o.remaining_quantity > 0 && (
                <div className="event-actions">
                  <Button
                    disabled={busy}
                    onClick={() => load(0, false, o.event_id)}
                  >
                    Match available orders
                  </Button>
                  <CancelOrder
                    order={o}
                    disabled={busy}
                    onComplete={(message) => {
                      setNotice(message);
                      void load(data.page);
                    }}
                  />
                </div>
              )}
              {o.cancelledAt && (
                <p className="account-caption">
                  Cancelled {o.cancelledAt.replace("T", " ")} ·{" "}
                  {o.cancelledQuantity} contracts · {usd(o.refundedCents)}{" "}
                  returned
                </p>
              )}
              <p className="account-caption">
                Deadline: {o.expires_at.replace("T", " ")}
                <br />
                Order ID: {o.id}
              </p>
            </article>
          ))}
          <div className="event-actions">
            <Button
              disabled={busy || data.page === 0}
              onClick={() => load(data.page - 1)}
            >
              Previous
            </Button>
            <span>Page {data.page + 1}</span>
            <Button
              disabled={busy || !data.hasMore}
              onClick={() => load(data.page + 1)}
            >
              Next
            </Button>
          </div>
          <h2>Recent practice fills</h2>
          <p>
            Latest 50 fills. Each pair funds $1 of virtual collateral per
            contract. Results and payouts are not settled yet.
          </p>
          {!data.fills.length && (
            <p>
              No fills yet. Another account must place a compatible
              opposite-outcome order. Your own YES and NO orders cannot match
              each other.
            </p>
          )}
          {data.fills.map((f) => (
            <article
              key={f.id + f.orderId}
              className="account-card practice-order"
            >
              <h3>{f.eventTitle}</h3>
              <p>
                {f.quantity} {f.outcome.toUpperCase()} at{" "}
                {f.principalCents / f.quantity}¢ · cost {usd(f.principalCents)}{" "}
                · fee {usd(f.feeCents)}
              </p>
              <p>Unused reservation returned: {usd(f.releasedCents)}</p>
              <p className="account-caption">
                {f.createdAt.replace("T", " ")}
                <br />
                Order: {f.orderId}
                <br />
                Fill: {f.id}
              </p>
            </article>
          ))}
        </>
      )}
    </>
  );
}

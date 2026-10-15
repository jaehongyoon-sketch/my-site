"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { usd } from "@/lib/domain/order";
import type { PracticePosition } from "@/lib/practice/positions";
import type { SellOrder } from "@/lib/practice/sells";
import type { practiceAccount } from "@/lib/practice/service";
type Done = (message: string) => void;
export function ReserveSell({
  position: p,
  disabled,
  onComplete,
}: {
  position: PracticePosition;
  disabled: boolean;
  onComplete: Done;
}) {
  const [quantity, setQuantity] = useState("1"),
    [price, setPrice] = useState("50"),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef<string | null>(null),
    submitting = useRef(false);
  const q = Number(quantity),
    c = Number(price),
    valid =
      Number.isInteger(q) &&
      q > 0 &&
      q <= Math.min(p.availableQuantity, 10000) &&
      Number.isInteger(c) &&
      c >= 1 &&
      c <= 99;
  async function submit() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    pending.current ??= JSON.stringify({
      clientOrderId: crypto.randomUUID(),
      intent: {
        eventId: p.eventId,
        eventRevision: p.eventRevision,
        side: "sell",
        orderType: "limit",
        timeInForce: "until-close",
        outcome: p.outcome,
        quantity: q,
        limitPriceCents: c,
      },
    });
    try {
      const r = await fetch("/api/practice/sells", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: pending.current,
        signal: AbortSignal.timeout(10000),
      });
      const d = (await r.json()) as {
        error?: string;
        mode?: string;
        executionEnabled?: boolean;
        order?: SellOrder;
      };
      if (!r.ok) {
        if (r.status < 500) pending.current = null;
        throw Error(d.error ?? "Reservation not confirmed.");
      }
      if (d.mode !== "practice" || !d.order?.id || d.executionEnabled !== false)
        throw Error("Reservation not confirmed. Retry the same request.");
      pending.current = null;
      setOpen(false);
      onComplete(
        `Sell reservation ${d.order.status}: ${d.order.quantity} ${d.order.outcome.toUpperCase()} contracts. No sale or cash movement occurred.`,
      );
    } catch (e) {
      setError(
        e instanceof Error && e.name !== "TimeoutError"
          ? e.message
          : "Result not confirmed. Retry the same reservation; it cannot reserve twice.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <div>
      <p>
        <strong>
          {p.reservedQuantity} reserved · {p.availableQuantity} available
        </strong>
      </p>
      {p.eventStatus === "published" && Date.parse(p.closesAt) > Date.now() && (
        <>
          <div className="event-actions">
            <label>
              Contracts
              <Input
                type="number"
                min={1}
                max={Math.min(p.availableQuantity, 10000)}
                value={quantity}
                disabled={busy || !!pending.current}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </label>
            <label>
              Sell limit (¢)
              <Input
                type="number"
                min={1}
                max={99}
                value={price}
                disabled={busy || !!pending.current}
                onChange={(e) => setPrice(e.target.value)}
              />
            </label>
            <Button
              disabled={disabled || busy || (!valid && !pending.current)}
              onClick={() => {
                setError("");
                setOpen(true);
              }}
            >
              Review sell reservation
            </Button>
          </div>
          <AlertDialog
            open={open}
            onOpenChange={(v) => {
              if (!busy) setOpen(v);
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Reserve {q} {p.outcome.toUpperCase()} contracts?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {p.eventTitle}
                  <br />
                  Limit {c}¢ · Estimated proceeds {usd(c * q)} · Estimated fee{" "}
                  {usd((c * q) / 400)} · Estimated net{" "}
                  {usd(c * q - (c * q) / 400)}.<br />
                  Fee estimate: 0.25% per contract. This only reserves holdings.
                  Sell matching is not connected, so no sale occurs, proceeds
                  are not credited and fees are not charged.
                </AlertDialogDescription>
              </AlertDialogHeader>
              {error && (
                <p role="alert" className="account-error">
                  {error}
                </p>
              )}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy}>
                  {pending.current ? "Close and check reservations" : "Back"}
                </AlertDialogCancel>
                <Button disabled={busy} onClick={submit}>
                  {busy
                    ? "Reserving…"
                    : pending.current
                      ? "Retry same reservation"
                      : "Confirm reservation"}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}
function CancelSell({
  order,
  disabled,
  onComplete,
}: {
  order: SellOrder;
  disabled: boolean;
  onComplete: Done;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  async function cancel() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/practice/sells/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id }),
        signal: AbortSignal.timeout(10000),
      });
      const d = (await r.json()) as {
        error?: string;
        mode?: string;
        executionEnabled?: boolean;
        order?: SellOrder;
      };
      if (
        !r.ok ||
        d.order?.id !== order.id ||
        !d.order ||
        d.order.status === "open"
      )
        throw Error(
          d.error ?? "Cancellation not confirmed. Retry this cancellation.",
        );
      setOpen(false);
      onComplete(
        "Sell reservation released. Holdings remain in your account; no cash or fees changed.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retry cancellation.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        disabled={disabled}
        variant="outline"
        onClick={() => setOpen(true)}
      >
        Cancel sell reservation
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={(v) => {
          if (!busy) setOpen(v);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Release this sell reservation?</AlertDialogTitle>
            <AlertDialogDescription>
              {order.quantity} {order.outcome.toUpperCase()} contracts ·{" "}
              {order.eventTitle}. The contracts become available again. No
              cancellation fee.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p role="alert">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>
              Keep reservation
            </AlertDialogCancel>
            <Button disabled={busy} onClick={cancel}>
              {busy ? "Cancelling…" : "Release reservation"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
export function SellReservations({
  data,
  busy,
  onPage,
  onComplete,
}: {
  data: Awaited<ReturnType<typeof practiceAccount>>;
  busy: boolean;
  onPage: (page: number) => void;
  onComplete: Done;
}) {
  return (
    <section aria-labelledby="sells-title">
      <h2 id="sells-title">Sell reservations</h2>
      <p>
        Reservation only. Sell matching is not connected. No proceeds or fees
        are applied. Refresh releases reservations for closed or hidden events.
      </p>
      {!data.sellOrders.length && <p>No sell reservations on this page.</p>}
      {data.sellOrders.map((o) => (
        <article className="account-card practice-order" key={o.id}>
          <p className="eyebrow">PRACTICE SELL · {o.status}</p>
          <h3>{o.eventTitle}</h3>
          <p>
            {o.quantity} {o.outcome.toUpperCase()} contracts · limit{" "}
            {o.priceCents}¢
          </p>
          <p className="account-caption">
            Deadline: {o.expiresAt.replace("T", " ")}
            {o.releasedAt && <> · Released {o.releasedAt.replace("T", " ")}</>}
            <br />
            Reservation ID: {o.id}
          </p>
          {o.status === "open" && (
            <CancelSell order={o} disabled={busy} onComplete={onComplete} />
          )}
        </article>
      ))}
      <div className="event-actions">
        <Button
          disabled={busy || data.sellPage === 0}
          onClick={() => onPage(data.sellPage - 1)}
        >
          Previous reservations
        </Button>
        <span>Reservations page {data.sellPage + 1}</span>
        <Button
          disabled={busy || !data.sellsHasMore}
          onClick={() => onPage(data.sellPage + 1)}
        >
          Next reservations
        </Button>
      </div>
    </section>
  );
}

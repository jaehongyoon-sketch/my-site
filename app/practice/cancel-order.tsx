"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { usd } from "@/lib/domain/order";
import type { PracticeOrder } from "@/lib/practice/service";
export default function CancelOrder({
  order,
  disabled,
  onComplete,
}: {
  order: PracticeOrder;
  disabled: boolean;
  onComplete: (message: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const submitting = useRef(false);
  async function cancel() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/practice/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id }),
        signal: AbortSignal.timeout(10000),
      });
      const d = (await r.json()) as {
        mode?: string;
        orderId?: string;
        outcome?: string;
        error?: string;
        receipt?: { quantity: number; refundedCents: number };
      };
      if (!r.ok) throw Error(d.error ?? "Cancellation could not be confirmed.");
      if (
        d.mode !== "practice" ||
        d.orderId !== order.id ||
        !["cancelled", "already_filled", "already_closed"].includes(
          d.outcome ?? "",
        )
      )
        throw Error("Cancellation could not be confirmed.");
      const message =
        d.outcome === "cancelled" && d.receipt
          ? `${d.receipt.quantity} unfilled contracts cancelled. ${usd(d.receipt.refundedCents)} in reserved practice funds returned. Earlier fills and fees are unchanged.`
          : d.outcome === "already_filled"
            ? "This order filled before cancellation. No contracts were cancelled and no funds were returned."
            : "This order is already closed. Its remaining reservation has already been released.";
      setOpen(false);
      onComplete(message);
    } catch (e) {
      setError(
        e instanceof Error && e.name !== "TimeoutError"
          ? e.message
          : "Result not confirmed. Retry this same cancellation or refresh your orders. It is safe to retry; funds cannot be returned twice.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <AlertDialog
      open={open}
      onOpenChange={(v) => {
        if (!busy) {
          setOpen(v);
          if (v) setError("");
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          Cancel remaining
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Cancel unfilled practice contracts?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {order.event_title}
            <br />
            {order.remaining_quantity} {order.outcome.toUpperCase()} contracts
            remaining · currently {usd(order.heldCents)} reserved.
            <br />
            Only the quantity still unfilled when cancellation reaches the
            server will be cancelled. Earlier fills and their fees remain. There
            is no cancellation fee.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="account-error">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep order</AlertDialogCancel>
          <Button disabled={busy} onClick={cancel}>
            {busy
              ? "Cancelling…"
              : error
                ? "Retry cancellation"
                : "Cancel unfilled contracts"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

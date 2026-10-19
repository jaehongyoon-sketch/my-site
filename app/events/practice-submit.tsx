"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { OrderPreview } from "@/lib/orders/model";
// A retry keeps the exact request and idempotency key, including after timeouts.
export default function PracticeSubmit({
  preview,
  expired,
  onLock,
}: {
  preview: OrderPreview;
  expired: boolean;
  onLock: (locked: boolean) => void;
}) {
  const key = useRef<string | null>(null),
    inFlight = useRef(false);
  const [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [error, setError] = useState(""),
    [receipt, setReceipt] = useState("");
  useEffect(() => {
    if (!uncertain && !busy) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uncertain, busy]);
  async function submit() {
    if (inFlight.current) return;
    inFlight.current = true;
    key.current ??= crypto.randomUUID();
    setBusy(true);
    onLock(true);
    setError("");
    let definitive = false;
    try {
      const r = await fetch("/api/practice/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientOrderId: key.current,
          intent: preview.intent,
        }),
        signal: AbortSignal.timeout(10000),
      });
      const d = (await r.json()) as {
        error?: string;
        mode?: string;
        order?: { id: string };
      };
      if (!r.ok) {
        if (r.status < 500) {
          definitive = true;
          setUncertain(false);
          onLock(false);
          throw Error(d.error ?? "Order was not accepted.");
        }
        throw Error("Result not confirmed. Retry the same request below.");
      }
      if (d.mode !== "practice" || !d.order?.id)
        throw Error("Result not confirmed. Retry the same request.");
      setReceipt(d.order.id);
      window.dispatchEvent(new Event("market-order-updated"));
      setUncertain(false);
      onLock(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Result not confirmed.");
      if (!definitive) {
        setUncertain(true);
        onLock(true);
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  // Once attempted, retries always reuse the same key. A fresh review creates a new request.
  return (
    <div className="practice-confirm">
      <h3>Practice only</h3>
      <p>
        Uses virtual dollars from your <a href="/practice">practice balance</a>.
        This reserves the reviewed total and may immediately match compatible
        orders from another account. Unfilled quantities stay open. Each matched
        YES/NO pair costs $1 before fees. No real money is used.
      </p>
      {receipt ? (
        <p role="status" className="account-success">
          Practice order accepted: {receipt}.{" "}
          <a href="/practice">View balance and orders</a>
        </p>
      ) : (
        <Button
          disabled={busy || (expired && !key.current)}
          onClick={() => {
            setUncertain(true);
            void submit();
          }}
        >
          {busy
            ? "Confirming…"
            : key.current
              ? "Retry same practice order"
              : "Place practice order"}
        </Button>
      )}
      {error && (
        <p role="alert" className="account-error">
          {error}
        </p>
      )}
      {uncertain && !busy && (
        <p>
          Do not start a new order while the result is unknown. Retry here or{" "}
          <a href="/practice">check your order history</a> before leaving.
        </p>
      )}
    </div>
  );
}

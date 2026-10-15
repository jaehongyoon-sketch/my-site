"use client";
import PracticeSubmit from "./practice-submit";
import { useEffect, useRef, useState } from "react";
import { orderPreviewSchema, type OrderPreview } from "@/lib/orders/model";
import { usd } from "@/lib/domain/order";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
export default function OrderPreviewPanel({
  eventId,
  eventRevision,
  closesAt,
}: {
  eventId: string;
  eventRevision: number;
  closesAt: string;
}) {
  const [outcome, setOutcome] = useState("yes"),
    [price, setPrice] = useState(""),
    [quantity, setQuantity] = useState(""),
    [preview, setPreview] = useState<OrderPreview | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [expired, setExpired] = useState(false),
    [accountRequired, setAccountRequired] = useState(false);
  const [submissionLocked, setSubmissionLocked] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const validUntil = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
      controller.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (!preview) return;
    const remaining = Math.max(0, validUntil.current - performance.now());
    const timer = setTimeout(() => setExpired(true), remaining);
    const invalidate = () => setExpired(true);
    document.addEventListener("visibilitychange", invalidate);
    window.addEventListener("offline", invalidate);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", invalidate);
      window.removeEventListener("offline", invalidate);
    };
  }, [preview]);
  function changed() {
    setPreview(null);
    setExpired(false);
    setError("");
  }
  async function review(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setPreview(null);
    setExpired(false);
    setAccountRequired(false);
    if (!/^\d+$/.test(price) || !/^\d+$/.test(quantity)) {
      setError("Enter whole cents and whole contracts.");
      return;
    }
    const intent = {
      eventId,
      eventRevision,
      outcome,
      limitPriceCents: Number(price),
      quantity: Number(quantity),
      side: "buy",
      orderType: "limit",
      timeInForce: "until-close",
    };
    const id = ++generation.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    const timeout = setTimeout(() => abort.abort(), 8000);
    const started = performance.now();
    try {
      const r = await fetch("/api/order-previews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(intent),
        signal: abort.signal,
      });
      const raw = (await r.json()) as { error?: string };
      if (!r.ok) {
        if (r.status === 401 || r.status === 403) setAccountRequired(true);
        throw new Error(raw.error ?? "Unable to review this order.");
      }
      const data = orderPreviewSchema.parse(raw);
      if (
        data.intent.eventId !== eventId ||
        data.intent.eventRevision !== eventRevision ||
        data.intent.outcome !== outcome ||
        data.intent.limitPriceCents !== Number(price) ||
        data.intent.quantity !== Number(quantity)
      )
        throw new Error(
          "The review does not match your request. Please retry.",
        );
      if (id === generation.current) {
        validUntil.current =
          started + Date.parse(data.expiresAt) - Date.parse(data.checkedAt);
        setPreview(data);
        setExpired(
          Date.parse(data.expiresAt) - Date.parse(data.checkedAt) <=
            performance.now() - started,
        );
      }
    } catch (e) {
      if (id === generation.current)
        setError(
          e instanceof Error && e.name !== "AbortError"
            ? e.message
            : "Request timed out. Please retry. No order was created.",
        );
    } finally {
      clearTimeout(timeout);
      if (id === generation.current) setBusy(false);
    }
  }
  return (
    <section className="account-card order-preview-panel">
      <p className="eyebrow">LIMIT BUY · PRACTICE</p>
      <h2>Plan a limit buy</h2>
      <p>
        Choose the most you would pay per contract. This is your limit price,
        not a market quote. Review first, then choose whether to place a
        practice order.
      </p>
      <form onSubmit={review}>
        <fieldset disabled={busy || submissionLocked}>
          <label id="outcome-label">Outcome</label>
          <RadioGroup
            aria-labelledby="outcome-label"
            value={outcome}
            onValueChange={(v) => {
              setOutcome(v);
              changed();
            }}
            className="event-actions"
          >
            <label htmlFor="buy-yes" className="order-outcome">
              <RadioGroupItem id="buy-yes" value="yes" /> YES
            </label>
            <label htmlFor="buy-no" className="order-outcome">
              <RadioGroupItem id="buy-no" value="no" /> NO
            </label>
          </RadioGroup>
          <div className="event-fields">
            <div>
              <label htmlFor="limit-price">Limit price (¢ per contract)</label>
              <Input
                id="limit-price"
                inputMode="numeric"
                pattern="[0-9]+"
                required
                maxLength={2}
                value={price}
                onChange={(e) => {
                  setPrice(e.target.value);
                  changed();
                }}
                placeholder="1–99"
              />
            </div>
            <div>
              <label htmlFor="order-quantity">Contracts</label>
              <Input
                id="order-quantity"
                inputMode="numeric"
                pattern="[0-9]+"
                required
                maxLength={5}
                value={quantity}
                onChange={(e) => {
                  setQuantity(e.target.value);
                  changed();
                }}
                placeholder="1–10,000"
              />
            </div>
          </div>
          <p className="account-caption">
            Limit buy only. Intended order deadline:{" "}
            {closesAt.replace("T", " ").slice(0, 16)} UTC.
          </p>
          <Button type="submit">
            {busy ? "Checking request…" : "Review amounts"}
          </Button>
        </fieldset>
      </form>
      {error && (
        <p role="alert" className="account-error">
          {error}{" "}
          {accountRequired ? (
            <a href="/account">Go to account</a>
          ) : (
            <a href={`/events/${eventId}`}>Reload event</a>
          )}
        </p>
      )}
      {preview && (
        <div className="order-review-result" aria-live="polite">
          <h3>
            {expired
              ? "Review expired — check again"
              : "Server-checked cost review"}
          </h3>
          <p>
            {preview.intent.quantity} {preview.intent.outcome.toUpperCase()}{" "}
            contracts at a limit of {preview.intent.limitPriceCents}¢ each
          </p>
          <dl className="market-status-facts">
            <div>
              <dt>Contract cost at your limit</dt>
              <dd>{usd(preview.calculation.principalCents)}</dd>
            </div>
            <div>
              <dt>
                Fee · 0.25% per contract
                <br />
                <small>{usd(preview.intent.limitPriceCents / 400)} each</small>
              </dt>
              <dd>{usd(preview.calculation.feeCents)}</dd>
            </div>
            <div>
              <dt>Total at your limit</dt>
              <dd>
                <strong>{usd(preview.calculation.totalCents)}</strong>
              </dd>
            </div>
            <div>
              <dt>Payout if the outcome wins</dt>
              <dd>{usd(preview.calculation.payoutCents)}</dd>
            </div>
            <div>
              <dt>Net gain if the outcome wins</dt>
              <dd>{usd(preview.calculation.netProfitCents)}</dd>
            </div>
          </dl>
          <p className="account-caption">
            Assumes every contract fills at your limit and a winning contract
            pays $1. If the outcome loses, the full cost and fee can be lost.
            Fees are calculated per contract with sub-cent precision. These are
            planning amounts, not a fill guarantee.
          </p>
          <p>
            Profile active · Event open when checked. Buying power and trading
            eligibility have not been verified.
          </p>
          <p className="account-caption">
            Review expires {preview.expiresAt.replace("T", " ").slice(0, 19)}{" "}
            UTC. Recheck after any input change.
          </p>
          <PracticeSubmit
            key={preview.previewId}
            preview={preview}
            expired={expired}
            onLock={setSubmissionLocked}
          />
        </div>
      )}
    </section>
  );
}

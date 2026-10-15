"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { usd } from "@/lib/domain/order";
import type {
  publicResolution,
  settlementPreview,
} from "@/lib/resolutions/service";
export default function ResolutionPanel({ eventId }: { eventId: string }) {
  const [data, setData] = useState<Awaited<
      ReturnType<typeof publicResolution>
    > | null>(null),
    [preview, setPreview] = useState<Awaited<
      ReturnType<typeof settlementPreview>
    > | null>(null),
    [error, setError] = useState(""),
    [previewError, setPreviewError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    fetch("/api/resolutions/" + eventId, {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    })
      .then(async (r) => {
        const d = (await r.json()) as Awaited<
          ReturnType<typeof publicResolution>
        > & { error?: string };
        if (!r.ok) throw Error(d.error ?? "Outcome unavailable.");
        if (active) setData(d);
      })
      .catch(() => {
        if (active)
          setError("Outcome could not be loaded. Refresh this page to retry.");
      });
    return () => {
      active = false;
    };
  }, [eventId]);
  async function estimate() {
    setBusy(true);
    setPreviewError("");
    setPreview(null);
    try {
      const r = await fetch(
        "/api/practice/settlement-preview?eventId=" + eventId,
        { cache: "no-store", signal: AbortSignal.timeout(10000) },
      );
      const d = (await r.json()) as Awaited<
        ReturnType<typeof settlementPreview>
      > & { error?: string };
      if (!r.ok) throw Error(d.error ?? "Estimate unavailable.");
      setPreview(d);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : "Unavailable.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="account-card">
      <h2>Event outcome</h2>
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p>Loading outcome…</p>}
      {data && !data.resolution && (
        <p>No final result has been recorded. Settlement remains pending.</p>
      )}
      {data?.resolution && (
        <>
          <p className="eyebrow">
            FINAL · {data.resolution.outcome.toUpperCase()}
          </p>
          <p className="event-rules">{data.resolution.rationale}</p>
          <a
            href={data.resolution.evidenceUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            View administrator-provided evidence
          </a>
          <p>
            Confirmed {data.resolution.confirmedAt}. This records the result; no
            payout has been applied.
          </p>
          <Button disabled={busy} onClick={estimate}>
            {busy ? "Calculating…" : "Preview my practice settlement"}
          </Button>
          {previewError && <p role="alert">{previewError}</p>}
          {preview && (
            <>
              <p>{preview.message}</p>
              {preview.positions.map((p) => (
                <p key={p.outcome}>
                  {p.quantity} {p.outcome.toUpperCase()} contracts · Estimated
                  practice credit:{" "}
                  {p.estimatedCreditUnits === null
                    ? "Pending"
                    : usd(p.estimatedCreditUnits / 400)}
                </p>
              ))}
              <p className="account-caption">
                Model: YES/NO winners receive $1 per contract, losers $0; paid
                fees remain. VOID returns execution principal and paid practice
                fees. These are calculations, not credited balances.
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}

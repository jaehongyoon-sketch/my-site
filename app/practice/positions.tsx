"use client";
import { ReserveSell } from "./sell-controls";
import { Button } from "@/components/ui/button";
import { usd } from "@/lib/domain/order";
import type { practiceAccount } from "@/lib/practice/service";
export default function Positions({
  data,
  busy,
  onPage,
  onComplete,
}: {
  data: Awaited<ReturnType<typeof practiceAccount>>;
  busy: boolean;
  onPage: (page: number) => void;
  onComplete: (message: string) => void;
}) {
  const totals = data.positionTotals;
  return (
    <section aria-labelledby="holdings-title">
      <h2 id="holdings-title">Your holdings</h2>
      <p>
        Filled practice contracts only. YES and NO are separate holdings. Open
        orders and cancelled quantities are excluded.
      </p>
      {!data.positionsReconciled && (
        <p role="alert" className="account-error">
          Holdings costs and the practice cash record do not agree. Refresh
          before relying on these totals.
        </p>
      )}
      <dl className="market-status-facts account-card">
        <div>
          <dt>Contracts held</dt>
          <dd>{totals.quantity.toLocaleString("en-US")}</dd>
        </div>
        <div>
          <dt>Contract cost</dt>
          <dd>{usd(totals.principalUnits / 400)}</dd>
        </div>
        <div>
          <dt>Paid practice fees</dt>
          <dd>{usd(totals.feeUnits / 400)}</dd>
        </div>
        <div>
          <dt>Cost including fees</dt>
          <dd>{usd(totals.costBasisUnits / 400)}</dd>
        </div>
        <div>
          <dt>Reserved for selling</dt>
          <dd>{totals.reservedQuantity}</dd>
        </div>
      </dl>
      <p className="account-caption">
        Totals include all fills, across all pages. Market value and profit/loss
        are unavailable until a reliable price source is connected. No results
        or payouts have been settled.
      </p>
      {!data.positions.length && (
        <p>
          {totals.positionCount === 0
            ? "No holdings yet. Contracts appear here after an order fills."
            : "No holdings on this page."}
        </p>
      )}
      {data.positions.map((p) => (
        <article
          className="account-card practice-order"
          key={p.eventId + ":" + p.outcome}
        >
          <p className="eyebrow">
            {p.outcome.toUpperCase()} · {p.quantity.toLocaleString("en-US")}{" "}
            CONTRACTS
          </p>
          <h3>
            {p.eventStatus === "published" ? (
              <a href={`/events/${p.eventId}`}>{p.eventTitle}</a>
            ) : (
              p.eventTitle
            )}
          </h3>
          <dl className="market-status-facts">
            <div>
              <dt>Average fill price</dt>
              <dd>{usd(p.principalUnits / 400 / p.quantity)}</dd>
            </div>
            <div>
              <dt>Average cost with fees</dt>
              <dd>{usd(p.costBasisUnits / 400 / p.quantity)}</dd>
            </div>
            <div>
              <dt>Contract cost</dt>
              <dd>{usd(p.principalUnits / 400)}</dd>
            </div>
            <div>
              <dt>Paid practice fees</dt>
              <dd>{usd(p.feeUnits / 400)}</dd>
            </div>
            <div>
              <dt>Cost including fees</dt>
              <dd>{usd(p.costBasisUnits / 400)}</dd>
            </div>
          </dl>
          <p className="account-caption">
            {p.eventStatus !== "published"
              ? "Event is hidden. Recorded holdings remain. "
              : ""}
            Settlement pending. Average prices are weighted by quantity and
            rounded for display.
            <br />
            Event deadline: {p.closesAt.replace("T", " ")}
            <br />
            Last fill: {p.lastFilledAt.replace("T", " ")}
          </p>
          <ReserveSell position={p} disabled={busy} onComplete={onComplete} />
        </article>
      ))}
      {totals.positionCount > 0 && (
        <div className="event-actions">
          <Button
            disabled={busy || data.positionPage === 0}
            onClick={() => onPage(data.positionPage - 1)}
          >
            Previous holdings
          </Button>
          <span>
            Holdings page {data.positionPage + 1} · {totals.positionCount}{" "}
            positions
          </span>
          <Button
            disabled={busy || !data.positionsHasMore}
            onClick={() => onPage(data.positionPage + 1)}
          >
            Next holdings
          </Button>
        </div>
      )}
    </section>
  );
}

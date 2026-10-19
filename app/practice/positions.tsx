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
      {!data.positionsReconciled && (
        <p role="alert" className="account-error">
          Holdings costs and the practice cash record do not agree. Refresh
          before relying on these totals.
        </p>
      )}
      <dl className="market-status-facts account-card">
        <div>
          <dt>Estimated market value</dt>
          <dd>{usd(totals.marketValueUnits / 400)}</dd>
        </div>
        <div>
          <dt>Unrealized profit / loss</dt>
          <dd
            className={
              totals.marketValueUnits >= totals.markedCostUnits
                ? "price-up"
                : "price-down"
            }
          >
            {usd((totals.marketValueUnits - totals.markedCostUnits) / 400)}
          </dd>
        </div>
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
        Valued at each event’s last trade, including purchase fees in
        profit/loss. This is an estimate, not a guaranteed sale price or a
        settled payout.
        {totals.unpricedPositions > 0 &&
          ` ${totals.unpricedPositions} unpriced positions excluded.`}
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
              <dt>Last trade price</dt>
              <dd>{p.markCents == null ? "—" : `${p.markCents}¢`}</dd>
            </div>
            <div>
              <dt>Estimated market value</dt>
              <dd>
                {p.marketValueUnits == null
                  ? "—"
                  : usd(p.marketValueUnits / 400)}
              </dd>
            </div>
            <div>
              <dt>Unrealized profit / loss</dt>
              <dd
                className={
                  (p.unrealizedPnlUnits ?? 0) >= 0 ? "price-up" : "price-down"
                }
              >
                {p.unrealizedPnlUnits == null
                  ? "—"
                  : usd(p.unrealizedPnlUnits / 400)}
              </dd>
            </div>
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
            <br />
            Price observed: {p.markAt?.replace("T", " ") ?? "Unavailable"}
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

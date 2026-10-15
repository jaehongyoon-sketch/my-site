"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usd } from "@/lib/domain/order";
import type { cashJournal, CashJournalEntry } from "@/lib/practice/journal";
import type { fundingStatus } from "@/lib/funding/service";
type Journal = Awaited<ReturnType<typeof cashJournal>>;
type Funding = Awaited<ReturnType<typeof fundingStatus>>;
const names: Record<CashJournalEntry["kind"], string> = {
  grant: "Practice grant",
  reserve: "Buy reservation",
  fill: "Buy filled",
  release: "Reservation released",
};
const signed = (units: number) => (units > 0 ? "+" : "") + usd(units / 400);
export default function ActivityPanel() {
  const [journal, setJournal] = useState<Journal | null>(null),
    [funding, setFunding] = useState<Funding | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [fundingError, setFundingError] = useState("");
  const generation = useRef(0);
  async function load(page = 0, kind: Journal["kind"] = "all") {
    const request = ++generation.current;
    setBusy(true);
    setError("");
    setFundingError("");
    const result = await Promise.allSettled([
      fetch(`/api/practice/journal?page=${page}&kind=${kind}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      }).then(async (r) => {
        const d = (await r.json()) as Journal & { error?: string };
        if (!r.ok) throw Error(d.error ?? "Activity is unavailable.");
        return d;
      }),
      fetch("/api/funding", {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      }).then(async (r) => {
        const d = (await r.json()) as Funding & { error?: string };
        if (!r.ok) throw Error(d.error ?? "Funding status is unavailable.");
        return d;
      }),
    ]);
    if (request !== generation.current) return;
    if (result[0].status === "fulfilled") setJournal(result[0].value);
    else {
      setJournal(null);
      setError(
        result[0].reason instanceof Error
          ? result[0].reason.message
          : "Activity is unavailable.",
      );
    }
    if (result[1].status === "fulfilled") setFunding(result[1].value);
    else {
      setFunding(null);
      setFundingError(
        "Funding status could not be loaded. Deposits and withdrawals remain unavailable.",
      );
    }
    setBusy(false);
  }
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, []);
  return (
    <>
      <div className="event-actions">
        <Button
          disabled={busy}
          onClick={() => load(journal?.page ?? 0, journal?.kind ?? "all")}
        >
          {busy ? "Loading…" : "Refresh activity"}
        </Button>
        <a href="/account">Account settings</a>
        <a href="/practice/events">Trade activity</a>
        <a href="/practice/reconciliation">Check records</a>
      </div>
      {error && (
        <p role="alert" className="account-error">
          {error}
        </p>
      )}
      <section className="account-card" aria-labelledby="funding-title">
        <p className="eyebrow">REAL USD FUNDING</p>
        <h2 id="funding-title">Deposits &amp; withdrawals</h2>
        <p role="status">
          {funding
            ? "Not connected"
            : busy
              ? "Checking connection…"
              : "Connection unavailable"}
        </p>
        {fundingError && (
          <p role="alert" className="account-error">
            {fundingError}
          </p>
        )}
        <p>
          {funding?.message ??
            "Deposits and withdrawals are unavailable. No transfer can be submitted."}
        </p>
        <div className="event-actions">
          <Button disabled>Deposit unavailable</Button>
          <Button disabled variant="outline">
            Withdraw unavailable
          </Button>
        </div>
        {funding && <p>No transfers have been submitted through this app.</p>}
      </section>
      {journal && (
        <>
          <h2>Practice funds summary</h2>
          {!journal.reconciled && (
            <p role="alert" className="account-error">
              The activity totals do not match the balance record. Refresh to
              check again. If the difference remains, contact the administrator.
              No balance has been adjusted.
            </p>
          )}
          {!journal.wallet ? (
            <p>
              No practice balance yet. <a href="/practice">Start practice</a> to
              receive your one-time virtual grant.
            </p>
          ) : (
            <>
              <dl className="market-status-facts account-card">
                <div>
                  <dt>Practice grant</dt>
                  <dd>{usd(journal.totals.grantUnits / 400)}</dd>
                </div>
                <div>
                  <dt>Available</dt>
                  <dd>{usd(journal.wallet.availableUnits / 400)}</dd>
                </div>
                <div>
                  <dt>Reserved for buys</dt>
                  <dd>{usd(journal.wallet.reservedUnits / 400)}</dd>
                </div>
                <div>
                  <dt>Spent on contracts</dt>
                  <dd>{usd(journal.totals.principalUnits / 400)}</dd>
                </div>
                <div>
                  <dt>Paid practice fees</dt>
                  <dd>{usd(journal.totals.feeUnits / 400)}</dd>
                </div>
              </dl>
              <p className="account-caption">
                {journal.reconciled
                  ? "Activity totals match your balance record."
                  : "Balance comparison needs attention."}{" "}
                All-history totals are independent of filters and pages. Last
                checked: {new Date(journal.asOf).toLocaleString()}.
              </p>
            </>
          )}
          <h2>Cash activity</h2>
          <p>
            Available and reserved amounts show changes, not balances after each
            entry. A fill spends reserved funds and can return a price
            difference. Fee details are included in each fill.
          </p>
          <div className="event-actions">
            <label htmlFor="activity-kind">Activity type</label>
            <Select
              value={journal.kind}
              disabled={busy}
              onValueChange={(value) => load(0, value as Journal["kind"])}
            >
              <SelectTrigger id="activity-kind" className="w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All activity</SelectItem>
                {Object.entries(names).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span>{journal.filteredCount} records</span>
          </div>
          <p className="account-caption">
            Newest recorded time first. Entries sharing a timestamp use a stable
            display order; this is not an execution sequence. Sell reservations
            move contracts, so they appear in your portfolio rather than cash
            activity.
          </p>
          {!journal.entries.length && (
            <p>No activity for this filter and page.</p>
          )}
          {journal.entries.map((e) => (
            <article key={e.id} className="account-card practice-order">
              <p className="eyebrow">
                {names[e.kind]}
                {e.reason ? " · " + e.reason : ""}
              </p>
              {e.eventTitle && <h3>{e.eventTitle}</h3>}
              <p>
                {e.outcome?.toUpperCase()}
                {e.quantity !== null ? ` · ${e.quantity} contracts` : ""}
                {e.kind === "grant"
                  ? "One-time virtual grant · not a deposit"
                  : ""}
              </p>
              <dl className="market-status-facts">
                <div>
                  <dt>Available change</dt>
                  <dd>{signed(e.availableUnits)}</dd>
                </div>
                <div>
                  <dt>Reserved change</dt>
                  <dd>{signed(e.reservedUnits)}</dd>
                </div>
                {e.kind === "fill" && (
                  <>
                    <div>
                      <dt>Contract cost</dt>
                      <dd>{usd(e.principalUnits / 400)}</dd>
                    </div>
                    <div>
                      <dt>Practice fee</dt>
                      <dd>{usd(e.feeUnits / 400)}</dd>
                    </div>
                  </>
                )}
              </dl>
              <p className="account-caption">
                {new Date(e.createdAt).toLocaleString()}
                <br />
                Record: {e.id}
                {e.orderId && (
                  <>
                    <br />
                    Order: {e.orderId}
                  </>
                )}
              </p>
            </article>
          ))}
          <div className="event-actions">
            <Button
              disabled={busy || journal.page === 0}
              onClick={() => load(journal.page - 1, journal.kind)}
            >
              Previous activity
            </Button>
            <span>Page {journal.page + 1}</span>
            <Button
              disabled={busy || !journal.hasMore}
              onClick={() => load(journal.page + 1, journal.kind)}
            >
              Next activity
            </Button>
          </div>
        </>
      )}
    </>
  );
}

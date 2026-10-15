"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import type { listResolutions } from "@/lib/resolutions/service";
type Data = Awaited<ReturnType<typeof listResolutions>>;
type Event = Data["events"][number];
function Review({ event: e, onDone }: { event: Event; onDone: () => void }) {
  const [outcome, setOutcome] = useState(e.outcome ?? "yes"),
    [url, setUrl] = useState(e.evidenceUrl ?? e.sourceUrl),
    [reason, setReason] = useState(e.rationale ?? ""),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef<string | null>(null),
    lock = useRef(false);
  async function submit(action: "propose" | "confirm") {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    pending.current ??= JSON.stringify({
      action,
      eventId: e.id,
      expectedRevision: e.revision ?? 0,
      requestId: crypto.randomUUID(),
      ...(action === "propose"
        ? {
            eventRevision: e.eventRevision,
            outcome,
            evidenceUrl: url,
            rationale: reason,
          }
        : { acknowledgement: "CONFIRM_FINAL_OUTCOME_NO_PAYOUT" }),
    });
    try {
      const r = await fetch("/api/admin/resolutions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: pending.current,
        signal: AbortSignal.timeout(15000),
      });
      const d = (await r.json()) as { saved?: boolean; error?: string };
      if (!r.ok) {
        if (r.status < 500) pending.current = null;
        throw Error(d.error ?? "Not confirmed.");
      }
      if (!d.saved) throw Error("Result not confirmed. Retry this request.");
      pending.current = null;
      setOpen(false);
      onDone();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Not confirmed. Retry this request.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <article className="account-card practice-order">
      <p className="eyebrow">
        {e.resolutionStatus ?? "Not proposed"} · {e.closesAt}
      </p>
      <h2>{e.title}</h2>
      <details>
        <summary>Original resolution rules</summary>
        <p className="event-rules">{e.rules}</p>
        <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer">
          Original source
        </a>
      </details>
      {e.resolutionStatus === "final" ? (
        <>
          <h3>Final: {e.outcome?.toUpperCase()}</h3>
          <p>{e.rationale}</p>
          <a
            href={e.evidenceUrl ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
          >
            Evidence
          </a>
          <p>Confirmed {e.confirmedAt}. No payout has been applied.</p>
        </>
      ) : (
        <>
          <label htmlFor={"outcome-" + e.id}>Proposed outcome</label>
          <Select
            value={outcome}
            disabled={busy || !!pending.current}
            onValueChange={setOutcome}
          >
            <SelectTrigger id={"outcome-" + e.id}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="yes">YES</SelectItem>
              <SelectItem value="no">NO</SelectItem>
              <SelectItem value="void">VOID</SelectItem>
            </SelectContent>
          </Select>
          <label htmlFor={"url-" + e.id}>Evidence URL (HTTPS)</label>
          <Input
            id={"url-" + e.id}
            type="url"
            value={url}
            maxLength={1000}
            disabled={busy || !!pending.current}
            onChange={(x) => setUrl(x.target.value)}
          />
          <label htmlFor={"reason-" + e.id}>
            Reason tied to the original rules
          </label>
          <Textarea
            id={"reason-" + e.id}
            value={reason}
            maxLength={5000}
            disabled={busy || !!pending.current}
            onChange={(x) => setReason(x.target.value)}
          />
          <p className="account-caption">
            Evidence is entered by the administrator; the app does not
            independently verify the source. VOID model: refund execution
            principal and paid practice fees. YES/NO model: winning contracts $1
            each, losing contracts $0; paid fees remain.
          </p>
          {error && (
            <p role="alert" className="account-error">
              {error}
            </p>
          )}
          <div className="event-actions">
            <Button
              disabled={busy || (!pending.current && reason.trim().length < 20)}
              onClick={() => submit("propose")}
            >
              {pending.current ? "Retry pending request" : "Save proposal"}
            </Button>
            {e.resolutionStatus === "proposed" && (
              <Button
                variant="outline"
                disabled={
                  busy ||
                  !!pending.current ||
                  outcome !== e.outcome ||
                  url !== e.evidenceUrl ||
                  reason !== e.rationale
                }
                onClick={() => setOpen(true)}
              >
                Review saved proposal
              </Button>
            )}
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
                  Confirm final result: {e.outcome?.toUpperCase()}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {e.title} · Proposal revision {e.revision}. This locks the
                  saved outcome and evidence. No balance will be credited and no
                  holdings redeemed.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="max-h-64 overflow-y-auto">
                <p>{e.rationale}</p>
                <a
                  href={e.evidenceUrl ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Review evidence
                </a>
              </div>
              {error && <p role="alert">{error}</p>}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy}>Back</AlertDialogCancel>
                <Button disabled={busy} onClick={() => submit("confirm")}>
                  {busy ? "Confirming…" : "Confirm outcome · no payout"}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </article>
  );
}
export default function Panel() {
  const [data, setData] = useState<Data | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const seq = useRef(0);
  async function load(page = 0) {
    const n = ++seq.current;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/admin/resolutions?page=" + page, {
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      const d = (await r.json()) as Data & { error?: string };
      if (!r.ok) throw Error(d.error ?? "Unable to load outcomes.");
      if (n === seq.current) setData(d);
    } catch (e) {
      if (n === seq.current) {
        setData(null);
        setError(e instanceof Error ? e.message : "Unavailable.");
      }
    } finally {
      if (n === seq.current) setBusy(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      seq.current++;
    };
  }, []);
  return (
    <>
      <Button disabled={busy} onClick={() => load(data?.page ?? 0)}>
        {busy ? "Loading…" : "Refresh outcomes"}
      </Button>
      {error && (
        <p role="alert" className="account-error">
          {error}
        </p>
      )}
      {data && (
        <>
          {!data.events.length && <p>No closed events on this page.</p>}
          {data.events.map((e) => (
            <Review
              key={e.id + ":" + e.revision}
              event={e}
              onDone={() => void load(data.page)}
            />
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
        </>
      )}
    </>
  );
}

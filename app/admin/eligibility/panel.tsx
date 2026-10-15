"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import type { adminEligibility } from "@/lib/eligibility/service";
type Data = Awaited<ReturnType<typeof adminEligibility>>;
function Control({
  account: a,
  done,
}: {
  account: Data["accounts"][number];
  done: () => void;
}) {
  const [open, setOpen] = useState(false),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef<string | null>(null),
    lock = useRef(false);
  async function submit() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    pending.current ??= JSON.stringify({
      userId: a.id,
      blocked: !a.blocked,
      expectedRevision: a.revision,
      requestId: crypto.randomUUID(),
      reason,
    });
    try {
      const r = await fetch("/api/admin/eligibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: pending.current,
        signal: AbortSignal.timeout(10000),
      });
      const d = (await r.json()) as { error?: string; saved?: boolean };
      if (!r.ok) {
        if (r.status < 500) pending.current = null;
        throw Error(d.error ?? "Change not confirmed.");
      }
      if (!d.saved)
        throw Error("Change not confirmed. Retry the same request.");
      pending.current = null;
      setOpen(false);
      setReason("");
      done();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Change not confirmed. Retry the same request.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        {a.blocked ? "Remove restriction" : "Restrict trading"}
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={(v) => {
          if (!busy) setOpen(v);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {a.blocked ? "Remove restriction?" : "Restrict practice trading?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {a.displayName} · {a.id}.{" "}
              {a.blocked
                ? "Eligible existing orders may match again. Real trading remains unavailable."
                : "New orders and matching will be blocked. Existing reservations remain until cancelled or expired."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label htmlFor={"reason-" + a.id}>
            Internal reason (8–500 characters)
          </label>
          <Textarea
            id={"reason-" + a.id}
            maxLength={500}
            value={reason}
            disabled={busy || !!pending.current}
            onChange={(e) => setReason(e.target.value)}
          />
          <p className="account-caption">
            Do not enter identity document numbers or bank details. The reason
            is retained in the administrator audit history.
          </p>
          {error && (
            <p role="alert" className="account-error">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Close</AlertDialogCancel>
            <Button
              disabled={busy || (!pending.current && reason.trim().length < 8)}
              onClick={submit}
            >
              {busy
                ? "Saving…"
                : pending.current
                  ? "Retry same change"
                  : "Confirm change"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
export default function EligibilityAdmin() {
  const [data, setData] = useState<Data | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const seq = useRef(0);
  async function load(page = 0) {
    const n = ++seq.current;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/admin/eligibility?page=" + page, {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      const d = (await r.json()) as Data & { error?: string };
      if (!r.ok) throw Error(d.error ?? "Unable to load accounts.");
      if (n === seq.current) setData(d);
    } catch (e) {
      if (n === seq.current) {
        setData(null);
        setError(e instanceof Error ? e.message : "Unable to load accounts.");
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
        {busy ? "Loading…" : "Refresh accounts"}
      </Button>
      {error && (
        <p role="alert" className="account-error">
          {error}
        </p>
      )}
      {data && (
        <>
          {data.accounts.map((a) => (
            <article className="account-card practice-order" key={a.id}>
              <h2>{a.displayName}</h2>
              <p>
                {a.id}
                <br />
                {a.status} ·{" "}
                {a.blocked ? "Trading restricted" : "No trading restriction"} ·
                Revision {a.revision}
              </p>
              {a.reason && <p>Last reason: {a.reason}</p>}
              <Control account={a} done={() => void load(data.page)} />
            </article>
          ))}
          <div className="event-actions">
            <Button
              disabled={busy || data.page === 0}
              onClick={() => load(data.page - 1)}
            >
              Previous accounts
            </Button>
            <span>Page {data.page + 1}</span>
            <Button
              disabled={busy || !data.hasMore}
              onClick={() => load(data.page + 1)}
            >
              Next accounts
            </Button>
          </div>
          <h2>Latest restriction changes</h2>
          {!data.history.length && <p>No restriction changes recorded.</p>}
          {data.history.map((h) => (
            <article key={h.id} className="account-card practice-order">
              <p>
                {h.action === "trading_restricted"
                  ? "Trading restricted"
                  : "Restriction removed"}{" "}
                · {h.accountId}
              </p>
              <p>{h.reason}</p>
              <p className="account-caption">
                {new Date(h.createdAt).toLocaleString()}
              </p>
            </article>
          ))}
        </>
      )}
    </>
  );
}

"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
type Data = {
  paused: boolean;
  revision: number;
  updatedAt: string | null;
  page: number;
  hasMore: boolean;
  entries: {
    id: string;
    actorId: string | null;
    action: string;
    entityType: string;
    entityId: string;
    reason: string;
    createdAt: string;
    correlationId: string;
  }[];
};
export default function Panel() {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reason, setReason] = useState(""),
    [confirm, setConfirm] = useState(false),
    [action, setAction] = useState(""),
    [entityId, setEntity] = useState("");
  const pending = useRef<string | null>(null);
  const locked = useRef(false);
  async function load(page = 0) {
    setError("");
    try {
      const r = await fetch(
        "/api/admin/operations?" +
          new URLSearchParams({ page: String(page), action, entityId }),
        { cache: "no-store" },
      );
      const j = (await r.json()) as Data & { error?: string };
      if (!r.ok) throw Error(j.error);
      setData(j);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Unable to load.");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function save() {
    if (!data || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    pending.current ??= JSON.stringify({
      paused: !data.paused,
      expectedRevision: data.revision,
      requestId: crypto.randomUUID(),
      reason,
    });
    try {
      const r = await fetch("/api/admin/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: pending.current,
        signal: AbortSignal.timeout(15000),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) {
        if (r.status < 500) pending.current = null;
        throw Error(j.error);
      }
      pending.current = null;
      setConfirm(false);
      setReason("");
      await load();
    } catch (e) {
      setConfirm(false);
      setError(
        e instanceof Error
          ? e.message
          : "Request interrupted. Retry the same request.",
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      {error && (
        <p role="alert" className="account-error">
          {error}
        </p>
      )}
      <Button disabled={busy} onClick={() => void load()}>
        Refresh
      </Button>
      {data && (
        <>
          <section className="account-card">
            <h2>
              {data.paused
                ? "Practice trading paused"
                : "Practice trading open"}
            </h2>
            <p>
              Revision {data.revision} · Last change:{" "}
              {data.updatedAt ?? "No changes yet"}
            </p>
            <label htmlFor="reason">
              Internal reason (10–1,000 characters)
            </label>
            <Textarea
              id="reason"
              value={reason}
              maxLength={1000}
              disabled={busy || !!pending.current}
              onChange={(e) => setReason(e.target.value)}
            />
            <Button
              disabled={busy || (!pending.current && reason.trim().length < 10)}
              onClick={() => (pending.current ? void save() : setConfirm(true))}
            >
              {busy
                ? "Saving…"
                : pending.current
                  ? "Retry same request"
                  : data.paused
                    ? "Resume practice trading"
                    : "Pause practice trading"}
            </Button>
          </section>
          <form
            className="event-search"
            onSubmit={(e) => {
              e.preventDefault();
              void load();
            }}
          >
            <label>
              Exact action
              <Input
                value={action}
                maxLength={80}
                onChange={(e) => setAction(e.target.value)}
                placeholder="practice.pause"
              />
            </label>
            <label>
              Exact event / account ID
              <Input
                value={entityId}
                maxLength={160}
                onChange={(e) => setEntity(e.target.value)}
              />
            </label>
            <Button disabled={busy}>Filter audit log</Button>
          </form>
          <p>
            Administrator changes only. This log is read-only; it is not a
            complete trading ledger.
          </p>
          {data.entries.map((e) => (
            <section className="account-card" key={e.id}>
              <h3>{e.action}</h3>
              <p>
                {e.createdAt} · Actor: {e.actorId ?? "System"}
              </p>
              <p style={{ overflowWrap: "anywhere" }}>
                {e.entityType}: {e.entityId}
              </p>
              <details>
                <summary>Reason & recorded details</summary>
                <pre
                  style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                >
                  {e.reason}
                </pre>
                <p>Reference: {e.correlationId}</p>
              </details>
            </section>
          ))}
          {!data.entries.length && <p>No matching audit records.</p>}
          <nav className="admin-pagination">
            <Button
              disabled={busy || data.page === 0}
              onClick={() => void load(data.page - 1)}
            >
              Previous
            </Button>
            <span>Page {data.page + 1}</span>
            <Button
              disabled={busy || !data.hasMore}
              onClick={() => void load(data.page + 1)}
            >
              Next
            </Button>
          </nav>
          <AlertDialog open={confirm} onOpenChange={setConfirm}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {data.paused ? "Resume" : "Pause"} practice trading?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Applies to every event and account. Existing funds and fills
                  are preserved. Viewing and cancellation stay available.
                  Reason: {reason}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                <AlertDialogAction disabled={busy} onClick={() => void save()}>
                  Confirm change
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </>
  );
}

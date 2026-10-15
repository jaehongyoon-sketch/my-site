"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
export default function SaveEvent({ id }: { id: string }) {
  const [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [ready, setReady] = useState(false);
  async function load() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/watchlist", { cache: "no-store" });
      if (r.status === 401 || r.status === 403) {
        setReady(false);
        return;
      }
      if (!r.ok) throw new Error("Saved events unavailable.");
      const d = (await r.json()) as { marketIds: string[] };
      setSaved(d.marketIds.includes(id));
      setReady(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load saved events.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, [id]);
  return (
    <div className="event-actions">
      <Button
        disabled={busy || !!error}
        onClick={async () => {
          if (!ready) {
            window.location.assign("/account");
            return;
          }
          setBusy(true);
          try {
            const r = await fetch("/api/watchlist", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ marketId: id, saved: !saved }),
            });
            if (!r.ok) throw new Error("Could not save. Reload and retry.");
            const d = (await r.json()) as { marketIds: string[] };
            setSaved(d.marketIds.includes(id));
          } catch (e) {
            setError(e instanceof Error ? e.message : "Unable to save.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Loading…" : saved ? "Remove from saved events" : "Save event"}
      </Button>
      {error && (
        <p role="alert">
          {error} <button onClick={() => void load()}>Retry</button>
        </p>
      )}
    </div>
  );
}

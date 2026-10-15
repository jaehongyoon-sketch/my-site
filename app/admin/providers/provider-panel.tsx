"use client";
import { useState } from "react";
import type { Approval, getProviderControls } from "@/lib/providers/control";
import { Button } from "@/components/ui/button";
type Data = Awaited<ReturnType<typeof getProviderControls>>;
const labels: Record<Approval, string> = {
  unapproved: "Not approved",
  testing: "Sandbox testing",
  approved: "Approval recorded",
  suspended: "Suspended",
};
export default function ProviderPanel({ initial }: { initial: Data }) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function save(
    event: React.FormEvent<HTMLFormElement>,
    connection: Data["connections"][number],
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/providers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId: connection.id,
          expectedRevision: connection.revision,
          approval: fields.get("approval"),
          note: fields.get("note"),
          evidence: fields.get("evidence"),
        }),
      });
      const result = (await response.json()) as Data & { error?: string };
      if (!response.ok) throw new Error(result.error || "Unable to save.");
      setData(result);
      setMessage("Approval record saved. Trading remains unavailable.");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to save. Reload and retry.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="account-card provider-summary">
        <strong>Current catalog: Event-owned events</strong>
        <p>
          Kalshi connections are legacy and inactive. These records track your review;
          they do not obtain permission from Kalshi or activate market data,
          customer accounts, or trading.
        </p>
      </section>
      {error && (
        <p className="provider-error" role="alert">
          {error} <a href="/admin/providers">Reload connections</a>
        </p>
      )}
      {message && (
        <p role="status" className="provider-success">
          {message}
        </p>
      )}
      <div className="provider-grid">
        {data.connections.map((connection) => (
          <section
            className="account-card"
            key={`${connection.id}:${connection.revision}`}
          >
            <p className="eyebrow">
              {connection.environment === "live"
                ? "PRODUCTION"
                : "TEST ENVIRONMENT"}
            </p>
            <h2>{connection.label}</h2>
            <p className="provider-status">{labels[connection.approval]}</p>
            <dl className="provider-capabilities">
              <dt>Market data</dt>
              <dd>{connection.marketData.reason}</dd>
              <dt>Orders</dt>
              <dd>{connection.orders.reason}</dd>
            </dl>
            <form onSubmit={(e) => save(e, connection)}>
              <fieldset disabled={busy}>
                <label htmlFor={`${connection.id}-approval`}>
                  Approval status
                </label>
                <select
                  id={`${connection.id}-approval`}
                  name="approval"
                  defaultValue={connection.approval}
                >
                  {Object.entries(labels)
                    .filter(
                      ([value]) =>
                        connection.environment !== "live" ||
                        value !== "testing",
                    )
                    .map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                </select>
                <label htmlFor={`${connection.id}-note`}>
                  Reason for change
                </label>
                <textarea
                  id={`${connection.id}-note`}
                  name="note"
                  required
                  minLength={5}
                  maxLength={500}
                  rows={3}
                  placeholder="Describe the review or reason for suspension."
                />
                <label htmlFor={`${connection.id}-evidence`}>
                  Approval reference
                </label>
                <input
                  id={`${connection.id}-evidence`}
                  name="evidence"
                  maxLength={500}
                  placeholder="Agreement or approval reference"
                />
                <p className="account-caption">
                  Required for “Approval recorded”. Do not paste passwords or
                  API keys.
                </p>
                <Button type="submit">
                  {busy ? "Saving…" : "Save review"}
                </Button>
              </fieldset>
            </form>
          </section>
        ))}
      </div>
      <section className="account-card provider-history">
        <h2>Recent changes</h2>
        <p className="account-caption">
          Latest 20 reviews. Every saved review records the administrator and
          time.
        </p>
        {data.history.length === 0 ? (
          <p>No reviews recorded yet.</p>
        ) : (
          <ol>
            {data.history.map((item) => {
              const detail = JSON.parse(item.reason);
              return (
                <li key={item.id}>
                  <strong>
                    {item.connectionId} ·{" "}
                    {labels[detail.to as Approval] ?? detail.to}
                  </strong>
                  <p>{detail.note}</p>
                  {detail.evidence && <p>Reference: {detail.evidence}</p>}
                  <small>
                    {item.createdAt.replace("T", " ").slice(0, 19)} UTC ·
                    Administrator {item.actorId} · Revision {detail.revision}
                  </small>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </>
  );
}

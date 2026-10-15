"use client";
import { useState } from "react";
import type { OwnEvent, listOwnEvents } from "@/lib/events/service";
import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
export default function EventManager({
  initial,
}: {
  initial: Awaited<ReturnType<typeof listOwnEvents>>;
}) {
  const [editing, setEditing] = useState<OwnEvent | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [archiveTarget, setArchiveTarget] = useState<OwnEvent | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OwnEvent | null>(null);
  const [draftId, setDraftId] = useState("");
  async function save(input: object, method = "PUT") {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/admin/events", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(data.error ?? "Unable to save.");
      const status = (input as { status?: string }).status;
      window.location.assign(
        "/admin/events?notice=" +
          (method === "DELETE"
            ? "deleted"
            : status === "published"
              ? "published"
              : status === "archived"
                ? "archived"
                : "draft"),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save.");
      setBusy(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }
  function changeStatus(event: OwnEvent, status: "published" | "archived") {
    return save({
      id: event.id,
      revision: event.revision,
      title: event.title,
      category: event.category,
      rules: event.rules,
      sourceUrl: event.sourceUrl,
      closesAt: event.closesAt,
      status,
    });
  }
  const pageLink = (page: number) =>
    "/admin/events?" +
    new URLSearchParams({
      page: String(page),
      q: initial.q,
      status: initial.status,
    });
  return (
    <>
      <section className="account-card event-editor">
        <h2>{editing ? "Edit draft" : "Create event"}</h2>
        <p className="account-caption">Questions and rules cannot be edited after publishing.</p>
        {error && (
          <p role="alert" className="account-error">
            {error} <a href="/admin/events">Reload events</a>
          </p>
        )}
        <form
          key={editing?.id ?? "new"}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const status =
              (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") ??
              "draft";
            const id = editing?.id || draftId || crypto.randomUUID();
            setDraftId(id);
            void save({
              id,
              revision: editing?.revision ?? 0,
              title: f.get("title"),
              category: f.get("category"),
              rules: f.get("rules"),
              sourceUrl: f.get("sourceUrl"),
              closesAt: new Date(String(f.get("closesAt")) + "Z").toISOString(),
              status,
            });
          }}
        >
          <fieldset disabled={busy}>
            <label htmlFor="event-title">Question</label>
            <Input
              id="event-title"
              name="title"
              required
              minLength={8}
              maxLength={160}
              defaultValue={editing?.title}
              placeholder="Will a specific, measurable outcome happen?"
            />
            <div className="event-fields">
              <div>
                <label htmlFor="event-category">Category</label>
                <Select
                  name="category"
                  defaultValue={editing?.category ?? "Other"}
                >
                  <SelectTrigger id="event-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[
                      "Economy",
                      "Politics",
                      "Sports",
                      "Technology",
                      "Science",
                      "Other",
                    ].map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label htmlFor="event-close">Closing date & time (UTC)</label>
                <Input
                  id="event-close"
                  name="closesAt"
                  type="datetime-local"
                  required
                  defaultValue={editing?.closesAt.slice(0, 16)}
                />
              </div>
            </div>
            <label htmlFor="event-rules">Resolution rules</label>
            <Textarea
              id="event-rules"
              name="rules"
              required
              minLength={30}
              maxLength={5000}
              rows={6}
              defaultValue={editing?.rules}
              placeholder="State what counts as YES or NO, the authoritative source, the deadline, and how delays or cancellations are handled."
            />
            <label htmlFor="event-source">Resolution source URL</label>
            <Input
              id="event-source"
              name="sourceUrl"
              type="url"
              pattern="https://.*"
              required
              maxLength={1000}
              defaultValue={editing?.sourceUrl}
              placeholder="https://…"
            />
            <div className="event-actions">
              <Button type="submit" value="draft">
                {busy ? "Saving…" : "Save draft"}
              </Button>
              <Button type="submit" value="published" variant="outline">
                Publish event
              </Button>
              {editing && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setEditing(null);
                    setDraftId("");
                    setError("");
                  }}
                >
                  Cancel edit
                </Button>
              )}
            </div>
          </fieldset>
        </form>
      </section>
      <form className="event-search" action="/admin/events">
        <label>
          Search
          <Input name="q" defaultValue={initial.q} maxLength={100} />
        </label>
        <label>
          Status
          <select name="status" defaultValue={initial.status}>
            {["all", "draft", "published", "archived"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <Button>Search</Button>
      </form>
      <div className="event-grid">
        {initial.events.map((event) => (
          <section className="account-card event-card" key={event.id}>
            <p className="eyebrow">
              {event.category} ·{" "}
              {event.status === "archived"
                ? "Hidden (archived)"
                : event.status === "draft"
                  ? "Draft · Not public"
                  : "Published"}
            </p>
            <h2>{event.title}</h2>
            {event.status === "archived" && (
              <p>
                This event is hidden from the home page. Republish it to make it
                visible again.
              </p>
            )}
            {event.status === "published" && (
              <p>
                {event.closesAt <= new Date().toISOString()
                  ? "Visible under Closed on the home page."
                  : "Visible under Upcoming on the home page."}
              </p>
            )}
            <p>Closes {event.closesAt.replace("T", " ").slice(0, 16)} UTC</p>
            <div className="event-actions">
              {event.status === "draft" && (
                <Button
                  disabled={busy}
                  onClick={() => {
                    setEditing(event);
                    setError("");
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  Edit draft
                </Button>
              )}
              <Button
                disabled={busy}
                variant="outline"
                onClick={() => {
                  setEditing({
                    ...event,
                    id: crypto.randomUUID(),
                    revision: 0,
                    status: "draft",
                  });
                  setDraftId("");
                  setError("");
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              >
                Copy to new draft
              </Button>
              {event.status === "draft" && (
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={() => setDeleteTarget(event)}
                >
                  Delete draft
                </Button>
              )}
              {event.status === "published" && (
                <a href={`/events/${event.id}`}>View event</a>
              )}
              {event.status !== "archived" && (
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={() => setArchiveTarget(event)}
                >
                  Hide from home page
                </Button>
              )}
              {event.status === "archived" &&
                (event.closesAt > new Date().toISOString() ? (
                  <Button
                    disabled={busy}
                    onClick={() => void changeStatus(event, "published")}
                  >
                    Republish event
                  </Button>
                ) : (
                  <p>
                    The original closing time has passed. Create a new event
                    with a future closing time.
                  </p>
                ))}
            </div>
          </section>
        ))}
      </div>
      {initial.events.length === 0 && (
        <p>No events found. Create your first event above.</p>
      )}
      <nav className="admin-pagination" aria-label="Admin event pages">
        {initial.page > 0 && <a href={pageLink(initial.page - 1)}>Previous</a>}
        <span>Page {initial.page + 1}</span>
        {initial.hasMore && <a href={pageLink(initial.page + 1)}>Next</a>}
      </nav>
      <AlertDialog
        open={Boolean(archiveTarget)}
        onOpenChange={(open) => {
          if (!open && !busy) setArchiveTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Hide this event from the home page?
            </AlertDialogTitle>
            <AlertDialogDescription>
              “{archiveTarget?.title}” will be archived and hidden from all
              catalog results and its public detail page. Its data will be kept.
              You can republish it before its original closing time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep visible</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => {
                if (archiveTarget) void changeStatus(archiveTarget, "archived");
              }}
            >
              Hide event
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleteTarget?.title}” will be removed permanently. This cannot
              be undone. Published events must be hidden instead so trading
              history is preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep draft</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => {
                if (deleteTarget)
                  void save(
                    {
                      id: deleteTarget.id,
                      revision: deleteTarget.revision,
                      acknowledgement: "DELETE_DRAFT",
                    },
                    "DELETE",
                  );
              }}
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

import OperationsBanner from "@/app/practice/operations-banner";
import ResolutionPanel from "../resolution-panel";
import OrderPreviewPanel from "../order-preview";
import MarketPanel from "../market-panel";
import { deriveMarketState } from "@/lib/events/market-state";
import SaveEvent from "../save-event";
import { env } from "cloudflare:workers";
import { getOwnEvent } from "@/lib/events/service";
import { notFound } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function EventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  let event;
  try {
    if (!env.DB) throw new Error();
    event = await getOwnEvent(env.DB, (await params).id);
  } catch {
    return (
      <main id="main-content" tabIndex={-1} className="admin-main">
        <h1>Event unavailable</h1>
        <p>Please reload to retry.</p>
        <a href="/">Back to events</a>
      </main>
    );
  }
  if (!event) notFound();
  return (
    <div className="account-page">
      <main id="main-content" tabIndex={-1} className="admin-main">
        <p className="eyebrow">{event.category}</p>
        <h1>{event.title}</h1>
        <p className="sub">
          Closes {event.closesAt.replace("T", " ").slice(0, 16)} UTC
        </p>
        <OperationsBanner />
        <ResolutionPanel eventId={event.id} />
        <MarketPanel initial={deriveMarketState(event)} />
        <OrderPreviewPanel
          eventId={event.id}
          eventRevision={event.revision}
          closesAt={event.closesAt}
        />
        <section className="account-card">
          <SaveEvent id={event.id} />
          <h2>Resolution rules</h2>
          <p className="event-rules">{event.rules}</p>
          <a href={event.sourceUrl} target="_blank" rel="noopener noreferrer">
            View resolution source ↗
          </a>
        </section>
      </main>
    </div>
  );
}

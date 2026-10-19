import { readLastPrices } from "@/lib/practice/market";
import { getGoogleUser } from "@/lib/auth/google";
import { activeAccount } from "@/lib/accounts/access";
import { env } from "cloudflare:workers";
import { listOwnEvents } from "@/lib/events/service";
import {
  ArrowDown,
  ArrowUpRight,
  Search,
  Landmark,
  Trophy,
  Cpu,
  FlaskConical,
  Globe2,
  ChartNoAxesCombined,
  Bookmark,
} from "lucide-react";
export const dynamic = "force-dynamic";
const categories = [
  {
    name: "Economy",
    icon: ChartNoAxesCombined,
    tone: "blue",
  },
  {
    name: "Politics",
    icon: Landmark,
    tone: "purple",
  },
  {
    name: "Sports",
    icon: Trophy,
    tone: "orange",
  },
  {
    name: "Technology",
    icon: Cpu,
    tone: "blue",
  },
  {
    name: "Science",
    icon: FlaskConical,
    tone: "green",
  },
  {
    name: "Other",
    icon: Globe2,
    tone: "purple",
  },
];
type EventItem = Awaited<ReturnType<typeof listOwnEvents>>["events"][number];
function EventCard({
  event,
  now,
  price,
}: {
  event: EventItem;
  now: string;
  price?: number;
}) {
  const category =
    categories.find((c) => c.name === event.category) ?? categories[5];
  const Icon = category.icon;
  const closed = event.closesAt <= now;
  return (
    <a className="market-card" href={`/events/${event.id}`}>
      <div className="market-card-top">
        <span className={`category-icon tone-${category.tone}`}>
          <Icon size={23} aria-hidden="true" />
        </span>
        <span className={`market-status ${closed ? "closed" : ""}`}>
          {closed ? "Closed" : "Open"}
        </span>
      </div>
      <span className="market-category">{event.category}</span>
      <h3>{event.title}</h3>
      <div className="market-outcomes" aria-label="Last trade prices">
        <span>
          Yes <span>{price == null ? "—" : `${price}¢`}</span>
        </span>
        <span>
          No <span>{price == null ? "—" : `${100 - price}¢`}</span>
        </span>
      </div>
      <small>
        {price == null ? "Awaiting first trade" : "Last trade · Virtual funds"}
      </small>
      <div className="market-card-footer">
        <time dateTime={event.closesAt}>
          {closed ? "Closed" : "Closes"}{" "}
          {new Intl.DateTimeFormat("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            timeZone: "UTC",
          }).format(new Date(event.closesAt))}{" "}
          · UTC
        </time>
        <ArrowUpRight size={16} aria-hidden="true" />
      </div>
    </a>
  );
}
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    page?: string;
    status?: string;
    category?: string;
    saved?: string;
  }>;
}) {
  const params = await searchParams;
  const saved = params.saved === "1";
  const browse =
    !saved &&
    !params.q &&
    (!params.category || params.category === "all") &&
    Number(params.page ?? 0) === 0 &&
    (!params.status || params.status === "all");
  let data: Awaited<ReturnType<typeof listOwnEvents>> | null = null;
  let groups: { category: (typeof categories)[number]; events: EventItem[] }[] =
    [];
  let error = "",
    needsSignIn = false;
  try {
    const db = env.DB;
    if (!db) throw Error();
    let savedUserId: string | undefined;
    if (saved) {
      const user = await getGoogleUser();
      if (!user) needsSignIn = true;
      else savedUserId = (await activeAccount(db, user)).id;
    }
    if (!needsSignIn) {
      data = await listOwnEvents(db, {
        ...params,
        status: params.status ?? "all",
        page: Number(params.page ?? 0),
        savedUserId,
      });
      if (browse)
        groups = await Promise.all(
          categories.map(async (category) => ({
            category,
            events: (
              await listOwnEvents(db, {
                category: category.name,
                status: "all",
              })
            ).events.slice(0, 3),
          })),
        );
    }
  } catch {
    error = "We couldn’t load these events. Try again or reset your filters.";
  }
  const feedEvents = data?.events ?? [];
  const more = Boolean(data?.hasMore);
  let prices = new Map<string, number>();
  try {
    if (env.DB)
      prices = await readLastPrices(
        env.DB,
        [...feedEvents, ...groups.flatMap((g) => g.events)].map((e) => e.id),
      );
  } catch {
    /* The event list remains usable when market data is unavailable. */
  }
  const now = new Date().toISOString();
  const link = (overrides: Record<string, string>) =>
    "/?" +
    new URLSearchParams({
      q: params.q ?? "",
      category: params.category ?? "all",
      status: params.status ?? "all",
      saved: saved ? "1" : "",
      ...overrides,
    });
  return (
    <div className="discover-page">
      <main id="main-content" tabIndex={-1} className="discover-main">
        <div className="discover-heading">
          <div>
            <h1>{saved ? "Saved events" : "Events"}</h1>
          </div>
          <a className="discover-saved" href={saved ? "/" : "/?saved=1"}>
            <Bookmark size={17} aria-hidden="true" />
            {saved ? "Explore all events" : "My saved events"}
          </a>
        </div>
        <form className="discover-search" action="/" role="search">
          {saved && <input type="hidden" name="saved" value="1" />}
          <input
            type="hidden"
            name="category"
            value={params.category ?? "all"}
          />
          <div className="discover-search-input">
            <Search size={20} aria-hidden="true" />
            <input
              aria-label="Search events"
              name="q"
              defaultValue={params.q ?? ""}
              placeholder="Search events, topics, or questions"
              maxLength={100}
            />
          </div>
          <select
            aria-label="Event status"
            name="status"
            defaultValue={params.status ?? "all"}
          >
            <option value="all">All events</option>
            <option value="open">Open events</option>
            <option value="closed">Closed events</option>
          </select>
          <button type="submit">Search</button>
        </form>
        <nav className="category-tabs" aria-label="Event categories">
          <a
            href={link({ category: "all", page: "0" })}
            aria-current={
              !params.category || params.category === "all" ? "page" : undefined
            }
          >
            All events
          </a>
          {categories.map(({ name, icon: Icon }) => (
            <a
              key={name}
              href={
                browse
                  ? `#category-${name}`
                  : link({ category: name, page: "0" })
              }
              aria-current={params.category === name ? "page" : undefined}
            >
              <Icon size={16} aria-hidden="true" />
              {name}
            </a>
          ))}
        </nav>
        <div className="discover-notice">
          <span className="notice-dot" />
          Practice only · Virtual funds
          <a href="/practice">
            View portfolio <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </div>
        {needsSignIn ? (
          <section className="discover-empty">
            <Bookmark size={28} />
            <h2>Saved events</h2>
            <p>Sign in to see the events you’ve saved.</p>
            <a className="discover-cta" href="/account">
              Sign in with Google
            </a>
          </section>
        ) : error ? (
          <section className="discover-empty" role="alert">
            <h2>Events unavailable</h2>
            <p>{error}</p>
            <a className="discover-cta" href="/">
              Reset and retry
            </a>
          </section>
        ) : (
          data && (
            <>
              <section aria-labelledby="events-heading">
                <div className="section-heading">
                  <h2 id="events-heading">
                    {saved
                      ? "Saved events"
                      : params.q
                        ? `Results for “${params.q}”`
                        : params.category && params.category !== "all"
                          ? params.category
                          : "Explore events"}
                  </h2>
                  {browse && (
                    <a href="#browse-categories">
                      Browse by category{" "}
                      <ArrowDown size={15} aria-hidden="true" />
                    </a>
                  )}
                </div>
                {feedEvents.length ? (
                  <div className="market-grid">
                    {feedEvents.map((event) => (
                      <EventCard
                        key={event.id}
                        event={event}
                        now={now}
                        price={prices.get(event.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="discover-empty">
                    <h3>
                      {saved ? "No saved events yet" : "No events to show"}
                    </h3>
                    <p>
                      {saved
                        ? "Open an event and save it to find it here."
                        : "Try another category or clear your filters."}
                    </p>
                    <a href="/" className="discover-cta">
                      Explore all events
                    </a>
                  </div>
                )}
                {(data.page > 0 || more) && (
                  <nav className="discover-pagination" aria-label="Event pages">
                    {data.page > 0 && (
                      <a href={link({ page: String(data.page - 1) })}>
                        ← Previous
                      </a>
                    )}
                    <span>Page {data.page + 1}</span>
                    {more && (
                      <a href={link({ page: String(data.page + 1) })}>
                        More events →
                      </a>
                    )}
                  </nav>
                )}
              </section>
              {browse && (
                <div id="browse-categories" className="category-sections">
                  <div className="browse-title">
                    <h2>Categories</h2>
                  </div>
                  {groups.map(({ category, events }) => {
                    const Icon = category.icon;
                    return (
                      <section
                        className="category-section"
                        id={`category-${category.name}`}
                        key={category.name}
                        aria-labelledby={`heading-${category.name}`}
                      >
                        <div className="section-heading">
                          <div className="category-heading">
                            <span
                              className={`category-icon tone-${category.tone}`}
                            >
                              <Icon size={21} aria-hidden="true" />
                            </span>
                            <div>
                              <h2 id={`heading-${category.name}`}>
                                {category.name}
                              </h2>
                            </div>
                          </div>
                          <a
                            href={link({ category: category.name, page: "0" })}
                          >
                            View all{" "}
                            <ArrowUpRight size={16} aria-hidden="true" />
                          </a>
                        </div>
                        {events.length ? (
                          <div className="market-grid">
                            {events.map((event) => (
                              <EventCard
                                key={event.id}
                                event={event}
                                now={now}
                                price={prices.get(event.id)}
                              />
                            ))}
                          </div>
                        ) : (
                          <div className="category-empty">No events</div>
                        )}
                      </section>
                    );
                  })}
                </div>
              )}
            </>
          )
        )}
        <footer className="discover-footer">
          <a className="brand" href="/">
            event<span>.</span>
          </a>

          <a href="/account">Your account →</a>
        </footer>
      </main>
    </div>
  );
}

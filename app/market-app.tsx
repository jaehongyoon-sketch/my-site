"use client";
import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Bookmark,
  Search,
  ArrowLeft,
  LockKeyhole,
  ArrowRight,
  Globe2,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { Market, Outcome, Quote } from "@/lib/domain/types";
import { estimateOrder, usd } from "@/lib/domain/order";
import { quoteSchema } from "@/lib/domain/validation";
function Spark({
  values,
  large = false,
}: {
  values: number[];
  large?: boolean;
}) {
  const points = values
    .map((v, i) => `${(i * 100) / (values.length - 1)},${100 - v}`)
    .join(" ");
  return (
    <svg
      className={large ? "chart large" : "chart"}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      role="img"
      aria-label="Illustrative price history, not live data"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={large ? 0.7 : 1.8}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
export default function MarketApp({ markets }: { markets: Market[] }) {
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState("All markets"),
    [selected, setSelected] = useState<Market | null>(null),
    [saved, setSaved] = useState<string[]>([]),
    [onlySaved, setOnlySaved] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>("yes"),
    [quantity, setQuantity] = useState("10"),
    [quote, setQuote] = useState<Quote | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const filtered = markets.filter(
    (m) =>
      (category === "All markets" || m.category === category) &&
      (!onlySaved || saved.includes(m.id)) &&
      m.title.toLowerCase().includes(query.toLowerCase()),
  );
  const choose = (market: Market) => {
    setSelected(market);
    setQuote(null);
    setError("");
    setQuantity("10");
    setOutcome("yes");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const [watchReady, setWatchReady] = useState(false),
    [watchError, setWatchError] = useState(""),
    [savingId, setSavingId] = useState<string | null>(null),
    [watchAccess, setWatchAccess] = useState(false);
  async function loadWatchlist() {
    setWatchError("");
    setWatchReady(false);
    try {
      const r = await fetch("/api/watchlist", { cache: "no-store" });
      const d = (await r.json()) as { marketIds?: string[]; error?: string };
      if (r.status === 401 || r.status === 403) {
        setWatchAccess(false);
        setSaved([]);
        return;
      }
      if (!r.ok || !Array.isArray(d.marketIds))
        throw new Error(d.error ?? "Unable to load watchlist.");
      setSaved(d.marketIds);
      setWatchAccess(true);
    } catch (e) {
      setWatchError(
        e instanceof Error ? e.message : "Unable to load watchlist.",
      );
    } finally {
      setWatchReady(true);
    }
  }
  useEffect(() => {
    void loadWatchlist();
  }, []);
  async function toggle(id: string) {
    if (!watchReady || savingId) return;
    if (!watchAccess) {
      window.location.assign("/account");
      return;
    }
    setSavingId(id);
    setWatchError("");
    try {
      const r = await fetch("/api/watchlist", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marketId: id, saved: !saved.includes(id) }),
      });
      const d = (await r.json()) as { marketIds?: string[]; error?: string };
      if (r.status === 401 || r.status === 403) {
        setSaved([]);
        setWatchAccess(false);
      }
      if (!r.ok || !Array.isArray(d.marketIds))
        throw new Error(d.error ?? "Unable to save watchlist.");
      setSaved(d.marketIds);
    } catch (e) {
      setWatchError(
        e instanceof Error ? e.message : "Unable to save watchlist.",
      );
    } finally {
      setSavingId(null);
    }
  }
  let estimate = null;
  try {
    if (selected)
      estimate = estimateOrder(
        outcome === "yes" ? selected.yesAskCents : selected.noAskCents,
        Number(quantity),
      );
  } catch {}
  async function review() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          marketId: selected.id,
          outcome,
          quantity: Number(quantity),
        }),
      });
      const data = await r.json();
      if (!r.ok)
        throw new Error(
          "Unable to calculate this order. Check the quantity and try again.",
        );
      setQuote(quoteSchema.parse(data));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to load estimate. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (tool: unknown, options: unknown) => unknown;
        };
      }
    ).modelContext;
    if (!context) return;
    const controller = new AbortController();
    try {
      Promise.resolve(
        context.registerTool(
          {
            name: "search_sample_markets",
            description:
              "Filter visible development sample markets. Does not trade or change money.",
            inputSchema: {
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"],
              additionalProperties: false,
            },
            annotations: { readOnlyHint: false },
            execute: async (input: unknown) => {
              if (
                !input ||
                typeof (input as { query?: unknown }).query !== "string"
              )
                throw new Error("query must be a string");
              const q = (input as { query: string }).query;
              if (q.length > 200) throw new Error("query too long");
              setSelected(null);
              setOnlySaved(false);
              setCategory("All markets");
              setQuery(q);
              await new Promise((resolve) => setTimeout(resolve, 0));
              return {
                environment: "development",
                matches: markets
                  .filter((m) =>
                    m.title.toLowerCase().includes(q.toLowerCase()),
                  )
                  .map((m) => ({ id: m.id, title: m.title })),
              };
            },
          },
          { signal: controller.signal },
        ),
      ).catch(() => {});
    } catch {}
    return () => controller.abort();
  }, [markets]);
  return (
    <>
      <div className="dev-banner">
        <span>DEVELOPMENT PREVIEW</span> Sample markets & prices. No real money
        or orders.
      </div>
      <header className="site-header">
        <button
          className="brand"
          onClick={() => {
            setSelected(null);
            setOnlySaved(false);
          }}
          aria-label="Event home"
        >
          <span className="brand-mark">e.</span>event
          <span className="brand-dot">/</span>
        </button>
        <nav aria-label="Main">
          <button
            className={!onlySaved ? "active" : ""}
            onClick={() => {
              setSelected(null);
              setOnlySaved(false);
            }}
          >
            Markets
          </button>
          <button
            className={onlySaved ? "active" : ""}
            onClick={() => {
              setSelected(null);
              setOnlySaved(true);
            }}
          >
            Watchlist <span>{saved.length}</span>
          </button>
        </nav>
        <a className="account-link" href="/account">
          Account
        </a>
      </header>
      <main className="shell">
        {watchError && (
          <div className="account-error" role="alert">
            {watchError}
            <button onClick={() => void loadWatchlist()}>
              Retry loading saved markets
            </button>
          </div>
        )}
        {onlySaved && !watchReady && (
          <p role="status">Loading your saved markets…</p>
        )}
        {onlySaved && watchReady && !watchAccess && !watchError && (
          <p className="notice">
            <a href="/account">Sign in and create your Event profile</a> to save
            markets across visits.
          </p>
        )}
        {!selected ? (
          <>
            <section className="intro">
              <div>
                <p className="eyebrow">A VIEW ON WHAT COMES NEXT</p>
                <h1>
                  {onlySaved
                    ? "Your watchlist."
                    : "The world, in probabilities."}
                </h1>
                <p className="sub">Explore the questions shaping tomorrow.</p>
              </div>
              <div className="session-note">
                <Globe2 size={18} />
                <div>
                  US market experience<small>Day 06 · Development build</small>
                </div>
              </div>
            </section>
            <div className="toolbar">
              <div className="categories" aria-label="Filter by category">
                {["All markets", "Economy", "Climate", "Technology"].map(
                  (c) => (
                    <Button
                      key={c}
                      variant={category === c ? "default" : "ghost"}
                      onClick={() => setCategory(c)}
                      aria-pressed={category === c}
                    >
                      {c}
                    </Button>
                  ),
                )}
              </div>
              <label className="search">
                <Search size={17} />
                <Input
                  aria-label="Search markets"
                  placeholder="Search a question"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
            </div>
            <div className="section-line">
              <span>{onlySaved ? "SAVED MARKETS" : "EXPLORE MARKETS"}</span>
              <span>{filtered.length} sample markets</span>
            </div>
            <section className="market-grid" aria-label="Markets">
              {filtered.map((m, i) => (
                <article
                  className={`market-card ${i === 0 ? "featured" : ""}`}
                  key={m.id}
                >
                  <div className="card-top">
                    <span className="market-symbol">{m.symbol}</span>
                    <span className="category">{m.category}</span>
                    <button
                      className="bookmark"
                      onClick={() => void toggle(m.id)}
                      disabled={
                        !watchReady || Boolean(savingId) || Boolean(watchError)
                      }
                      aria-label={`${saved.includes(m.id) ? "Remove" : "Add"} ${m.title} ${saved.includes(m.id) ? "from" : "to"} watchlist`}
                      aria-pressed={saved.includes(m.id)}
                    >
                      <Bookmark
                        size={19}
                        fill={saved.includes(m.id) ? "currentColor" : "none"}
                      />
                    </button>
                  </div>
                  <button className="card-title" onClick={() => choose(m)}>
                    {m.title}
                    <ArrowUpRight size={19} />
                  </button>
                  <div className="price-row">
                    <div>
                      <strong>
                        {m.yesAskCents}
                        <span>¢</span>
                      </strong>
                      <small>Sample YES ask</small>
                    </div>
                    <Spark values={m.history} />
                  </div>
                  <div className="outcome-buttons">
                    <button
                      onClick={() => {
                        choose(m);
                        setOutcome("yes");
                      }}
                    >
                      Yes <b>{m.yesAskCents}¢</b>
                    </button>
                    <button
                      onClick={() => {
                        choose(m);
                        setOutcome("no");
                      }}
                    >
                      No <b>{m.noAskCents}¢</b>
                    </button>
                  </div>
                  <div className="card-footer">
                    <span>Illustrative contract</span>
                    <button onClick={() => choose(m)}>
                      View rules <ArrowRight size={13} />
                    </button>
                  </div>
                </article>
              ))}
            </section>
            {!filtered.length && (
              <div className="empty">
                <Search />
                <h2>No markets here yet</h2>
                <p>
                  {onlySaved
                    ? "Save a market using its bookmark button."
                    : "Try another search or category."}
                </p>
                <Button
                  variant="outline"
                  onClick={() => {
                    setQuery("");
                    setCategory("All markets");
                    setOnlySaved(false);
                  }}
                >
                  Explore all markets
                </Button>
              </div>
            )}
            <aside className="bottom-note">
              <ShieldCheck size={21} />
              <div>
                <b>Your account. Your decisions.</b>
                <p>
                  Real trading will require an approved exchange connection.
                  This preview cannot accept deposits or place trades.
                </p>
              </div>
              <span>USD</span>
            </aside>
          </>
        ) : (
          <>
            <button
              className="back"
              onClick={() => {
                setSelected(null);
                setQuote(null);
              }}
            >
              <ArrowLeft size={17} />
              Back to markets
            </button>
            <div className="detail-grid">
              <section>
                <div className="detail-kicker">
                  <span className="market-symbol">{selected.symbol}</span>
                  <span>{selected.category} / Sample market</span>
                </div>
                <h1 className="detail-title">{selected.title}</h1>
                <div className="detail-price">
                  {selected.yesAskCents}¢{" "}
                  <span>Sample YES ask · not a live quote</span>
                </div>
                <div className="chart-box">
                  <div className="chart-label">
                    <span>ILLUSTRATIVE PRICE HISTORY</span>
                    <span>100¢</span>
                  </div>
                  <Spark values={selected.history} large />
                  <div className="chart-label">
                    <span>Sample observations</span>
                    <span>0¢</span>
                  </div>
                </div>
                <Tabs defaultValue="rules">
                  <TabsList variant="line">
                    <TabsTrigger value="rules">Market rules</TabsTrigger>
                    <TabsTrigger value="details">Contract details</TabsTrigger>
                  </TabsList>
                  <TabsContent value="rules" className="rules">
                    <h2>What determines the outcome?</h2>
                    <p>{selected.rules}</p>
                    <div className="source">
                      <ShieldCheck size={18} />
                      {selected.sourceLabel}
                    </div>
                  </TabsContent>
                  <TabsContent value="details" className="rules">
                    <dl>
                      <div>
                        <dt>Provider</dt>
                        <dd>Development fixtures</dd>
                      </div>
                      <div>
                        <dt>Illustrative close (UTC)</dt>
                        <dd>
                          {selected.closesAt.replace("T", " ").replace("Z", "")}
                        </dd>
                      </div>
                      <div>
                        <dt>Winning payout per contract</dt>
                        <dd>$1.00 in a hypothetical binary contract</dd>
                      </div>
                      <div>
                        <dt>Fees</dt>
                        <dd>
                          App trading fee: 0.25% of contract cost. Exchange fees
                          not included.
                        </dd>
                      </div>
                    </dl>
                  </TabsContent>
                </Tabs>
              </section>
              <aside className="ticket">
                <p className="eyebrow">ORDER PREVIEW</p>
                <h2>Build your position</h2>
                <Tabs
                  value={outcome}
                  onValueChange={(v) => {
                    setOutcome(v as Outcome);
                    setQuote(null);
                  }}
                >
                  <TabsList className="w-full">
                    <TabsTrigger value="yes">
                      Yes {selected.yesAskCents}¢
                    </TabsTrigger>
                    <TabsTrigger value="no">
                      No {selected.noAskCents}¢
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                <label className="quantity-label" htmlFor="quantity">
                  Number of contracts
                </label>
                <Input
                  id="quantity"
                  type="number"
                  min={1}
                  max={10000}
                  step={1}
                  value={quantity}
                  onChange={(e) => {
                    setQuantity(e.target.value);
                    setQuote(null);
                  }}
                />
                <p className="input-help">1–10,000 whole contracts</p>
                <dl className="estimate">
                  <div>
                    <dt>Contract cost</dt>
                    <dd>{estimate ? usd(estimate.principalCents) : "—"}</dd>
                  </div>
                  <div>
                    <dt>Trading fee · 0.25%</dt>
                    <dd>{estimate ? usd(estimate.feeCents) : "—"}</dd>
                  </div>
                  <div>
                    <dt>Total before exchange fees</dt>
                    <dd>{estimate ? usd(estimate.totalCents) : "—"}</dd>
                  </div>
                  <div className="payout">
                    <dt>If {outcome.toUpperCase()} wins</dt>
                    <dd>{estimate ? usd(estimate.payoutCents) : "—"}</dd>
                  </div>
                  <div>
                    <dt>Profit after app fee</dt>
                    <dd>{estimate ? usd(estimate.netProfitCents) : "—"}</dd>
                  </div>
                </dl>
                <p className="loss">
                  If your outcome loses, the contract cost and app fee are lost.
                  Exchange fees are not included. App fees round to the nearest
                  cent per order. No funds are charged in this preview.
                </p>
                <Button
                  className="review"
                  disabled={!estimate || busy}
                  onClick={review}
                >
                  {busy ? "Calculating…" : "Review sample order"}
                  <ArrowRight size={17} />
                </Button>
                {error && (
                  <p role="alert" className="error">
                    {error}
                  </p>
                )}
                <p className="ticket-note">
                  <LockKeyhole size={14} />
                  Preview only. No account or funds connected.
                </p>
              </aside>
            </div>
          </>
        )}
        <footer>
          <span className="footer-brand">event/</span>
          <span>Day 06 · Independent development project</span>
          <span>No exchange affiliation</span>
        </footer>
      </main>
      <Dialog
        open={Boolean(quote)}
        onOpenChange={(open) => {
          if (!open) setQuote(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review sample order</DialogTitle>
            <DialogDescription>
              Calculation only. This is not an executable quote.
            </DialogDescription>
          </DialogHeader>
          {quote && (
            <>
              <h2 className="modal-market">
                {markets.find((m) => m.id === quote.marketId)?.title}
              </h2>
              <dl className="estimate">
                <div>
                  <dt>Outcome / contracts</dt>
                  <dd>
                    {quote.outcome.toUpperCase()} / {quote.quantity}
                  </dd>
                </div>
                <div>
                  <dt>Sample price</dt>
                  <dd>{quote.priceCents}¢</dd>
                </div>
                <div>
                  <dt>Contract cost</dt>
                  <dd>{usd(quote.principalCents)}</dd>
                </div>
                <div>
                  <dt>Trading fee · 0.25%</dt>
                  <dd>{usd(quote.feeCents)}</dd>
                </div>
                <div>
                  <dt>Total before exchange fees</dt>
                  <dd>{usd(quote.totalCents)}</dd>
                </div>
                <div>
                  <dt>Winning payout</dt>
                  <dd>{usd(quote.payoutCents)}</dd>
                </div>
              </dl>
              <p className="notice">
                No order has been placed. Exchange approval, a connected account
                and verified fees are required for real trading.
              </p>
              <Button disabled>
                <LockKeyhole />
                Live trading unavailable
              </Button>
              <Button variant="outline" onClick={() => setQuote(null)}>
                Back to editing
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

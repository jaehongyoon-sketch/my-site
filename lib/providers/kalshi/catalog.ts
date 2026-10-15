import { z } from "zod";

const ticker = z.string().regex(/^[A-Za-z0-9_-]{1,160}$/);
const price = z
  .string()
  .regex(/^(0(\.\d+)?|1(\.0+)?)$/)
  .nullish();
const eventSchema = z.object({
  event_ticker: ticker,
  series_ticker: ticker,
  title: z.string().min(1).max(1000),
  category: z.string(),
  markets: z
    .array(
      z.object({
        status: z.string(),
        close_time: z.string().datetime({ offset: true }),
        yes_ask_dollars: price,
        no_ask_dollars: price,
      }),
    )
    .max(1000),
});
export type CatalogEvent = {
  id: string;
  title: string;
  category: string;
  closesAt: string;
  source: "kalshi";
  externalUrl: string;
  marketCount: number;
  yesAsk: string | null;
  noAsk: string | null;
};
const categoryMap: Record<string, string> = {
  Economics: "Economy",
  Financials: "Economy",
  Crypto: "Economy",
  Elections: "Politics",
  Politics: "Politics",
  Sports: "Sports",
  "Science and Technology": "Technology",
  Technology: "Technology",
  Science: "Science",
  Health: "Science",
  "Climate and Weather": "Science",
};
export function normalizeCatalog(
  payload: unknown,
  now = Date.now(),
): CatalogEvent[] {
  const response = z
    .object({ events: z.array(z.unknown()).max(200) })
    .parse(payload);
  const seen = new Set<string>();
  return response.events.flatMap((raw) => {
    const parsed = eventSchema.safeParse(raw);
    if (!parsed.success) return [];
    const e = parsed.data;
    if (seen.has(e.event_ticker)) return [];
    const open = e.markets.filter(
      (m) =>
        ["active", "open"].includes(m.status) && Date.parse(m.close_time) > now,
    );
    if (!open.length) return [];
    seen.add(e.event_ticker);
    return [
      {
        id: `kalshi:${e.event_ticker}`,
        title: e.title,
        category: categoryMap[e.category] ?? "Other",
        closesAt: new Date(
          Math.min(...open.map((m) => Date.parse(m.close_time))),
        ).toISOString(),
        source: "kalshi" as const,
        // Documented series page, avoiding invented event slugs.
        externalUrl: `https://kalshi.com/markets/${e.series_ticker.toLowerCase()}`,
        marketCount: open.length,
        yesAsk: open.length === 1 ? (open[0].yes_ask_dollars ?? null) : null,
        noAsk: open.length === 1 ? (open[0].no_ask_dollars ?? null) : null,
      },
    ];
  });
}
export function createCatalogLoader(
  fetcher: typeof fetch = fetch,
  clock = Date.now,
) {
  let cached: { events: CatalogEvent[]; fetchedAt: string } | undefined;
  let expires = 0;
  let pending:
    Promise<{ events: CatalogEvent[]; fetchedAt: string }> | undefined;
  let retryAt = 0;
  return async function load() {
    if (cached && clock() < expires) return cached;
    if (pending) return pending;
    if (clock() < retryAt) throw new Error("Kalshi temporarily unavailable");
    pending = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      try {
        const response = await fetcher(
          "https://external-api.kalshi.com/trade-api/v2/events?limit=100&status=open&with_nested_markets=true",
          {
            method: "GET",
            credentials: "omit",
            redirect: "manual",
            signal: controller.signal,
            headers: { Accept: "application/json" },
            cache: "no-store",
          },
        );
        if (!response.ok) throw new Error("Kalshi unavailable");
        const events = normalizeCatalog(await response.json(), clock());
        cached = { events, fetchedAt: new Date(clock()).toISOString() };
        expires = clock() + 60_000;
        return cached;
      } catch (e) {
        console.warn(
          "Kalshi catalog fetch failed:",
          e instanceof Error ? e.message : "unknown",
        );
        retryAt = clock() + 15_000;
        throw e;
      } finally {
        clearTimeout(timer);
      }
    })();
    try {
      return await pending;
    } finally {
      pending = undefined;
    }
  };
}
export const loadKalshiCatalog = createCatalogLoader();

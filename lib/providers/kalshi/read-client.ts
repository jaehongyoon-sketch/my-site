// Server-side read-only integration. Not registered in the running application.
import { z } from "zod";

const dollars = z.string().regex(/^(?:0(?:\.\d{1,4})?|1(?:\.0{1,4})?)$/);
const marketSchema = z.object({
  ticker: z.string().min(1),
  event_ticker: z.string().min(1),
  market_type: z.literal("binary"),
  title: z.string().min(1),
  status: z.string().min(1),
  close_time: z.string().datetime({ offset: true }),
  yes_ask_dollars: dollars.nullish(),
  no_ask_dollars: dollars.nullish(),
  rules_primary: z.string(),
  rules_secondary: z.string().optional(),
});
export type KalshiMarket = {
  providerId: "kalshi";
  ticker: string;
  eventTicker: string;
  title: string;
  status: string;
  closesAt: string;
  yesAskDollars: string | null;
  noAskDollars: string | null;
  rules: string;
};
export class KalshiReadError extends Error {
  readonly code:
    "INVALID_RESPONSE" | "HTTP_ERROR" | "TIMEOUT" | "NETWORK_ERROR";
  readonly status?: number;
  readonly retryAfter?: string | null;
  constructor(
    code: KalshiReadError["code"],
    status?: number,
    retryAfter?: string | null,
  ) {
    super(`Kalshi market data: ${code}`);
    this.name = "KalshiReadError";
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
function normalize(value: unknown): KalshiMarket {
  const result = marketSchema.safeParse(value);
  if (!result.success) throw new KalshiReadError("INVALID_RESPONSE");
  const m = result.data;
  return {
    providerId: "kalshi",
    ticker: m.ticker,
    eventTicker: m.event_ticker,
    title: m.title,
    status: m.status,
    closesAt: m.close_time,
    // Preserve sub-cent precision; zero is a value, absence is null.
    yesAskDollars: m.yes_ask_dollars ?? null,
    noAskDollars: m.no_ask_dollars ?? null,
    rules: [m.rules_primary, m.rules_secondary].filter(Boolean).join("\n\n"),
  };
}
const optionsSchema = z
  .object({
    limit: z.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).max(2048).optional(),
  })
  .strict();
const tickerSchema = z.string().regex(/^[A-Za-z0-9_-]{1,160}$/);
const base = "https://external-api.kalshi.com/trade-api/v2";

/** Technical connector only. Commercial display rights must be confirmed before wiring it into routes. */
export function createKalshiReadClient(
  options: {
    fetcher?: typeof fetch;
    timeoutMs?: number;
  } = {},
) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 5000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    throw new RangeError("timeoutMs must be 1–30000");
  }
  async function read(path: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(`${base}${path}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
        redirect: "manual",
        cache: "no-store",
        credentials: "omit",
      });
      if (!response.ok)
        throw new KalshiReadError(
          "HTTP_ERROR",
          response.status,
          response.headers.get("retry-after"),
        );
      try {
        return await response.json();
      } catch {
        throw new KalshiReadError(
          controller.signal.aborted ? "TIMEOUT" : "INVALID_RESPONSE",
        );
      }
    } catch (error) {
      if (error instanceof KalshiReadError) throw error;
      throw new KalshiReadError(
        controller.signal.aborted ? "TIMEOUT" : "NETWORK_ERROR",
      );
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    async listMarkets(input: { limit?: number; cursor?: string } = {}) {
      const query = optionsSchema.parse(input);
      const params = new URLSearchParams({
        status: "open",
        limit: String(query.limit),
      });
      if (query.cursor) params.set("cursor", query.cursor);
      const result = z
        .object({
          markets: z.array(z.unknown()).max(100),
          cursor: z.string().max(2048).nullish(),
        })
        .safeParse(await read(`/markets?${params}`));
      if (!result.success) throw new KalshiReadError("INVALID_RESPONSE");
      return {
        markets: result.data.markets.map(normalize),
        nextCursor: result.data.cursor || null,
      };
    },
    async getMarket(ticker: string) {
      const safeTicker = tickerSchema.parse(ticker);
      const result = z
        .object({ market: z.unknown() })
        .safeParse(await read(`/markets/${encodeURIComponent(safeTicker)}`));
      if (!result.success) throw new KalshiReadError("INVALID_RESPONSE");
      return normalize(result.data.market);
    },
  };
}

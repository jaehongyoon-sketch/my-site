import type { Market, Quote, QuoteRequest } from "../domain/types";
// Server-side integration boundary. No provider secrets belong in client bundles.
// New providers require explicit adapters, approval, auth, fees and contract tests.
export interface MarketDataProvider {
  readonly id: string;
  readonly environment: "development" | "sandbox" | "live";
  listMarkets(): Promise<Market[]>;
  getIndicativeQuote(request: QuoteRequest): Promise<Quote>;
}
// Live execution is deliberately not an optional method on a demo provider.
// Account delegation, idempotency semantics and reconciliation must be implemented
// before introducing an ExecutionProvider in a later milestone.

export type Outcome = "yes" | "no";
export type Market = {
  id: string;
  providerId: string;
  externalId: string;
  title: string;
  category: "Economy" | "Climate" | "Technology";
  symbol: string;
  yesAskCents: number;
  noAskCents: number;
  history: number[];
  closesAt: string;
  rules: string;
  sourceLabel: string;
  fixture: boolean;
};
export type QuoteRequest = {
  marketId: string;
  outcome: Outcome;
  quantity: number;
};
export type OrderEstimate = {
  priceCents: number;
  quantity: number;
  principalCents: number;
  payoutCents: number;
  grossProfitCents: number;
  feeCents: number;
  feeRateBps: 25;
  totalCents: number;
  netProfitCents: number;
};
export type Quote = OrderEstimate &
  QuoteRequest & {
    id: string;
    providerId: string;
    exchangeFeeCents: null;
    executable: false;
    expiresAt: string;
  };
// Kept as a re-export for callers of the Day 1 module.
export type { OrderStatus } from "./lifecycle";

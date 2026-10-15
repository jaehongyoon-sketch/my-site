import { markets } from "./fixtures";
import { estimateOrder } from "../domain/order";
import type { MarketDataProvider } from "./contract";
export const demoProvider: MarketDataProvider = {
  id: "demo",
  environment: "development",
  async listMarkets() {
    return structuredClone(markets);
  },
  async getIndicativeQuote(request) {
    const market = markets.find((m) => m.id === request.marketId);
    if (!market) throw new Error("Unknown market.");
    if (request.outcome !== "yes" && request.outcome !== "no")
      throw new Error("Select YES or NO.");
    return {
      ...request,
      ...estimateOrder(
        request.outcome === "yes" ? market.yesAskCents : market.noAskCents,
        request.quantity,
      ),
      id: crypto.randomUUID(),
      providerId: "demo",
      exchangeFeeCents: null,
      executable: false,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    };
  },
};

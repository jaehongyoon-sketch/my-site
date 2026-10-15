import { demoProvider } from "./demo";
import { providerAccess } from "./control";
// Selection is server-owned. Approval records alone never activate external adapters.
export function getMarketDataProvider() {
  const access = providerAccess(
    demoProvider.id,
    demoProvider.environment,
    "approved",
    "marketData",
  );
  if (!access.allowed) throw new Error("Market source unavailable.");
  return demoProvider;
}

export function estimateOrder(priceCents: number, quantity: number) {
  if (!Number.isInteger(priceCents) || priceCents < 1 || priceCents > 99)
    throw new Error("Price must be 1–99 cents.");
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000)
    throw new Error("Enter 1–10,000 whole contracts.");
  const principalCents = priceCents * quantity;
  // Each contract costs priceCents / 400 cents in fees. Keep sub-cent precision.
  const feeCents = principalCents / 400;
  return {
    priceCents,
    quantity,
    principalCents,
    feeCents,
    feeRateBps: 25 as const,
    totalCents: principalCents + feeCents,
    netProfitCents: (100 - priceCents) * quantity - feeCents,
    payoutCents: 100 * quantity,
    grossProfitCents: (100 - priceCents) * quantity,
  };
}
export function usd(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(cents / 100);
}

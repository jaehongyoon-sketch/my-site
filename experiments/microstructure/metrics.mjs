// Prices are cents; quantities are contracts. A missing quote is null, never zero.
export function bookMetrics(bids, incomingOutcome, limitCents) {
  const best = side => {
    const prices = bids.filter(b => b.outcome === side && b.quantity > 0).map(b => b.price);
    return prices.length ? Math.max(...prices) : null;
  };
  const bestYesBid = best('yes'), bestNoBid = best('no');
  const yesAsk = bestNoBid === null ? null : 100 - bestNoBid;
  const opposite = incomingOutcome === 'yes' ? 'no' : 'yes';
  const oppositeBest = best(opposite);
  return {
    bestYesBid, bestNoBid, yesAsk,
    yesSpreadCents: bestYesBid === null || yesAsk === null ? null : yesAsk - bestYesBid,
    incomingAskCents: oppositeBest === null ? null : 100 - oppositeBest,
    executableDepth: bids.filter(b => b.outcome === opposite && b.quantity > 0 && 100-b.price <= limitCents).reduce((sum,b) => sum+b.quantity,0),
  };
}

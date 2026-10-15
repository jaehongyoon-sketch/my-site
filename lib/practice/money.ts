// One unit = 1/400 cent = $0.000025. All mutations use safe integers.
export const UNITS_PER_CENT = 400;
export const GRANT_UNITS = 40_000_000;
export function costUnits(priceCents: number, quantity: number) {
  return priceCents * quantity * UNITS_PER_CENT;
}
export function feeUnits(priceCents: number, quantity: number) {
  return priceCents * quantity;
}
export function reserveUnits(priceCents: number, quantity: number) {
  return costUnits(priceCents, quantity) + feeUnits(priceCents, quantity);
}

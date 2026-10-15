import type { TransferStatus } from "./lifecycle";
export type TransferState = {
  status: TransferStatus;
  amountCents: number;
  providerRevision: number | null;
};
export function createTransferState(amountCents: number): TransferState {
  if (!Number.isSafeInteger(amountCents) || amountCents < 1)
    throw new Error("Amount must be positive safe integer cents.");
  return { status: "requested", amountCents, providerRevision: null };
}
export function markTransferUnknown(state: TransferState): TransferState {
  return state.status === "requested" ? { ...state, status: "unknown" } : state;
}
const transitions: Record<TransferStatus, readonly TransferStatus[]> = {
  requested: ["pending", "completed", "failed", "canceled", "returned"],
  unknown: ["pending", "completed", "failed", "canceled", "returned"],
  pending: ["completed", "failed", "canceled", "returned"],
  completed: ["returned"],
  failed: [],
  canceled: [],
  returned: [],
};
/** Snapshot application changes status only; it never credits/debits a balance. */
export function applyTransferSnapshot(
  state: TransferState,
  next: { status: TransferStatus; revision: number },
): TransferState {
  if (!Number.isSafeInteger(next.revision) || next.revision < 1)
    throw new Error("Invalid provider revision.");
  if (
    !["pending", "completed", "failed", "canceled", "returned"].includes(
      next.status,
    )
  )
    throw new Error("Invalid provider transfer status.");
  if (state.providerRevision !== null && next.revision < state.providerRevision)
    return state;
  if (next.revision === state.providerRevision) {
    if (next.status === state.status) return state;
    throw new Error("Conflicting transfer snapshot: reconciliation required.");
  }
  if (
    next.status !== state.status &&
    !transitions[state.status].includes(next.status)
  )
    throw new Error("Transfer regression: reconciliation required.");
  return { ...state, status: next.status, providerRevision: next.revision };
}

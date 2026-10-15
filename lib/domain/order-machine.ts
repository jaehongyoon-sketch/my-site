import type { ExecutionStatus, OrderStatus } from "./lifecycle";
export type OrderState = {
  quantity: number;
  filledQuantity: number;
  executionStatus: ExecutionStatus;
  cancelRequested: boolean;
  providerRevision: number | null;
};
export type ProviderOrderSnapshot = {
  status: Exclude<ExecutionStatus, "submitting" | "unknown">;
  filledQuantity: number;
  revision: number;
};
export class ReconciliationRequired extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReconciliationRequired";
  }
}
const terminal = (s: ExecutionStatus) =>
  ["filled", "canceled", "rejected", "expired"].includes(s);
function whole(value: number, min: number, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error("Invalid whole-number value.");
}
export function createOrderState(quantity: number): OrderState {
  whole(quantity, 1, 10000);
  return {
    quantity,
    filledQuantity: 0,
    executionStatus: "submitting",
    cancelRequested: false,
    providerRevision: null,
  };
}
export function orderDisplayStatus(state: OrderState): OrderStatus {
  return state.cancelRequested && !terminal(state.executionStatus)
    ? "cancel_pending"
    : state.executionStatus;
}
/** A timeout is not a rejection. Reconcile by the original client order ID. */
export function markSubmissionUnknown(state: OrderState): OrderState {
  if (state.executionStatus !== "submitting") return state;
  return { ...state, executionStatus: "unknown" };
}
/** A request does not free funds or remove contracts. Only provider facts do. */
export function requestOrderCancel(state: OrderState): OrderState {
  if (terminal(state.executionStatus))
    throw new Error("Order is already terminal.");
  if (!["accepted", "partially_filled"].includes(state.executionStatus))
    throw new Error("Resolve submission before canceling.");
  return { ...state, cancelRequested: true };
}
/** Use only for an explicit provider refusal; a cancel timeout must stay pending. */
export function refuseOrderCancel(state: OrderState): OrderState {
  return { ...state, cancelRequested: false };
}
/**
 * revision must order authoritative snapshots for THIS order. Do not turn
 * webhook arrival order into revisions. Providers without ordered snapshots
 * require an authoritative lookup and a serialized normalization layer.
 * Fill/correction events must be journaled separately even if a snapshot is stale.
 */
export function applyOrderSnapshot(
  state: OrderState,
  snapshot: ProviderOrderSnapshot,
): OrderState {
  whole(snapshot.revision, 1);
  whole(snapshot.filledQuantity, 0, state.quantity);
  const allowed = [
    "accepted",
    "partially_filled",
    "filled",
    "canceled",
    "rejected",
    "expired",
  ];
  if (!allowed.includes(snapshot.status))
    throw new Error("Unknown provider status.");
  if (
    state.providerRevision !== null &&
    snapshot.revision < state.providerRevision
  )
    return state;
  if (state.providerRevision === snapshot.revision) {
    if (
      snapshot.status === state.executionStatus &&
      snapshot.filledQuantity === state.filledQuantity
    )
      return state;
    throw new ReconciliationRequired(
      "Conflicting facts at the same provider revision.",
    );
  }
  if (snapshot.filledQuantity < state.filledQuantity)
    throw new ReconciliationRequired(
      "Fill bust or correction requires a separate correction record.",
    );
  if (
    snapshot.status === "filled" &&
    snapshot.filledQuantity !== state.quantity
  )
    throw new ReconciliationRequired(
      "Filled status does not equal ordered quantity.",
    );
  if (
    snapshot.status === "partially_filled" &&
    (snapshot.filledQuantity === 0 ||
      snapshot.filledQuantity === state.quantity)
  )
    throw new ReconciliationRequired("Invalid partial fill.");
  if (
    ["accepted", "rejected"].includes(snapshot.status) &&
    snapshot.filledQuantity !== 0
  )
    throw new ReconciliationRequired("Non-fill status contains fills.");
  if (
    ["canceled", "expired"].includes(snapshot.status) &&
    snapshot.filledQuantity === state.quantity
  )
    throw new ReconciliationRequired(
      "Complete fill must be reconciled as filled.",
    );
  if (
    terminal(state.executionStatus) &&
    snapshot.status !== state.executionStatus
  )
    throw new ReconciliationRequired(
      "Terminal correction needs an explicit reconciliation workflow.",
    );
  if (
    state.executionStatus === "partially_filled" &&
    snapshot.status === "accepted"
  )
    throw new ReconciliationRequired("Order cannot regress to accepted.");
  return {
    ...state,
    filledQuantity: snapshot.filledQuantity,
    executionStatus: snapshot.status,
    providerRevision: snapshot.revision,
    cancelRequested: terminal(snapshot.status) ? false : state.cancelRequested,
  };
}

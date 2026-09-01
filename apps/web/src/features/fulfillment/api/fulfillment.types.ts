/**
 * Fulfilment-task transport types (#2411, `W3a-21`)
 *
 * The frontend view of the #2406 worklist read model (`GET /fulfillment/works`,
 * `POST /fulfillment/works/:workId/actions/:action`).
 *
 * ## Three vocabularies are deliberately typed `string`, not mirrored unions
 *
 * `supportedActions`, `status` and `requestStatus` are closed unions in
 * `@openlinker/core/fulfillment`, and every other backend vocabulary this app
 * consumes IS mirrored here with an `as const` array plus a guard script. These
 * three are not, for two independent reasons that happen to agree:
 *
 *   1. DESIGN §5.2 — *"the server tells the client what is legal next, which
 *      kills client-side state-machine drift across heterogeneous executors."*
 *      A mirrored `status` union is the raw material for the drift; there is
 *      nothing this app may correctly decide from one.
 *   2. `scripts/check-no-supported-actions-mirror.mjs` FAILS THE BUILD on any
 *      `const|let|var|enum|type FulfillmentWorkAction(Values)?` declaration
 *      anywhere under `apps/web/src`. Its second matcher is not about spelling —
 *      it is the repo saying this vocabulary does not get a frontend copy.
 *
 * The cost is real and accepted: a typo in an action name is not a compile
 * error here. What buys it back is that no code branches on these values — they
 * are looked up in a loose copy table (`lib/fulfillment-task.copy.ts`) that
 * falls back to the raw string, so an unrecognised value degrades to *shown but
 * unlabelled* rather than to *silently dropped*.
 *
 * ## Timestamps are ISO STRINGS
 *
 * The DTOs declare `Date`, which is what Nest serialises FROM; what arrives is
 * a string. Every schema in this app types them `z.string()` for that reason —
 * a `Date`-typed field holding a string type-checks and then throws on
 * `.toLocaleString()`.
 *
 * @module apps/web/src/features/fulfillment/api
 */

/** One line's quantity counters. Counters, never a per-line status. */
export interface FulfillmentTaskLine {
  id: string;
  orderLineId: string;
  productVariantId: string;
  totalQuantity: number;
  /**
   * DISPLAY-ONLY, and not protected by the optimistic token: progress ingress
   * moves counters without bumping the header `version` (#2400), so this may be
   * behind reality. Nothing may gate an action on it.
   */
  fulfilledQuantity: number;
  /** Display-only; see `fulfilledQuantity`. */
  cancelledQuantity: number;
}

/**
 * An active hold on a fulfilment task.
 *
 * Carries no actor: #2406 withholds `placedByService` as an internal actor and
 * projects no `placedByUserId`, so this surface does not say who placed a hold.
 */
export interface FulfillmentTaskHold {
  id: string;
  /** A `HoldReason` — the same union `features/orders` already mirrors. */
  reason: string;
  note: string | null;
  /** ISO instant. */
  placedAt: string;
}

/** A fulfilment task as the operator surface sees it. */
export interface FulfillmentTask {
  id: string;
  orderId: string;
  locationId: string | null;
  deliveryMethod: string | null;
  assignedConnectionId: string | null;
  /**
   * The orchestration status. **Not the authority on heldness** — nothing
   * writes `on_hold`, so a held task reads `open` with a non-empty
   * `activeHolds`. Read `activeHolds` for that.
   */
  status: string;
  requestStatus: string;
  assignmentAttempt: number;
  cancellationReason: string | null;
  externalWorkId: string | null;
  acceptedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  lines: FulfillmentTaskLine[];
  /** THE authority on heldness. See `status`. */
  activeHolds: FulfillmentTaskHold[];
  /**
   * What is legal next, derived server-side and already filtered to the actions
   * this API will execute. Render controls from this array and nothing else.
   */
  supportedActions: string[];
  /** Optimistic token. Send back the one that was RENDERED, never a fresher one. */
  version: number;
}

export interface FulfillmentTaskPage {
  works: FulfillmentTask[];
  total: number;
  limit: number;
  offset: number;
}

/** Body of `POST /fulfillment/works/:workId/actions/:action`. */
export interface ApplyFulfillmentTaskActionRequest {
  expectedVersion: number;
  /** `hold` only. */
  holdReason?: string;
  /** `force_cancel` only; the server defaults it to `operator_forced`. */
  cancellationReason?: string;
  /** `release_hold` only. */
  holdId?: string;
  /** `hold` only — the note recorded ON the hold. */
  note?: string;
  /** `release_hold` only — the note recorded on the RELEASE. */
  releaseNote?: string;
}

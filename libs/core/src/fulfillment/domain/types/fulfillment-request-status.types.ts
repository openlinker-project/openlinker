/**
 * Fulfillment Request Status — the NEGOTIATION axis (#2391, ADR-054)
 *
 * What has been ASKED of a holder and what the holder has answered. The
 * execution counterpart is `FulfillmentWorkStatus`, beside this file; the two
 * are orthogonal and a `FulfillmentWork` carries both.
 *
 * **Why cancellation needs three members of its own.** Cancelling work a holder
 * has already accepted is a request that holder may refuse — Shopify's
 * `requestStatus` models the same thing. A single boolean "cancelled" cannot
 * express "we asked and they said no", so the record would have to either claim
 * the work is cancelled when it is still being packed, or lose the request
 * entirely. ADR-054 § Alternatives rejects the merged axis for exactly this.
 *
 * The seven members are DESIGN-VERBATIM — DESIGN §5.2 lists this array
 * literally.
 *
 * One member per line, no computed keys (see the sibling status file for why).
 *
 * @module libs/core/src/fulfillment/domain/types
 * @see docs/architecture/adrs/054-fulfillment-work-unit-of-assignment.md
 * @see docs/plans/analysis/DESIGN-oms-authority-model.md §5.2
 */

export const FulfillmentRequestStatusValues = [
  /** Nothing has been asked of anyone yet. The initial state. */
  'unsubmitted',
  /** Offered to a holder; no answer yet. */
  'submitted',
  /**
   * The holder took the work. ADR-054 makes acceptance a **conditional claim**
   * (`WHERE acceptedAt IS NULL`), so at most one holder can accept; the claim
   * column and its at-most-once semantics land with #2399.
   */
  'accepted',
  /**
   * The holder refused, with `{reason, blocking}`. `blocking` excludes the
   * rejecter from re-sourcing — without it, re-source plus a deterministic sort
   * is an infinite loop by construction (DESIGN §5.4).
   */
  'rejected',
  /** OL has asked an accepting holder to give the work back. */
  'cancellation_requested',
  /** The holder agreed to give it back. */
  'cancellation_accepted',
  /**
   * The holder refused to give it back — it is still theirs and still being
   * worked. This is the member a merged axis cannot express, and the reason the
   * two axes exist.
   */
  'cancellation_rejected',
] as const;

export type FulfillmentRequestStatus = (typeof FulfillmentRequestStatusValues)[number];

/** Narrow an untrusted value to a `FulfillmentRequestStatus`. */
export function isFulfillmentRequestStatus(value: unknown): value is FulfillmentRequestStatus {
  return (
    typeof value === 'string' &&
    (FulfillmentRequestStatusValues as readonly string[]).includes(value)
  );
}

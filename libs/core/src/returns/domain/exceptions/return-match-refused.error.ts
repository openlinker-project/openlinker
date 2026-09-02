/**
 * Return Match Refused Error (#2372, ADR-060)
 *
 * The refusal specific to an operator MATCHING an orphan return to an order —
 * the manual way out of the #2332 orphan bucket, beside the background
 * re-attribution reconcile.
 *
 * `ReturnNotFoundError` stays separate and is NOT a reason here: telling an
 * operator to attribute a return that does not exist is a different instruction
 * from telling them it is already attributed, and the shared class is what an
 * HTTP filter already maps (#2332's one-definition rule).
 *
 * @module domain/exceptions
 */

export const ReturnMatchRefusalReasonValues = [
  /**
   * The return already names an order.
   *
   * **Attribution is MONOTONIC and there is no unmatch.** `claimAttribution` is
   * `WHERE "internalOrderId" IS NULL`, so it can fill the value in and can never
   * change one — no reconcile, and no operator, can re-point a return at a
   * different order. This is therefore also the reason an operator hits after a
   * MIS-match, and there is no corrective action in the product: a wrong match is
   * a deliberate, unbuilt operation, which is why #2376 renders a confirmation
   * rather than a bare button.
   *
   * Also reported when a concurrent writer (the reconcile, or a peer operator)
   * won the claim between this call's read and its write — from the operator's
   * point of view that is the same fact: the return is attributed.
   */
  'already-attributed',
  /**
   * OpenLinker has never minted an internal id for that order — it holds no
   * `identifier_mappings` row on any connection. Attributing to it would point
   * every downstream trigger at a phantom, which is the same reason ingestion
   * uses `getInternalId` rather than `getOrCreateInternalId`.
   */
  'unknown-order',
] as const;

export type ReturnMatchRefusalReason = (typeof ReturnMatchRefusalReasonValues)[number];

const REASON_DETAIL: Record<ReturnMatchRefusalReason, string> = {
  'already-attributed':
    'it is already attributed to an order, and attribution cannot be changed once set',
  'unknown-order':
    'OpenLinker has not ingested that order, so attributing to it would point every ' +
    'downstream trigger at an order that does not exist here',
};

export class ReturnMatchRefusedError extends Error {
  constructor(
    public readonly returnId: string,
    public readonly reason: ReturnMatchRefusalReason
  ) {
    super(`Cannot match return ${returnId} to an order: ${REASON_DETAIL[reason]}`);
    this.name = 'ReturnMatchRefusedError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Return Refund Blocked Error
 *
 * Raised when a refund trigger is refused because the return's money states do
 * not permit a fresh attempt (#2371, ADR-056).
 *
 * **The reason is closed and always populated** — the `SalesDocumentBlockOutcome`
 * discipline (#2100 / ADR-041 §54): every non-refunding exit must be observable,
 * and an operator reading "refund blocked" needs to learn WHICH of three quite
 * different situations they are in. A boolean or a bare throw would be exactly
 * the silent decline this programme keeps closing.
 *
 * Note the claim itself cannot distinguish these — it reports only the rows it
 * claimed, so zero rows means all three at once. `ReturnRefundService` therefore
 * runs one classifying read on the refusal path (and only there) before raising.
 *
 * @module domain/exceptions
 */
export const ReturnRefundBlockReasonValues = [
  /** The return carries no lines at all — nothing to refund against. */
  'no-lines',
  /**
   * Every line already carries `triggered` or `refunded`. The buyer has been
   * paid, or a payment is on record; refunding again would pay them twice.
   */
  'already-attempted',
  /**
   * At least one line is `in_doubt` — a boundary was crossed and OL never saw
   * the outcome. This is the state that must NOT auto-retry: the money may
   * already have moved. It clears through an OBSERVATION
   * (`recordRefundObservation`), and only a terminal `denied` re-permits an
   * attempt.
   */
  'outstanding-in-doubt',
] as const;

export type ReturnRefundBlockReason = (typeof ReturnRefundBlockReasonValues)[number];

const REASON_DETAIL: Record<ReturnRefundBlockReason, string> = {
  'no-lines': 'it has no lines to refund against',
  'already-attempted': 'every line has already been refunded or had a refund triggered',
  'outstanding-in-doubt':
    'a previous refund attempt crossed the provider boundary and its outcome was never ' +
    'observed — confirm what the source actually did before attempting another',
};

export class ReturnRefundBlockedError extends Error {
  constructor(
    public readonly returnId: string,
    public readonly reason: ReturnRefundBlockReason
  ) {
    super(`Refund refused for return ${returnId}: ${REASON_DETAIL[reason]}`);
    this.name = 'ReturnRefundBlockedError';
    Error.captureStackTrace(this, this.constructor);
  }
}

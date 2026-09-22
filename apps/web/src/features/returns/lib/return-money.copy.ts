/**
 * Return money panel copy (#2382, returns spec § 5.7)
 *
 * @module apps/web/src/features/returns/lib
 */

export const RETURN_MONEY_COPY = {
  sectionTitle: 'Money',
  recordedTitle: 'Refunds recorded against this return',
  none: 'No refund has been recorded against this return yet.',
  action: 'Confirm refund',
  cancel: 'Cancel',
  success: 'Refund recorded.',
  /**
   * The #2376 partial outcome: the money state settled but the linked
   * `RefundRecord` did not write. Reported rather than shown as a plain success,
   * because the two are different facts and only one of them is complete.
   */
  recordNotWritten:
    'The refund was recorded against this return, but the linked order refund record could not be written. The money state is saved — do not confirm again.',
  /**
   * `operator_out_of_band` rendered for an operator. OpenLinker ships no refund
   * write, so the panel never implies it moved anything.
   */
  executedOutOfBand: 'You recorded this. OpenLinker did not move the money.',
  executedOther: 'Recorded by OpenLinker.',
  orphanBlocked:
    'This return is not matched to an order, so a refund cannot be recorded against it yet.',
} as const;

/**
 * The closed reason `ReturnRefundBlockedError` carries (#2371, ADR-056),
 * mirrored from `libs/core/src/returns/domain/exceptions/return-refund-blocked.error.ts`.
 * Kept as a plain string union rather than importing the core package — the
 * browser bundle cannot import `@openlinker/core` (#591).
 */
export type ReturnRefundBlockReason = 'no-lines' | 'already-attempted' | 'outstanding-in-doubt';

/**
 * Copy for a refused `POST /returns/:returnId/refund` — read by
 * `refund-error.ts`, never by the custody describer. See that file's header
 * for why the two must not share a vocabulary.
 */
export const RETURN_REFUND_ERROR_COPY = {
  generic: 'The refund could not be recorded. Nothing was saved.',
  notFound: 'This return no longer exists. Reload the page.',
  /** A genuine stale-row race (`ReturnRefundContendedError`) — reload is the real fix. */
  conflict: 'This return has changed since the page loaded. Reload and try again.',
  forbidden: 'Your account cannot record refunds.',
  byReason: {
    'no-lines': 'This return has no lines to refund against.',
    'already-attempted':
      'A refund has already been recorded or triggered for every line on this return. Refunding again would pay the buyer twice.',
    'outstanding-in-doubt':
      "A previous refund attempt crossed into the source and OpenLinker never learned what happened. Confirm what the source actually did before attempting another — do not retry blindly.",
  } as Record<ReturnRefundBlockReason, string>,
} as const;

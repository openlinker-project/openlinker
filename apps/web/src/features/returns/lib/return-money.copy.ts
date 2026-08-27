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

/**
 * Refund confirmation copy (#2382, returns spec § 5.7)
 *
 * One home, so the return money panel and the future order-level capture path
 * cannot phrase the same act two ways.
 *
 * @module apps/web/src/features/orders/lib
 */

export const REFUND_CONFIRMATION_COPY = {
  heading: 'Confirm a refund',
  /**
   * Spec § 5.7's sentence, and the reason the button says CONFIRM. OpenLinker
   * ships no refund write; recording is the whole of what it does here.
   */
  preamble:
    'OpenLinker does not move money. Confirm that you have refunded the buyer, and OpenLinker will record it against this return and this order.',
  amountLabel: 'Amount refunded',
  amountHint: 'What you actually sent back. OpenLinker does not calculate this for you.',
  amountRequired: 'Enter the amount you refunded.',
  amountInvalid: 'Enter an amount like 12.50.',
  /** Prefixes the order total shown beside the field — never inside it. */
  orderTotalLabel: 'Order total:',
  reasonLabel: 'Reason',
  noteLabel: 'Note (optional)',
  submit: 'Confirm refund',
  pending: 'Recording…',
  cancel: 'Cancel',
  /**
   * The refusal when no order currency resolved. It says what is missing rather
   * than offering a currency input: nothing downstream checks a typed one.
   */
  noCurrency:
    "OpenLinker can't tell which currency this order was paid in, so it can't record a refund against it yet. Match the return to its order first.",
} as const;

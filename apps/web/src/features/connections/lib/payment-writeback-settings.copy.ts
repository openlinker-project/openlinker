/**
 * Operator copy for the "When the buyer pays later" connection setting (#3963).
 *
 * Kept in a `*.copy.ts` so `check-ui-vocabulary` scans it.
 *
 * @module features/connections/lib
 */
export const PAYMENT_WRITEBACK_SETTINGS_COPY = {
  heading: 'When the buyer pays later',
  markPaid: 'Mark the order as paid',
  recommended: 'Recommended',
  leave: 'Leave it as it is',
  leaveHelp: 'You update payment in the shop yourself.',
  stateLabel: 'Status in the shop',
  stateDefault: "The shop's default paid status",
  stateHelp: 'Used by shops that track payment as an order status.',
  factCod: 'Cash on delivery and cancelled orders are never marked paid.',
  factFailure: "If the shop doesn't accept it, the order shows under Orders, Payment not sent to shop.",
  factFromNow: 'Applies to payments from now on.',
} as const;

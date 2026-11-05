/**
 * Operator copy for a payment that arrived after a shop got the order (#3963).
 *
 * ONE copy source for the order Payment panel and the list marker, kept in a
 * `*.copy.ts` so `check-ui-vocabulary` scans it. Labels are adjectives in
 * sentence case, three words at most; technical detail (an HTTP code, an
 * attempt count) belongs in Activity, never here.
 *
 * @module apps/web/src/features/orders/lib
 */
export type PaymentWritebackTone = 'ok' | 'busy' | 'warn' | 'muted';

export interface PaymentWritebackRowCopy {
  label: string;
  tone: PaymentWritebackTone;
  helper: string | null;
}

export const PAYMENT_WRITEBACK_COPY = {
  panelTitle: 'Payment',
  paidOn: (source: string): string => `Paid on ${source}`,
  paidOnUnknown: 'Paid',
  cashOnDelivery: 'Cash on delivery',
  paidAfterCancellation: 'Paid after cancellation',
  notPaidYet: 'Not paid yet',
  progress: (done: number, total: number): string => `${done} of ${total} shops updated`,
  /** Follows the shop name(s), which the panel renders as live labels. */
  notTrackedSuffix: "doesn't track payment.",
  retryNow: 'Retry now',
  retrying: 'Retrying…',
  /** Follows one shop's name, rendered as a live label. */
  problemTitleSuffix: 'still shows this order as unpaid',
  problemTitleMany: (count: number): string => `${count} shops still show this order as unpaid`,
  problemBody: 'Retry, or mark the order paid in the shop yourself.',
  markHandled: 'Mark as handled',
  cancelledTitle: 'The buyer paid a cancelled order',
  cancelledBody: 'The order stays cancelled and the shops were not changed. Check the refund in the marketplace.',
  /** Followed by the shop's name, rendered as a live label. */
  listMarkerPrefix: 'Payment not in',
  listMarkerGeneric: 'Payment not sent to shop',
  filterChip: 'Payment not sent to shop',
  bulkSummary: (count: number): string =>
    count === 1 ? '1 order. Its shop still shows it as unpaid.' : `${count} orders. Their shops still show them as unpaid.`,
  retryDone: (count: number): string => (count === 1 ? 'Queued 1 shop update' : `Queued ${count} shop updates`),
  handledDone: (count: number): string => (count === 1 ? 'Marked 1 order as handled' : `Marked ${count} orders as handled`),
} as const;

/** Copy for one shop row, keyed by the entry's state and reason. */
export function paymentWritebackRowCopy(state: string, reason: string | null): PaymentWritebackRowCopy {
  switch (state) {
    case 'paid-in-shop':
      return { label: 'Paid in shop', tone: 'ok', helper: null };
    case 'created-paid':
      return { label: 'Paid at creation', tone: 'ok', helper: null };
    case 'sending':
      return { label: 'Updating', tone: 'busy', helper: null };
    case 'retrying':
      return { label: 'Retrying', tone: 'busy', helper: 'The shop did not answer' };
    case 'awaiting':
      return { label: 'Waiting for payment', tone: 'muted', helper: null };
    case 'cod':
      return { label: 'Cash on delivery', tone: 'muted', helper: 'Not marked paid' };
    case 'skipped-by-setting':
      return { label: 'Left to you', tone: 'muted', helper: 'Set to leave payment as it is' };
    case 'handled':
      return { label: 'Handled', tone: 'muted', helper: 'Marked as handled' };
    case 'not-tracked':
      return { label: 'Not tracked here', tone: 'muted', helper: null };
    case 'not-sent':
      if (reason === 'cancelled') return { label: 'Not sent', tone: 'muted', helper: 'Order cancelled' };
      if (reason === 'refunded') return { label: 'Not sent', tone: 'muted', helper: 'Order refunded' };
      if (reason === 'rejected') return { label: 'Not sent', tone: 'warn', helper: 'The shop refused it' };
      return { label: 'Not sent', tone: 'warn', helper: 'Retries stopped' };
    default:
      return { label: 'Unknown state', tone: 'muted', helper: null };
  }
}

/**
 * Payment writeback row (#3963)
 *
 * Maps one shop's payment writeback state and reason to the label, tone and
 * helper the order Payment panel shows. The words come from the `orders`
 * locale namespace (ADR-081); this module only decides which of them a state
 * gets, so every language follows the same mapping.
 *
 * @module apps/web/src/features/orders/lib
 */
import type { Messages, ResolvedCopy } from '../../../shared/i18n';

export type PaymentWritebackTone = 'ok' | 'busy' | 'warn' | 'muted';

export type PaymentWritebackCopy = ResolvedCopy<Messages['orders']>['paymentWriteback'];

export interface PaymentWritebackRowCopy {
  label: string;
  tone: PaymentWritebackTone;
  helper: string | null;
}

/** Copy for one shop row, keyed by the entry's state and reason. */
export function paymentWritebackRowCopy(
  copy: PaymentWritebackCopy,
  state: string,
  reason: string | null,
): PaymentWritebackRowCopy {
  const row = copy.row;
  switch (state) {
    case 'paid-in-shop':
      return { label: row.paidInShop, tone: 'ok', helper: null };
    case 'created-paid':
      return { label: row.createdPaid, tone: 'ok', helper: null };
    case 'sending':
      return { label: row.sending, tone: 'busy', helper: null };
    case 'retrying':
      return { label: row.retrying, tone: 'busy', helper: row.retryingHelper };
    case 'awaiting':
      return { label: row.awaiting, tone: 'muted', helper: null };
    case 'cod':
      return { label: row.cod, tone: 'muted', helper: row.codHelper };
    case 'skipped-by-setting':
      return { label: row.skippedBySetting, tone: 'muted', helper: row.skippedBySettingHelper };
    case 'handled':
      return { label: row.handled, tone: 'muted', helper: row.handledHelper };
    case 'not-tracked':
      return { label: row.notTracked, tone: 'muted', helper: null };
    case 'not-sent':
      if (reason === 'cancelled') return { label: row.notSent, tone: 'muted', helper: row.notSentCancelled };
      if (reason === 'refunded') return { label: row.notSent, tone: 'muted', helper: row.notSentRefunded };
      if (reason === 'rejected') return { label: row.notSent, tone: 'warn', helper: row.notSentRejected };
      if (reason === 'no-total') return { label: row.notSent, tone: 'warn', helper: row.notSentNoTotal };
      return { label: row.notSent, tone: 'warn', helper: row.notSentStopped };
    default:
      return { label: row.unknown, tone: 'muted', helper: null };
  }
}

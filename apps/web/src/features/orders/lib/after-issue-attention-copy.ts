/**
 * After-issue attention copy (DEF-26)
 *
 * One sentence per reason the backend derives for an order whose document
 * was made before the sale changed. Shared by the order row and the order
 * panel so the two say the same thing. Worded as a suggestion: OpenLinker
 * points at the change, the operator decides whether a correction is due.
 *
 * An unrecognised value (a newer API) resolves to `null` rather than to a
 * guessed sentence.
 *
 * @module apps/web/src/features/orders/lib
 */
import type { SalesDocumentAfterIssueAttention } from '../api/orders.types';

export interface AfterIssueAttentionCopy {
  readonly short: string;
  readonly detail: string;
}

type Translate = (key: string, fallback: string) => string;

const untranslated: Translate = (_key, fallback) => fallback;

export function resolveAfterIssueAttentionCopy(
  attention: SalesDocumentAfterIssueAttention | string | null | undefined,
  t: Translate = untranslated,
): AfterIssueAttentionCopy | null {
  switch (attention) {
    case 'order-cancelled-after-issue':
      return {
        short: t('salesDocument.afterIssue.cancelledShort', 'Order cancelled'),
        detail: t(
          'salesDocument.afterIssue.cancelledDetail',
          'This order was cancelled after its document was made. Check whether it needs a correction.',
        ),
      };
    case 'order-fully-refunded-after-issue':
      return {
        short: t('salesDocument.afterIssue.fullRefundShort', 'Order refunded'),
        detail: t(
          'salesDocument.afterIssue.fullRefundDetail',
          'The whole order was refunded after its document was made. Check whether it needs a correction.',
        ),
      };
    case 'order-partially-refunded-after-issue':
      return {
        short: t('salesDocument.afterIssue.partialRefundShort', 'Part refunded'),
        detail: t(
          'salesDocument.afterIssue.partialRefundDetail',
          'Part of this order was refunded after its document was made. Check whether it needs a correction.',
        ),
      };
    default:
      return null;
  }
}

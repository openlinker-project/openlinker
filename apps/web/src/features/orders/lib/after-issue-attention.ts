/**
 * After-issue attention (DEF-26)
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
import type {
  AfterIssueAttentionCopy,
  AfterIssueAttentionCopyTree,
} from './after-issue-attention.types';

export function resolveAfterIssueAttentionCopy(
  attention: SalesDocumentAfterIssueAttention | string | null | undefined,
  copy: AfterIssueAttentionCopyTree
): AfterIssueAttentionCopy | null {
  switch (attention) {
    case 'order-cancelled-after-issue':
      return copy.cancelled;
    case 'order-fully-refunded-after-issue':
      return copy.fullRefund;
    case 'order-partially-refunded-after-issue':
      return copy.partialRefund;
    default:
      return null;
  }
}

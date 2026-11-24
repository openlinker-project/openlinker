/**
 * Bulk order actions types (#3619)
 *
 * The copy the bulk-action rules read and the per-row outcome view they
 * return, kept apart from the rules in `bulk-order-actions.ts`.
 *
 * @module apps/web/src/features/orders/lib
 */
import type { Messages, ResolvedCopy } from '../../../shared/i18n';
import type { StatusBadgeTone } from '../../../shared/ui/status-badge';

/** The `orders.bulkActions` copy, in the language the list renders in. */
export type BulkActionsCopy = ResolvedCopy<Messages['orders']>['bulkActions'];

/** How one per-row bulk outcome renders: a badge tone and its label. */
export interface BulkRowView {
  tone: StatusBadgeTone;
  label: string;
}

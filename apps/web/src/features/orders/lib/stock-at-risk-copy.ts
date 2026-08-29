/**
 * Stock-at-risk copy (#2350, story I6)
 *
 * **The single source for the shortfall sentence**, shared by the order-row
 * badge, the order-detail callout and — when it lands — `W2-19`'s attention
 * table. AC1 requires the badge title be byte-identical to the attention-table
 * title, and the only way to guarantee that is for a second copy of the string
 * to be impossible to write without deleting an import.
 *
 * `W2-20`'s general copy module does not exist on this branch, so this file IS
 * the source of truth this slice creates. When #2357 lands it should **absorb
 * this file**, not grow its own copy of the sentence.
 *
 * ## Two rules a contributor must not undo
 *
 * 1. **An empty list renders NOTHING — never a reassurance.** Both the detail
 *    loader and the list's batched read catch to empty on failure, so absence
 *    and failure are indistinguishable. "This order is fine" would therefore be
 *    a claim the data cannot support, and #2349 exists precisely so a shortfall
 *    is never silently absent. Both builders return `null` for an empty list.
 * 2. **A missing sku degrades to the variant id, never to a gap.** An operator
 *    who cannot see WHICH item is short cannot act; a blank is worse than an
 *    internal id they can paste into a search.
 *
 * @module apps/web/src/features/orders/lib
 */
import type { OrderReservationShortfall } from '../api/orders.types';
import type { StatusBadgeTone } from '../../../shared/ui/status-badge';

/** What to call the short item: its sku, else its variant id, never a blank. */
export function shortfallItemLabel(shortfall: OrderReservationShortfall): string {
  return shortfall.sku ?? shortfall.productVariantId ?? shortfall.inventoryItemId;
}

/**
 * THE title. Every surface renders this exact string.
 *
 * One episode names the item, because that is the actionable fact. Several
 * summarise, because a row cannot carry N skus without becoming unreadable —
 * the detail callout lists them all underneath.
 */
export function stockAtRiskTitle(shortfalls: readonly OrderReservationShortfall[]): string | null {
  if (shortfalls.length === 0) return null;
  if (shortfalls.length === 1) {
    const only = shortfalls[0];
    return `Short ${String(only.shortQuantity)} × ${shortfallItemLabel(only)}`;
  }
  return `Short stock on ${String(shortfalls.length)} items`;
}

/** The spec's body copy. One sentence, stated once. */
export const STOCK_AT_RISK_BODY =
  'The stock master dropped below what this order was promised. Nothing was ' +
  'silently reduced — this order is the one at risk.';

/**
 * The row badge, or `null` when there is nothing to report.
 *
 * `warning`, not `error`: the order is at risk, not broken — nothing has failed
 * and nothing was lost. Reserving `error` for actual failures is what keeps a
 * red row meaning outstanding work.
 */
export function stockAtRiskBadge(
  shortfalls: readonly OrderReservationShortfall[] | undefined
): { label: string; tone: StatusBadgeTone; title: string } | null {
  const label = stockAtRiskTitle(shortfalls ?? []);
  if (label === null) return null;
  return { label, tone: 'warning', title: `${label}. ${STOCK_AT_RISK_BODY}` };
}

/**
 * The detail callout, or `null` when there is nothing to report.
 *
 * Lists every episode, because the detail page is where an operator acts and a
 * summary would hide the item they need.
 */
export function stockAtRiskCallout(
  shortfalls: readonly OrderReservationShortfall[] | undefined
): { title: string; body: string; lines: string[] } | null {
  const list = shortfalls ?? [];
  const title = stockAtRiskTitle(list);
  if (title === null) return null;
  return {
    title,
    body: STOCK_AT_RISK_BODY,
    lines: list.map(
      (shortfall) =>
        `${shortfallItemLabel(shortfall)} — short ${String(shortfall.shortQuantity)} of ` +
        `${String(shortfall.positionShortfall)} across all orders`
    ),
  };
}

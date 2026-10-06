/**
 * Orders list page — header and bulk-bar copy (#3507)
 *
 * The page-level words that are not part of the filter surface (those live in
 * `orders-list-filters.copy.ts`).
 *
 * @module apps/web/src/features/orders/lib
 */
export const ORDERS_LIST_PAGE_COPY = {
  export: 'Export',
  refresh: 'Refresh',
  allOrders: 'All orders',
  /** M5: the bulk bar's export of the ticked rows. */
  exportSelected: (count: number): string => `Export ${count}`,
} as const;

/**
 * Analytics Matching Coverage types
 *
 * Mirrors `ProductMatchingOrderDto` / `ProductMatchingOrdersResponseDto`
 * (`GET /analytics/coverage/matching/orders`, #2474 Phase 7) — the
 * `'product-matching'` category's paginated drill-down behind the
 * `detail-mapping` modal. Read-only: this category has no remediation
 * action (see the backend controller's own header for why).
 *
 * @module features/analytics/api
 */
export const PRODUCT_MATCHING_RECORD_STATUS_VALUES = ['awaiting_mapping', 'source_deleted'] as const;
export type ProductMatchingRecordStatus = (typeof PRODUCT_MATCHING_RECORD_STATUS_VALUES)[number];

export interface ProductMatchingOrder {
  internalOrderId: string;
  sourceConnectionId: string;
  recordStatus: ProductMatchingRecordStatus;
  mappingFailureReason: string | null;
  createdAt: string;
  /**
   * Always `null` (#2799) — this category's order never resolved its item
   * reference to an internal product id in the first place, so there is no
   * honest value to report. `product-sales-table.tsx` must not
   * cross-reference this category; see `CROSS_REFERENCEABLE_CATEGORIES`'
   * doc comment.
   */
  productId: null;
  /** Always `null` (#2799) — same reasoning as `productId` above. */
  variantId: null;
}

export interface ProductMatchingOrdersPage {
  items: ProductMatchingOrder[];
  total: number;
}

export interface GetProductMatchingOrdersInput {
  /** ISO 8601, inclusive. */
  from: string;
  /** ISO 8601, exclusive. */
  to: string;
  sourceConnectionId?: string;
  limit?: number;
  offset?: number;
}

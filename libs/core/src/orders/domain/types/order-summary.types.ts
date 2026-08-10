/**
 * Order Summary Types
 *
 * Type shape produced by `buildOrderSummary` (#1995) — the neutral
 * order-identity projection used by the Shipments/Invoices list responses.
 *
 * @module libs/core/src/orders/domain/types
 * @see {@link buildOrderSummary} for the projection function
 */

/**
 * Neutral order-identity projection for a list row (#1995). `null` when no
 * order record resolves, or its snapshot has no parseable items.
 */
export interface OrderSummary {
  /** Source-native order number from the snapshot; `null` when absent. */
  orderNumber: string | null;
  /** `items[0].name`; `null` when the first item carries no name. */
  firstItemName: string | null;
  /**
   * `items[0].imageUrl`, snapshot-frozen (NOT the live catalog image).
   * `null` for effectively every order today — no current order-source
   * adapter populates `OrderItem.imageUrl` on ingestion (see `order.types.ts`).
   */
  firstItemImageUrl: string | null;
  /** `items.length` — the full item count, not the number of fields projected. */
  itemCount: number;
}

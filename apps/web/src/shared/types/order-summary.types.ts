/**
 * Order Summary Types
 *
 * Order-identity projection (#1995) mirroring the API's
 * `OrderSummaryProjectionDto`. Consumed by both the `shipments` and
 * `invoicing` features (`Shipment.orderSummary`, `InvoiceRecord.orderSummary`)
 * — neither feature is the natural owner, so this shape lives in `shared/`
 * rather than being duplicated (#2020) or borrowed cross-feature. Backs the
 * future shared `OrderIdentityCell` (#1996).
 *
 * @module shared/types
 */

export interface OrderSummary {
  /** Source-native order number from the order snapshot; null when absent. */
  orderNumber: string | null;
  /** The order's first line item's display name; null when unavailable. */
  firstItemName: string | null;
  /**
   * The order's first line item's image URL, frozen at order-snapshot time
   * (NOT the live product catalog image); null when the source never
   * populated it — the common case today, since no adapter sets
   * `OrderItem.imageUrl` on ingestion yet.
   */
  firstItemImageUrl: string | null;
  /** The order's full item count (not the number of items projected here). */
  itemCount: number;
}

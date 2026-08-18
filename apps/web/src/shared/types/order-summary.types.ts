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
   * (NOT the live product catalog image); null when the source never populated
   * it — still the common case, but not universal: the WooCommerce order source
   * DOES set `OrderItem.imageUrl` on ingestion
   * (`woocommerce-order-source.adapter.ts`). Allegro omits it deliberately,
   * PrestaShop and Erli never set it. Corrected in #2089; the core mirror in
   * `libs/core/src/orders/domain/types/order-summary.types.ts` still says
   * "no adapter".
   */
  firstItemImageUrl: string | null;
  /** The order's full item count (not the number of items projected here). */
  itemCount: number;
}

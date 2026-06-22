/**
 * Order Fulfillment Projection Service Interface
 *
 * Contract for pushing a per-order fulfillment rollup (#1108) onto the orders
 * context after a shipment-status change. The shipping context owns shipment
 * status, derives the rollup, and projects it via `IOrderRecordService`
 * (`shipping → orders`).
 *
 * @module libs/core/src/shipping/application/interfaces
 */
export interface IOrderFulfillmentProjectionService {
  /**
   * Recompute the order's fulfillment rollup from its current shipments and push
   * it onto the order record. Best-effort: a failure is logged, never thrown, so
   * it can't fail the shipment operation that triggered it.
   */
  recompute(orderId: string): Promise<void>;
}

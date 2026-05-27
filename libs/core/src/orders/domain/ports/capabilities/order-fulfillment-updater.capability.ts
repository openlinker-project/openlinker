/**
 * Order Fulfillment Updater Capability
 *
 * Optional sub-capability of `OrderProcessorManagerPort` (#837) — order
 * *destinations* (OMPs) that can update an already-created order's status +
 * tracking declare `implements OrderFulfillmentUpdater`. Complements
 * `createOrder` (the only base-port method), which mirrors the order at ingest;
 * this pushes a post-create fulfillment update (e.g. "shipped" + tracking).
 *
 * Generic by design — any OMP that supports a status/tracking write implements
 * it; PrestaShop maps the neutral `OrderStatus` to its native order state and
 * writes the tracking number.
 *
 * Axis note (#827): a *shipment* event (`Shipment.status='dispatched'`) drives
 * this *order-status* update (`'shipped'`). That is a legitimate cross-axis
 * trigger — do NOT conflate this with the shipment-status axis or a future
 * operator-workflow-status axis; they stay separate.
 *
 * Call sites resolve the destination adapter via
 * `getCapabilityAdapter<OrderProcessorManagerPort>(destConnectionId,
 * 'OrderProcessorManager')` then narrow with `isOrderFulfillmentUpdater`,
 * degrading gracefully (skip) when a destination doesn't implement it.
 *
 * @module libs/core/src/orders/domain/ports/capabilities
 * @see {@link OrderProcessorManagerPort} for the base port
 */
import type { OrderStatus } from '../../types/order.types';
import type { OrderProcessorManagerPort } from '../order-processor-manager.port';

export interface OrderFulfillmentUpdater {
  /**
   * Update an already-created destination order's status + tracking.
   *
   * `externalOrderId` is resolved upstream by the orchestration (from the
   * order's `syncStatus` for this destination). v1 carries `status: 'shipped'`;
   * the adapter maps the neutral `OrderStatus` to its native order state.
   */
  updateFulfillment(input: {
    externalOrderId: string;
    status: OrderStatus;
    trackingNumber?: string;
  }): Promise<void>;
}

export function isOrderFulfillmentUpdater(
  adapter: OrderProcessorManagerPort,
): adapter is OrderProcessorManagerPort & OrderFulfillmentUpdater {
  return typeof (adapter as Partial<OrderFulfillmentUpdater>).updateFulfillment === 'function';
}

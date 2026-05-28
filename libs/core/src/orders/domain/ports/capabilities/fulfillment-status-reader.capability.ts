/**
 * Fulfillment Status Reader Capability
 *
 * Optional sub-capability of `OrderProcessorManagerPort` (#834) — order
 * *destinations* (OMPs) that can report back their view of an order's
 * fulfillment progress declare `implements FulfillmentStatusReader`.
 * Counterpart to `OrderFulfillmentUpdater` (#858): that capability writes
 * status/tracking from OL into the OMP; this one reads the OMP's view of
 * the same axis back out.
 *
 * **Scope** — branch-1 of the fulfillment-routing model (#732, ADR-012):
 * the destination OMP ships externally and OL projects the resulting
 * `Shipment` row from the OMP's state transitions. Branches 2/3 use
 * `ShippingProviderManagerPort.getTracking` instead, keyed on the
 * provider-issued shipment id — different code path, different cursor,
 * never racing.
 *
 * Call sites resolve the destination adapter via
 * `getCapabilityAdapter<OrderProcessorManagerPort>(destConnectionId,
 * 'OrderProcessorManager')` then narrow with `isFulfillmentStatusReader`,
 * degrading gracefully (skip) when a destination doesn't implement it.
 *
 * @module libs/core/src/orders/domain/ports/capabilities
 * @see {@link OrderProcessorManagerPort} for the base port
 * @see {@link FulfillmentStatusSnapshot} for the returned shape
 */

import type { FulfillmentStatusSnapshot } from '../../types/fulfillment-status-snapshot.types';
import type { OrderProcessorManagerPort } from '../order-processor-manager.port';

export interface FulfillmentStatusReader {
  /**
   * Read the destination OMP's view of an order's fulfillment status.
   *
   * Returns a snapshot whose `status` is `null` when the OMP has not yet
   * acted on the order (pre-fulfillment: awaiting payment, processing,
   * picking, …). The sync service treats `null` as "no shipment to
   * project — skip this order this pass." When non-null, the value is
   * the OMP's report of the order's current fulfillment state, mapped
   * onto OL's `ShipmentStatus` by the sync service.
   *
   * `externalOrderId` is the source-platform-native order id (PrestaShop:
   * the numeric `id_order`).
   */
  getFulfillmentStatus(input: { externalOrderId: string }): Promise<FulfillmentStatusSnapshot>;
}

export function isFulfillmentStatusReader(
  adapter: OrderProcessorManagerPort,
): adapter is OrderProcessorManagerPort & FulfillmentStatusReader {
  return typeof (adapter as Partial<FulfillmentStatusReader>).getFulfillmentStatus === 'function';
}

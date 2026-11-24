/**
 * Order Delivery Updater Capability
 *
 * Optional sub-capability of `OrderProcessorManagerPort` - a destination that
 * can edit the delivery of an order it ALREADY holds: the shipping line and
 * the pickup-point details it was created with.
 *
 * Why it exists: the destination copy of an order is created once, and once it
 * is mapped `OrderSyncService` skips every later create. A buyer who switches
 * the parcel locker after paying changes the order at the source, and without
 * this hook the copy keeps naming the old locker for the packer.
 *
 * Called by `OrderSyncService` on the skip path only, and only when the
 * delivery point differs from what the copy was last given (compared by value,
 * so the same change delivered twice is relayed once). A destination without
 * this capability is skipped and reported, never failed.
 *
 * The implementation decides whether the copy is still editable. It answers a
 * refusal (`refused`, with a reason) rather than throwing for a copy that is
 * fulfilled, closed or cancelled: that is a fact about the copy, not a fault.
 * It must change only delivery data, never lines, prices or discounts, and
 * must not discard notes or attributes an operator added by hand.
 *
 * Probed, never trusted (ADR-046): {@link isOrderDeliveryUpdater} checks the
 * method exists. Not a `CoreCapabilityValues` member and never dispatched by
 * name: narrow the dispatched `OrderProcessorManager` adapter with the guard.
 *
 * @module libs/core/src/orders/domain/ports/capabilities
 * @see {@link OrderProcessorManagerPort} for the base port
 */
import type { OrderDeliveryUpdateResult } from '../../types/order-delivery-update.types';
import type { OrderCreate } from '../../types/order-processor.types';
import type { OrderProcessorManagerPort } from '../order-processor-manager.port';

export interface OrderDeliveryUpdater {
  /**
   * Bring the destination's copy of an existing order in line with the
   * delivery point and shipping method of `order` (the payload a create would
   * send now).
   *
   * @param input.externalOrderId - the destination-native order id from the
   *   recorded mapping
   * @param input.order - the order as the source reports it now
   */
  updateOrderDelivery(input: {
    externalOrderId: string;
    order: OrderCreate;
  }): Promise<OrderDeliveryUpdateResult>;
}

export function isOrderDeliveryUpdater(
  adapter: OrderProcessorManagerPort
): adapter is OrderProcessorManagerPort & OrderDeliveryUpdater {
  return typeof (adapter as Partial<OrderDeliveryUpdater>).updateOrderDelivery === 'function';
}

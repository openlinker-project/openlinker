/**
 * Order Contact Refresher Capability
 *
 * Optional sub-capability of `OrderProcessorManagerPort` - a destination that
 * can reconcile an order it ALREADY holds with contact details the source only
 * reveals later.
 *
 * Why it exists: some sources hand over an order before they hand over every
 * contact field (a marketplace may show the buyer's phone only once the order
 * is paid). A destination that requires the field creates the order with a
 * stand-in, and once the order is mapped `OrderSyncService` skips every later
 * create - so without this hook nothing would ever replace the stand-in, even
 * after the source re-ingests the order with the real value.
 *
 * Called by `OrderSyncService` on the skip path only (the destination mapping
 * already exists), best-effort: a throw is warn-logged and never changes the
 * sync result, because the order itself is already where it belongs. Never
 * called after a fresh create, which already carried the latest data.
 *
 * The implementation decides what to change. It must not overwrite contact
 * data an operator corrected by hand at the destination: reconcile only what
 * the destination still holds as its own stand-in.
 *
 * Probed, never trusted (ADR-046): {@link isOrderContactRefresher} checks the
 * method exists, so an adapter compiled against an older `libs/core` is simply
 * not asked. Not a `CoreCapabilityValues` member and never dispatched by name:
 * narrow the dispatched `OrderProcessorManager` adapter with the guard.
 *
 * @module libs/core/src/orders/domain/ports/capabilities
 * @see {@link OrderProcessorManagerPort} for the base port
 */
import type { OrderCreate } from '../../types/order-processor.types';
import type { OrderProcessorManagerPort } from '../order-processor-manager.port';

export interface OrderContactRefresher {
  /**
   * Reconcile the destination's copy of an existing order with the contact
   * fields of `order` (the same payload a create would have sent).
   *
   * @param input.externalOrderId - the destination-native order id from the
   *   recorded mapping
   * @param input.order - the order as the source reports it now
   */
  refreshOrderContact(input: { externalOrderId: string; order: OrderCreate }): Promise<void>;
}

export function isOrderContactRefresher(
  adapter: OrderProcessorManagerPort
): adapter is OrderProcessorManagerPort & OrderContactRefresher {
  return typeof (adapter as Partial<OrderContactRefresher>).refreshOrderContact === 'function';
}

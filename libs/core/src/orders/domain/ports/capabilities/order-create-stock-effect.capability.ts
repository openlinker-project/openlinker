/**
 * Order Create Stock Effect Capability
 *
 * Optional sub-capability of `OrderProcessorManagerPort` — a destination
 * declares that creating an order on it LOWERS that shop's own stock in the
 * same step (its order flow books the sale against stock).
 *
 * Why it is a declaration rather than an assumption: when such a destination is
 * also the product master owning the reserved position, OpenLinker consumes the
 * order's `published` holds at create time (`IMasterAbsorbedReservationService`),
 * because the master's next read already carries the sale and the hold would
 * subtract it a second time. That is only true when the shop really lowered its
 * stock. A shop configured not to (Shoper's "do not subtract stock on purchase",
 * PrestaShop with stock management off) would have its holds consumed for units
 * it never removed, and OpenLinker would over-promise until the next master
 * sync. A destination that declares nothing keeps the holds until dispatch -
 * the pre-existing behaviour, an under-sell and never an oversell.
 *
 * Probed, never trusted (ADR-046): {@link lowersStockOnOrderCreate} checks the
 * method exists, calls it, and treats anything but `true` - including a throw -
 * as "does not lower", so an adapter compiled against an older `libs/core`
 * degrades to the safe default instead of failing an order sync.
 *
 * @module libs/core/src/orders/domain/ports/capabilities
 * @see {@link OrderProcessorManagerPort} for the base port
 */
import type { OrderProcessorManagerPort } from '../order-processor-manager.port';

export interface OrderCreateStockEffect {
  /**
   * `true` when creating an order on this destination lowers the shop's own
   * stock for the ordered items. Asked after the create, so an adapter may
   * answer from a shop setting it already reads (cached) rather than a fixed
   * claim about every shop on its platform.
   */
  lowersStockOnOrderCreate(): Promise<boolean>;
}

export function isOrderCreateStockEffect(
  adapter: OrderProcessorManagerPort,
): adapter is OrderProcessorManagerPort & OrderCreateStockEffect {
  return (
    typeof (adapter as Partial<OrderCreateStockEffect>).lowersStockOnOrderCreate === 'function'
  );
}

/**
 * Whether the destination positively declares that an order create lowers its
 * stock. Anything short of a declared `true` - no method, `false`, a throw or a
 * rejection - answers `false`.
 */
export async function lowersStockOnOrderCreate(adapter: OrderProcessorManagerPort): Promise<boolean> {
  if (!isOrderCreateStockEffect(adapter)) return false;
  try {
    return (await adapter.lowersStockOnOrderCreate()) === true;
  } catch {
    return false;
  }
}

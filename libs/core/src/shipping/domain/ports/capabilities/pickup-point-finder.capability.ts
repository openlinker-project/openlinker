/**
 * Pickup Point Finder Capability
 *
 * Optional sub-capability of `ShippingProviderManagerPort` — adapters that
 * expose a paczkomat / pickup-point network declare `implements
 * PickupPointFinder`. Not every shipping provider has a locker network
 * (e.g. courier-only carriers), which is exactly the situation
 * sub-capabilities are designed for: keep `findPickupPoints` off the base
 * port so kurier-only adapters don't have to throw `NotSupported` from a
 * required method.
 *
 * `FindPickupPointsQuery` lives in `pickup-point.types.ts` (co-located
 * with `PickupPoint`) so the capability file stays
 * interface-plus-type-guard only.
 *
 * @module libs/core/src/shipping/domain/ports/capabilities
 */

import type { ShippingProviderManagerPort } from '../shipping-provider-manager.port';
import type {
  PickupPoint,
  FindPickupPointsQuery,
} from '../../types/pickup-point.types';

export interface PickupPointFinder {
  findPickupPoints(query: FindPickupPointsQuery): Promise<PickupPoint[]>;
}

export function isPickupPointFinder(
  adapter: ShippingProviderManagerPort,
): adapter is ShippingProviderManagerPort & PickupPointFinder {
  return typeof (adapter as Partial<PickupPointFinder>).findPickupPoints === 'function';
}

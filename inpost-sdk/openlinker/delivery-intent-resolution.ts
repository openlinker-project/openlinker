/**
 * Delivery-intent → carrier-method resolution (pure) — mirror copy.
 *
 * Faithful copy of `libs/core/src/shipping/domain/delivery-intent-resolution.ts`
 * (#979, ADR-020). The dispatch seam binds a carrier-neutral `DeliveryIntent`
 * to a resolved carrier's concrete `ShippingMethod` using that adapter's
 * `getSupportedMethods()`. Pure functions — no I/O.
 */

import type { DeliveryIntent, ShippingMethod } from './ol-shipping.types.ts';

const POINT_METHODS: readonly ShippingMethod[] = ['paczkomat', 'pickup'];

export function resolveCarrierMethod(
  intent: DeliveryIntent,
  supported: readonly ShippingMethod[],
): ShippingMethod | null {
  if (intent === 'pickup_point') {
    const points = supported.filter((m) => POINT_METHODS.includes(m));
    return points.length === 1 ? points[0] : null;
  }
  if (supported.includes('kurier')) return 'kurier';
  const courier = supported.filter((m) => !POINT_METHODS.includes(m) && m !== 'omp');
  return courier.length === 1 ? courier[0] : null;
}

export function deriveIntentFromLegacyMethod(method: ShippingMethod): DeliveryIntent {
  return method === 'paczkomat' || method === 'pickup' ? 'pickup_point' : 'address';
}

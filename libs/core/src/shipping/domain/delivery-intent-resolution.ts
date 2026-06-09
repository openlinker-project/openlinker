/**
 * Delivery-intent → carrier-method resolution (pure)
 *
 * The dispatch seam binds a carrier-neutral `DeliveryIntent` to a resolved
 * carrier's concrete `ShippingMethod` using that adapter's already-published
 * `getSupportedMethods()` (#979, ADR-020). Pure functions — no I/O, no
 * framework; the seam supplies the supported set and decides how to surface a
 * `null` (unsatisfiable) result.
 *
 * Assumption (guarded by returning `null`): each carrier exposes exactly one
 * *point* method today — DPD `pickup`, InPost `paczkomat`, Allegro `paczkomat`.
 * If a future carrier supports two point methods, `resolveCarrierMethod`
 * returns `null` for `pickup_point` and the seam raises an unsatisfiable-intent
 * error — the trigger to introduce an adapter-owned resolver (ADR-020 alt (a)).
 *
 * @module libs/core/src/shipping/domain
 */
import type { DeliveryIntent } from './types/delivery-intent.types';
import type { ShippingMethod } from './types/shipping-method.types';

/** The two point-delivery methods (both carry a pickup-point id). `omp` is a
 * projection-only method never advertised by an adapter. */
const POINT_METHODS: readonly ShippingMethod[] = ['paczkomat', 'pickup'];

/**
 * Resolve a delivery intent to the carrier's concrete method, or `null` when
 * the carrier's supported set can't satisfy it.
 */
export function resolveCarrierMethod(
  intent: DeliveryIntent,
  supported: readonly ShippingMethod[],
): ShippingMethod | null {
  if (intent === 'pickup_point') {
    const points = supported.filter((m) => POINT_METHODS.includes(m));
    return points.length === 1 ? points[0] : null;
  }
  // `address` → the carrier's courier method. `kurier` is universal today;
  // fall back to a lone non-point method for forward-compatibility.
  if (supported.includes('kurier')) return 'kurier';
  const courier = supported.filter((m) => !POINT_METHODS.includes(m) && m !== 'omp');
  return courier.length === 1 ? courier[0] : null;
}

/**
 * Transition-window helper (#979): derive an intent from a legacy
 * caller-supplied concrete method. Removed when the legacy `shippingMethod`
 * caller field is dropped next release. Total over `ShippingMethod`; `omp`
 * never reaches dispatch (branch-1 returns before the carrier step) and maps
 * defensively to `address`.
 */
export function deriveIntentFromLegacyMethod(method: ShippingMethod): DeliveryIntent {
  return method === 'paczkomat' || method === 'pickup' ? 'pickup_point' : 'address';
}

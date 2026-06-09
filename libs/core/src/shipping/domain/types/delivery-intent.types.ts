/**
 * Delivery Intent Types
 *
 * Carrier-neutral delivery intent — the caller-facing shipping contract
 * (#979, ADR-020). A buyer/operator expresses *where* a parcel goes, not the
 * carrier's concrete method: `pickup_point` (a buyer-selected pickup point —
 * locker or parcel-shop) vs `address` (courier delivery to the recipient's
 * address). The dispatch seam resolves the carrier-specific `ShippingMethod`
 * (`paczkomat` / `pickup` / `kurier`) from the resolved adapter's
 * `getSupportedMethods()` — the caller never names a carrier method.
 *
 * Adding a third intent (e.g. in-store collection) is a one-line, forward-
 * compatible change; the seam's resolver and each carrier's supported set
 * decide whether it can be fulfilled.
 *
 * @module libs/core/src/shipping/domain/types
 */

export const DeliveryIntentValues = ['pickup_point', 'address'] as const;
export type DeliveryIntent = (typeof DeliveryIntentValues)[number];

export const DELIVERY_INTENT = {
  PickupPoint: 'pickup_point',
  Address: 'address',
} as const satisfies Record<'PickupPoint' | 'Address', DeliveryIntent>;

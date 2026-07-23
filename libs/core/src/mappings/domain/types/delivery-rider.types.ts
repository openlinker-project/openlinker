/**
 * Delivery Rider Types
 *
 * Types for the delivery-rider hint (#1792, epic #1776): on a `default`-resolved
 * order (no fulfillment-routing rule matched → shop-fulfilled fallback), decide
 * which actionable hint the operator should see for the order's raw source
 * delivery method — *Add mapping* (a supported carrier is connected),
 * *Connect {carrier}* (OL supports the carrier but none is connected), or
 * *nothing* (OL can't handle it, the shop is correct).
 *
 * The rider is a pure read-side hint layered on top of the #1791
 * `deliveryResolution` projection. It NEVER influences routing/dispatch — a
 * wrong or missing heuristic guess degrades to `none`, never to wrong dispatch.
 *
 * @module libs/core/src/mappings/domain/types
 */

import type { FulfillmentRoutingSource } from './fulfillment-routing.types';

/**
 * The actionable hint to render for a defaulted order's delivery method:
 * - `unmapped`: the method maps to a carrier that IS connected → *Add mapping*.
 * - `not-connected`: the method maps to a carrier OL supports (an adapter is
 *   registered) but none is connected → *Connect {carrier}*.
 * - `none`: no carrier match, a non-default resolution, or a matched carrier OL
 *   doesn't support → show nothing.
 */
export const DeliveryRiderValues = ['unmapped', 'not-connected', 'none'] as const;
export type DeliveryRider = (typeof DeliveryRiderValues)[number];

/**
 * The raw source delivery method the heuristic maps to a candidate carrier.
 * Kept as loose primitives (not the `Order` entity) so `mappings` stays
 * decoupled from `orders`. Both fields are nullable — a source may expose only
 * a human label, only an opaque id, or neither.
 */
export interface RiderSourceDeliveryMethod {
  /** Human-facing method label (e.g. Allegro `"Allegro Paczkomat InPost"`). */
  name: string | null;
  /** Opaque source-side method/type identifier (`OrderShipping.methodId`). */
  typeId: string | null;
}

/**
 * Input to resolve a delivery rider. `resolutionSource` is #1791's
 * `deliveryResolution.source`; the rider only fires when it is `'default'`.
 */
export interface DeliveryRiderInput {
  sourceConnectionId: string;
  sourceDeliveryMethod: RiderSourceDeliveryMethod;
  resolutionSource: FulfillmentRoutingSource;
}

/**
 * The candidate carrier the heuristic mapped a source method to. `displayName`
 * is the canonical carrier label the FE renders on the button (e.g. `"InPost"`),
 * carried on the heuristic entry so it stays stable regardless of adapter naming.
 */
export interface CandidateCarrier {
  platformType: string;
  displayName: string;
}

/**
 * The resolved rider. `candidateCarrier` is present only for the actionable
 * riders (`unmapped` / `not-connected`) — `none` carries no carrier.
 */
export interface DeliveryRiderResolution {
  rider: DeliveryRider;
  candidateCarrier?: CandidateCarrier;
}

/**
 * One entry of the carrier heuristic table: a candidate carrier plus the
 * lowercase substrings that identify it in a source method's name/typeId.
 */
export interface CarrierHeuristicEntry {
  platformType: string;
  displayName: string;
  keywords: readonly string[];
}

/**
 * The single-source-of-truth heuristic table mapping a raw source delivery
 * method to a candidate carrier `platformType`. Seeded with the carriers OL
 * supports today; adding a carrier is a one-line entry here.
 *
 * Match semantics: a case-insensitive substring test of any keyword against the
 * method's `name` + `typeId`. `platformType` MUST match the carrier adapter's
 * manifest `platformType` (`inpost`, `dpd`) so the connection/registry lookups
 * key correctly.
 */
export const CANDIDATE_CARRIER_HEURISTICS: readonly CarrierHeuristicEntry[] = [
  { platformType: 'inpost', displayName: 'InPost', keywords: ['paczkomat', 'inpost'] },
  { platformType: 'dpd', displayName: 'DPD', keywords: ['dpd'] },
];

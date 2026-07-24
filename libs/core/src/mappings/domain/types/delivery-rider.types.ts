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
 * - `disabled`: a routing rule DID map the method to a carrier, but that
 *   carrier connection is currently disabled (status ≠ active) → *Enable
 *   {carrier}* (#1799). Unlike the other actionable riders this one fires on a
 *   `rule` resolution whose processor is unavailable, not on `default`.
 * - `none`: no carrier match, a non-default resolution with a live processor,
 *   or a matched carrier OL doesn't support → show nothing.
 */
export const DeliveryRiderValues = ['unmapped', 'not-connected', 'disabled', 'none'] as const;
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
 * `deliveryResolution.source`; the default-path riders (`unmapped` /
 * `not-connected`) only fire when it is `'default'`.
 *
 * `routedProcessorDisabled` (#1799) is `true` when a `rule` resolution matched
 * but its processor connection is not active (`processorAvailable === false`) —
 * it drives the `disabled` rider (*Enable {carrier}*) and takes precedence over
 * the default-path evaluation.
 */
export interface DeliveryRiderInput {
  sourceConnectionId: string;
  sourceDeliveryMethod: RiderSourceDeliveryMethod;
  resolutionSource: FulfillmentRoutingSource;
  routedProcessorDisabled: boolean;
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
 * riders (`unmapped` / `not-connected` / `disabled`) — `none` carries no carrier.
 */
export interface DeliveryRiderResolution {
  rider: DeliveryRider;
  candidateCarrier?: CandidateCarrier;
}

/**
 * One entry of the carrier heuristic table: a candidate carrier plus the
 * lowercase substrings that identify it in a source method's name/typeId. The
 * runtime table itself lives co-located with `matchCandidateCarrier` in
 * `delivery-rider-heuristic.ts`.
 */
export interface CarrierHeuristicEntry {
  platformType: string;
  displayName: string;
  keywords: readonly string[];
}

/**
 * Delivery Outcome Derivation
 *
 * Pure, framework-free view-model helper that maps the BE-computed delivery
 * routing (#1791 `deliveryResolution.processorKind`) plus the caller's local
 * signals (does a method exist, is a label booked) onto one of four physical
 * delivery outcomes rendered by the delivery chip (#1793, epic #1776).
 *
 * This is presentation mapping only — it consumes the routing outcome the
 * backend already resolved and never re-derives routing rules the client can't
 * see (AC: "no re-deriving routing on the client").
 *
 * @module apps/web/src/features/orders/lib
 */
import type { FulfillmentProcessorKind, OrderDeliveryResolution } from '../api/orders.types';

export const DeliveryOutcomeValues = [
  'resolved',
  'awaiting-label',
  'shop-fulfilled',
  'no-method',
] as const;
export type DeliveryOutcome = (typeof DeliveryOutcomeValues)[number];

export interface DeliveryOutcomeInput {
  /** #1791 routing kind. Absent on older payloads → treated as the shop default. */
  processorKind?: FulfillmentProcessorKind;
  /** Whether the order carries any delivery method (name / id / shipment / pickup). */
  hasMethod: boolean;
  /** Whether a label/tracking exists (booked shipment, or a dispatched/delivered rollup). */
  isFulfilled: boolean;
  /**
   * Whether the routed processor connection is currently usable (#1799). When a
   * carrier route resolves to a disabled connection this is `false` — the route
   * is not live, so the outcome must not read as `resolved`/`awaiting-label`.
   * Defaults to available (older payloads / non-rule resolutions).
   */
  processorAvailable?: boolean;
}

/**
 * Map routing + local signals to a physical outcome:
 * - carrier-driven (`ol_managed_carrier` / `source_brokered`) with a LIVE
 *   processor → `resolved` once a label exists, else `awaiting-label` (a routed
 *   order is never `no-method`);
 * - a carrier route to a DISABLED processor (#1799) is not live — it falls
 *   through to the shop-default branch so the chip pairs with the `disabled`
 *   rider rather than promising a label;
 * - otherwise (`omp_fulfilled` / unknown): `shop-fulfilled` when a method
 *   exists, else `no-method`.
 */
export function deriveDeliveryOutcome({
  processorKind,
  hasMethod,
  isFulfilled,
  processorAvailable = true,
}: DeliveryOutcomeInput): DeliveryOutcome {
  const carrierRouted =
    processorKind === 'ol_managed_carrier' || processorKind === 'source_brokered';
  if (carrierRouted && processorAvailable) {
    return isFulfilled ? 'resolved' : 'awaiting-label';
  }
  return hasMethod ? 'shop-fulfilled' : 'no-method';
}

/**
 * Whether OpenLinker has a LIVE own-carrier route for the order — i.e. routing
 * resolved to a label-generating processor kind (`ol_managed_carrier` /
 * `source_brokered`) whose connection is available (#1799 processorAvailable).
 *
 * This is the single gate for offering "Generate label": an order that is
 * shop-fulfilled (`omp_fulfilled`/default), carries no method, is unmapped /
 * not-connected, or routes to a disabled carrier has NO OL label to generate,
 * so the CTA is suppressed and the operator is pointed at the delivery routing
 * config instead (the delivery rider / "Fulfilled by the shop" note).
 */
export function hasLiveOlCarrierRoute(
  resolution: OrderDeliveryResolution | undefined | null,
): boolean {
  if (!resolution) return false;
  const carrierRouted =
    resolution.processorKind === 'ol_managed_carrier' ||
    resolution.processorKind === 'source_brokered';
  return carrierRouted && resolution.processorAvailable !== false;
}

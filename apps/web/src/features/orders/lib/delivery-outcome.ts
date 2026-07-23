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
import type { FulfillmentProcessorKind } from '../api/orders.types';

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
}

/**
 * Map routing + local signals to a physical outcome:
 * - carrier-driven (`ol_managed_carrier` / `source_brokered`) → `resolved`
 *   once a label exists, else `awaiting-label` (a routed order is never
 *   `no-method`);
 * - otherwise (`omp_fulfilled` / unknown): `shop-fulfilled` when a method
 *   exists, else `no-method`.
 */
export function deriveDeliveryOutcome({
  processorKind,
  hasMethod,
  isFulfilled,
}: DeliveryOutcomeInput): DeliveryOutcome {
  if (processorKind === 'ol_managed_carrier' || processorKind === 'source_brokered') {
    return isFulfilled ? 'resolved' : 'awaiting-label';
  }
  return hasMethod ? 'shop-fulfilled' : 'no-method';
}

/**
 * Order Fulfillment Rollup Derivation
 *
 * Pure derivation of a per-order fulfillment rollup (#1108) from the order's
 * shipment statuses. Lives in the shipping context because shipping owns
 * shipment status; the resulting `FulfillmentRollupState` (an orders-owned
 * type) is pushed onto the order via `IOrderRecordService.updateFulfillmentState`.
 * No I/O, no framework deps.
 *
 * @module libs/core/src/shipping/domain
 * @see {@link FulfillmentRollupState} for the vocabulary + precedence
 */
import type { FulfillmentRollupState } from '@openlinker/core/orders';

import type { ShipmentStatus } from './types/shipment-status.types';

/** Shipment statuses that mean "physically on its way or in progress". */
const IN_PROGRESS: ReadonlySet<ShipmentStatus> = new Set<ShipmentStatus>([
  'generated',
  'dispatched',
  'in-transit',
]);

/** Terminal non-success shipment statuses. */
const TERMINAL_FAILURE: ReadonlySet<ShipmentStatus> = new Set<ShipmentStatus>([
  'failed',
  'cancelled',
]);

/**
 * Roll an order's shipment statuses up to a single fulfillment state.
 * Empty input (no shipments) → `not-shipped`. See {@link FulfillmentRollupState}
 * for the precedence this encodes.
 *
 * **Twin:** the FE `deriveFulfillment` in `apps/web/.../lib/order-health.ts`
 * encodes the same precedence over the same shipment-status inputs (for the
 * order-detail panel). Keep both in lockstep if the precedence changes.
 */
export function deriveFulfillmentRollup(
  shipmentStatuses: readonly ShipmentStatus[],
): FulfillmentRollupState {
  if (shipmentStatuses.length === 0) {
    return 'not-shipped';
  }
  if (shipmentStatuses.includes('delivered')) {
    return 'delivered';
  }
  if (shipmentStatuses.some((status) => IN_PROGRESS.has(status))) {
    return 'dispatched';
  }
  if (shipmentStatuses.every((status) => TERMINAL_FAILURE.has(status))) {
    return 'failed';
  }
  return 'not-shipped';
}

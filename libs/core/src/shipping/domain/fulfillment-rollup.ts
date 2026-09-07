/**
 * Order Fulfillment Rollup Derivation
 *
 * Pure derivation of a per-order fulfillment rollup (#1108) from the order's
 * shipment statuses, and — since #2727 — from the line-grain quantities the
 * shipment ledger accounts for. Lives in the shipping context because shipping
 * owns shipment status; the resulting `FulfillmentRollupState` (an orders-owned
 * type) is pushed onto the order via `IOrderRecordService.updateFulfillmentState`.
 * No I/O, no framework deps.
 *
 * @module libs/core/src/shipping/domain
 * @see {@link FulfillmentRollupState} for the vocabulary + precedence
 */
import type { FulfillmentRollupState } from '@openlinker/core/orders';

import type { ShipmentStatus } from './types/shipment-status.types';
import type { FulfillmentQuantityCoverage } from './types/shipment-line.types';

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
 * ## The #2727 precedence fix — two independent halves
 *
 * The pre-#2727 rule was `any delivered ⇒ delivered`, so an order with one
 * parcel delivered and one still in transit reported **delivered**. Two
 * separate refinements replace it, and they are deliberately separable because
 * they catch different failures:
 *
 * 1. **The status half.** An in-progress shipment now OUTRANKS a delivered one.
 *    This needs no line data and fixes the shipment-grain case on every
 *    install, including one that never ran the #2727 backfill.
 * 2. **The quantity half.** With `coverage` supplied, an order whose shipments
 *    are all terminal but which only ever put SOME of its units in a parcel is
 *    demoted from `delivered`. The status half cannot see that case: every
 *    shipment really is finished.
 *
 * ## `coverage` is OPTIONAL, and absent means "not known"
 *
 * A pre-backfill install, or an order whose snapshot carried no items, has no
 * line data at all — and this function must still answer for those. Absent
 * therefore means *no line data*, never *zero delivered*: reading it as zero
 * would demote every such order and quietly empty the delivered bucket.
 *
 * ## Why an over-estimating numerator is still sound
 *
 * `coverage.delivered` over-attributes: the backfill (and the runtime writer)
 * give each shipment of a line the line's FULL quantity, because OL never
 * recorded the real per-package split. The rule survives that because it only
 * ever DEMOTES — `delivered < ordered ⇒ not delivered`, with no branch that
 * promotes anything — so an over-estimate that is still short PROVES the truth
 * is shorter. A false demotion is impossible; only a missed one. Its blind spot
 * (a partially delivered multi-package line) is exactly what the status half
 * catches, since the sibling package is still in progress.
 *
 * `dispatched` is the honest approximation for a partly-delivered order:
 * `FulfillmentRollupState` has four values and no `partial`, and between
 * lying (`delivered`) and being imprecise while keeping the order in the
 * operator's unfinished set (`dispatched`), the latter is the safe direction.
 * A fifth value would need the orders SQL filter/summary twins, the FE
 * `deriveFulfillment` and every label map, and is deliberately not smuggled in
 * here.
 *
 * **Twin:** the FE `deriveFulfillment` in `apps/web/.../lib/order-health.ts`
 * encodes the STATUS half over the same shipment-status inputs (for the
 * order-detail panel). It deliberately does NOT carry the quantity half — the
 * FE has no quantity input — so the twin is asymmetric by design. Keep the
 * status precedence in lockstep if it changes.
 */
export function deriveFulfillmentRollup(
  shipmentStatuses: readonly ShipmentStatus[],
  coverage?: FulfillmentQuantityCoverage,
): FulfillmentRollupState {
  if (shipmentStatuses.length === 0) {
    return 'not-shipped';
  }
  // NEW (#2727): an in-progress parcel outranks a delivered sibling. This
  // clause moved ABOVE the `delivered` test; that reordering IS the status-half
  // fix.
  if (shipmentStatuses.some((status) => IN_PROGRESS.has(status))) {
    return 'dispatched';
  }
  if (shipmentStatuses.includes('delivered')) {
    // NEW (#2727): demote-only. `ordered > 0` guards a coverage record that
    // accounts for nothing, which would otherwise demote on `0 < 0` being false
    // — harmless — but more importantly documents that an order requiring no
    // units cannot be under-delivered.
    if (coverage !== undefined && coverage.ordered > 0 && coverage.delivered < coverage.ordered) {
      return 'dispatched';
    }
    return 'delivered';
  }
  if (shipmentStatuses.every((status) => TERMINAL_FAILURE.has(status))) {
    return 'failed';
  }
  return 'not-shipped';
}

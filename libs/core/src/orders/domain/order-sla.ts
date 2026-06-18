/**
 * Ship-by SLA Derivation
 *
 * Pure derivation of an order's ship-by SLA bucket (#1108) from its
 * `dispatchByAt` deadline and fulfillment rollup. No I/O, no framework deps —
 * the single source of truth for the SLA bucket, consumed by the API response
 * mapper (the orders SQL filter/summary encode the same rule).
 *
 * @module libs/core/src/orders/domain
 * @see {@link SlaState} for the bucket vocabulary + precedence
 */
import type { FulfillmentRollupState } from './types/order-fulfillment.types';
import { SLA_AT_RISK_WINDOW_MS, type SlaState } from './types/order-sla.types';

/**
 * Derive the ship-by SLA bucket. `null` fulfillmentState ≡ `not-shipped`.
 *
 * An order that has already shipped (`dispatched` / `delivered`) carries no SLA
 * pressure → `none`, regardless of `dispatchByAt`. See {@link SlaState} for the
 * full precedence.
 */
export function deriveSlaState(
  dispatchByAt: Date | null,
  fulfillmentState: FulfillmentRollupState | null,
  now: Date,
): SlaState {
  if (fulfillmentState === 'dispatched' || fulfillmentState === 'delivered') {
    return 'none';
  }
  if (dispatchByAt === null) {
    return 'none';
  }
  const deadline = dispatchByAt.getTime();
  const nowMs = now.getTime();
  if (deadline <= nowMs) {
    return 'overdue';
  }
  if (deadline <= nowMs + SLA_AT_RISK_WINDOW_MS) {
    return 'at_risk';
  }
  return 'on_track';
}

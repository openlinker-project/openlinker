/**
 * Shipment Dispatch Service Interface
 *
 * The convergence seam (#835): the single entry point that routes an order's
 * fulfillment through the #832 routing model and dispatches a label-generating
 * shipment to the resolved processor connection. Built unwired — no trigger
 * calls it yet (the manual/auto trigger is #769/#771), mirroring how #832
 * shipped `resolve()` without a live call-site. Having one entry point that
 * owns `resolve()` guarantees "no parallel routing mechanism" by construction.
 *
 * @module libs/core/src/shipping/application/interfaces
 */

import type { ShipmentDispatchInput, ShipmentDispatchResult } from '../types/shipment-dispatch.types';

export interface IShipmentDispatchService {
  /**
   * Resolve the fulfillment processor for the order and, when it's a
   * label-generating kind (`ol_managed_carrier` / `source_brokered`), create a
   * `Shipment` and generate the label via the resolved connection's
   * `ShippingProviderManagerPort`.
   *
   * Returns a {@link ShipmentDispatchResult}: `{ kind: 'dispatched', shipment }`
   * for a label-generating kind, or `{ kind: 'omp_fulfilled' }` when the OMP
   * ships externally (no OL label — read-back is #834; covers both the fan-out
   * default and a configured omp_fulfilled rule).
   *
   * Idempotent (best-effort): if a non-terminal shipment already exists for the
   * order it is returned unchanged (no second label). The check is NOT
   * concurrency-safe — see the implementation note; a concurrent call site
   * (#769/#771) must serialise dispatch per order. On `generateLabel` failure
   * the shipment is persisted `failed` and the error is rethrown.
   */
  dispatch(input: ShipmentDispatchInput): Promise<ShipmentDispatchResult>;
}

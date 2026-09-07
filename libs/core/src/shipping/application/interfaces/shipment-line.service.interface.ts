/**
 * Shipment Line Service Interface (#2727)
 *
 * The line-grain read model's ONE writer, plus the derivation the fulfillment
 * rollup reads.
 *
 * @module libs/core/src/shipping/application/interfaces
 */
import type { Shipment } from '../../domain/entities/shipment.entity';
import type { FulfillmentQuantityCoverage } from '../../domain/types/shipment-line.types';

export interface IShipmentLineService {
  /**
   * Bring the order's line rows and act ledger into step with the state of the
   * shipments it is given, then return the coverage the rollup consumes.
   *
   * **Takes the shipments the caller has ALREADY loaded**, rather than
   * re-reading them. `OrderFulfillmentProjectionService.recompute` is called
   * once per shipment inside the two status-sync loops, so a
   * `reconcile(orderId)` that re-read the order's shipments would be
   * `O(S² × I)` upserts for a page touching `S` shipments of one order. Passing
   * the loaded array makes it `O(S × I)` and removes a redundant query.
   *
   * The caller is responsible for having scoped those shipments to ONE
   * direction — the projection reads `'outbound'`, because a rollup is a
   * statement about fulfilling the buyer's order and an arriving return is a
   * different cohort (#2373 / ADR-060).
   *
   * Returns `undefined` when the order has no usable line data at all — no
   * snapshot items, or every item missing an id. Absent means "no line data",
   * never "zero delivered", which is exactly the distinction
   * `deriveFulfillmentRollup`'s optional parameter exists to preserve.
   */
  reconcile(
    orderId: string,
    shipments: readonly Shipment[],
  ): Promise<FulfillmentQuantityCoverage | undefined>;
}

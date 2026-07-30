/**
 * Shipment Reference Reconciler Capability
 *
 * Optional sub-capability of `ShippingProviderManagerPort` (#1917) - adapters
 * whose carrier can be queried for a shipment by the `reference` OL stamped at
 * creation declare `implements ShipmentReferenceReconciler`. Call sites narrow
 * via `isShipmentReferenceReconciler(adapter)` before invoking
 * `findShipmentByReference`; after the guard TypeScript knows the method is
 * present.
 *
 * WHY: `generateLabel` can commit carrier-side while its response is lost
 * (timeout, socket reset, 5xx after commit). The shipment is then persisted
 * `failed` with `providerShipmentId = NULL`, and a retry re-creates at the
 * carrier - a second paid label OL can neither cancel nor track, because it
 * never learned the first id. `reference` is free text on every carrier we
 * integrate (it does NOT deduplicate server-side), but it IS queryable on some,
 * which is enough to adopt the orphan instead of duplicating it.
 *
 * Adapters that cannot answer simply do not implement this; the dispatch path
 * degrades to its pre-#1917 create-anyway behaviour.
 *
 * @module libs/core/src/shipping/domain/ports/capabilities
 */

import type { ShippingProviderManagerPort } from '../shipping-provider-manager.port';
import type { ReconciledShipment } from '../../types/reconciled-shipment.types';

export interface ShipmentReferenceReconciler {
  /**
   * Find a shipment the carrier already holds under this OL-stamped reference.
   *
   * Contract for implementers:
   * - Return `null` when nothing matches.
   * - Verify reference equality CLIENT-SIDE before returning a match. A carrier
   *   that silently ignores an unsupported filter would otherwise hand back an
   *   unfiltered page and get an unrelated shipment adopted.
   * - Return `null` (and log) when MORE THAN ONE shipment matches. Rows created
   *   before the #1917 dispatch lock can legitimately carry two carrier
   *   shipments under one reference; adopting an arbitrary one would mis-link a
   *   paid label.
   */
  findShipmentByReference(input: { reference: string }): Promise<ReconciledShipment | null>;
}

export function isShipmentReferenceReconciler(
  adapter: ShippingProviderManagerPort,
): adapter is ShippingProviderManagerPort & ShipmentReferenceReconciler {
  return (
    typeof (adapter as Partial<ShipmentReferenceReconciler>).findShipmentByReference === 'function'
  );
}

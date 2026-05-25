/**
 * Shipment Dispatch Types
 *
 * Input contract for `IShipmentDispatchService.dispatch` (#835). The dispatch
 * seam owns routing + the `Shipment` aggregate + the adapter call; the caller
 * owns the label payload — `recipient` / `parcel` are NOT derivable from a
 * persisted `Order` (parcel is never on the order; `recipient.email` is absent
 * under `OL_STORE_PII=false`; the address needs street/building-number
 * splitting), so they're supplied by the caller (operator input / #767 / #769).
 *
 * Deliberately a thin reshape of `GenerateLabelCommand` (drop the two fields
 * the seam fills itself — `shipmentId` after creating the row, `connectionId`
 * from the resolved processor) plus the routing keys. Keeping it a reshape of
 * the shipped command type minimises contract drift with the future call-site
 * (#769).
 *
 * @module libs/core/src/shipping/application/types
 */

import type { Shipment } from '../../domain/entities/shipment.entity';
import type { GenerateLabelCommand } from '../../domain/types/generate-label.types';

export type ShipmentDispatchInput = {
  /** Order source connection (the routing rule's scope). */
  sourceConnectionId: string;
  /** Source-side delivery method id; `null` resolves to the omp_fulfilled default. */
  sourceDeliveryMethodId: string | null;
} & Omit<GenerateLabelCommand, 'shipmentId' | 'connectionId'>;

/**
 * Outcome of a dispatch. A discriminated union (rather than `Shipment | null`)
 * so the caller must handle both outcomes explicitly:
 * - `dispatched` — a label-generating processor (`ol_managed_carrier` /
 *   `source_brokered`) produced, or returned an in-flight, `Shipment`.
 * - `omp_fulfilled` — the OMP ships externally; OL produced no shipment
 *   (covers the fan-out default and a configured omp_fulfilled rule; read-back
 *   is #834).
 *
 * A `generateLabel` failure is surfaced as a thrown error (the shipment is
 * persisted `failed` first), never as a result variant.
 */
export type ShipmentDispatchResult =
  | { readonly kind: 'dispatched'; readonly shipment: Shipment }
  | { readonly kind: 'omp_fulfilled' };

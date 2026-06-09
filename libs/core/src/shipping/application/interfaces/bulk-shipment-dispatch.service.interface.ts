/**
 * Bulk Shipment Dispatch Service Interface
 *
 * The bulk surface over the per-order dispatch seam (#964): dispatch N orders'
 * labels in one action, then produce one carrier handover protocol over the
 * dispatched shipments. SYNCHRONOUS by design (ADR-019) — it loops the existing
 * `IShipmentDispatchService.dispatch()`, inheriting routing / payment-gate /
 * idempotency / `Shipment`-row creation for free, rather than cloning the async
 * bulk-offer aggregate. The protocol is a distinct method so the dispatch
 * response stays JSON and the protocol streams as binary.
 *
 * @module libs/core/src/shipping/application/interfaces
 */

import type {
  BulkShipmentDispatchInput,
  BulkShipmentDispatchResult,
} from '../types/bulk-shipment-dispatch.types';
import type { LabelDocument } from '../../domain/types/label-document.types';

export interface IBulkShipmentDispatchService {
  /**
   * Dispatch each item by looping the per-order seam. Per-order failures are
   * isolated (caught into a `failed` result) so a partial failure never loses
   * the successful siblings' labels. Returns the per-order outcome list; the
   * handover protocol is produced separately via {@link generateProtocol}.
   *
   * **Precondition (ADR-019):** this is a SYNCHRONOUS loop — it issues N
   * sequential outbound calls in one execution. Callers MUST bound `items`
   * (the HTTP surface caps it at 25). The service does not re-impose the cap;
   * an unbounded caller would run an unbounded sequential loop. A future async
   * wrapper (#831) is the seam that lifts this constraint by moving execution
   * onto a worker.
   */
  dispatchBulk(input: BulkShipmentDispatchInput): Promise<BulkShipmentDispatchResult>;

  /**
   * Produce the carrier handover protocol over the given OL shipment ids. Loads
   * the shipments, keeps only those with a provider shipment id (a manifest can
   * only cover generated labels), asserts they belong to a single carrier
   * connection (the protocol is per-carrier-account), resolves that connection's
   * `ShippingProviderManagerPort`, and narrows the `DispatchProtocolReader`
   * sub-capability.
   *
   * Throws `InvalidProtocolBatchException` (empty / no-labels / mixed
   * connections), `DispatchProtocolNotSupportedException` (carrier has no
   * protocol concept), or a provider rejection.
   */
  generateProtocol(input: { shipmentIds: string[] }): Promise<LabelDocument>;
}

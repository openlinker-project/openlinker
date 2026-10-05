/**
 * Shipment Cancellation Service Interface
 *
 * Command seam for voiding a shipment (#846, absorbing the cancel residual
 * from #845). Resolves the shipment's shipping-provider adapter, narrows the
 * `ShipmentCanceller` sub-capability, voids the provider shipment, and advances
 * the `Shipment` to `cancelled`.
 *
 * @module libs/core/src/shipping/application/interfaces
 */

import type { ShipmentCancellationResult } from '../../domain/types/shipment-cancellation.types';

export interface IShipmentCancellationService {
  /**
   * Cancel a `draft`, `generated` or `dispatched` shipment. Idempotent for an
   * already-cancelled row. Throws `ShipmentNotFoundException` when absent,
   * `ShipmentNotCancellableException` for a terminal state, and
   * `ShipmentCancellationNotSupportedException` when the provider adapter lacks
   * `ShipmentCanceller`.
   *
   * Returns a RESULT rather than the row, because cancelling after dispatch
   * leaves something outstanding that the row itself cannot express - see
   * {@link ShipmentCancellationResult}. Nothing is sent to the marketplace on
   * either path.
   */
  cancel(shipmentId: string): Promise<ShipmentCancellationResult>;
}

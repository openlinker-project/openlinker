/**
 * Shipment Cancellation Service Interface
 *
 * Command seam for voiding a not-yet-dispatched shipment (#846, absorbing the
 * cancel residual from #845). Resolves the shipment's shipping-provider
 * adapter, narrows the `ShipmentCanceller` sub-capability, voids the provider
 * shipment, and advances the `Shipment` to `cancelled`.
 *
 * @module libs/core/src/shipping/application/interfaces
 */

import type { Shipment } from '../../domain/entities/shipment.entity';

export interface IShipmentCancellationService {
  /**
   * Cancel a `draft`/`generated` shipment. Idempotent for an already-cancelled
   * row (returned unchanged). Throws `ShipmentNotFoundException` when absent,
   * `ShipmentNotCancellableException` when past the cancellable window, and
   * `ShipmentCancellationNotSupportedException` when the provider adapter lacks
   * `ShipmentCanceller`.
   */
  cancel(shipmentId: string): Promise<Shipment>;
}

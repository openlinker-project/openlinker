/**
 * Shipment Cancellation Service
 *
 * Voids a not-yet-dispatched shipment (#846, absorbing the cancel residual
 * from #845). Resolves the shipment's shipping-provider adapter via the
 * integrations registry, narrows the `ShipmentCanceller` sub-capability, calls
 * `cancelShipment` on the provider (when a provider shipment exists), and
 * advances the `Shipment` to `cancelled`.
 *
 * Cancellable window: `draft` / `generated` only — once `dispatched` the
 * carrier has the parcel and provider-side cancel is no longer a clean void
 * (matches the `ShipmentCanceller` contract). Terminal states are rejected.
 *
 * @module libs/core/src/shipping/application/services
 * @implements {IShipmentCancellationService}
 */

import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';

import type { IShipmentCancellationService } from '../interfaces/shipment-cancellation.service.interface';
import type { Shipment } from '../../domain/entities/shipment.entity';
import { ShipmentCancellationNotSupportedException } from '../../domain/exceptions/shipment-cancellation-not-supported.exception';
import { ShipmentNotCancellableException } from '../../domain/exceptions/shipment-not-cancellable.exception';
import { ShipmentNotFoundException } from '../../domain/exceptions/shipment-not-found.exception';
import { isShipmentCanceller } from '../../domain/ports/capabilities/shipment-canceller.capability';
import type { ShippingProviderManagerPort } from '../../domain/ports/shipping-provider-manager.port';
import { ShipmentRepositoryPort } from '../../domain/ports/shipment-repository.port';
import { SHIPMENT_STATUS, type ShipmentStatus } from '../../domain/types/shipment-status.types';
import { SHIPMENT_REPOSITORY_TOKEN } from '../../shipping.tokens';

/** Capability the shipment's connection must declare to resolve a provider adapter. */
const SHIPPING_PROVIDER_MANAGER_CAPABILITY = 'ShippingProviderManager';

/** Statuses from which a shipment can still be voided (pre-dispatch). */
const CANCELLABLE_STATUSES: readonly ShipmentStatus[] = [
  SHIPMENT_STATUS.Draft,
  SHIPMENT_STATUS.Generated,
];

@Injectable()
export class ShipmentCancellationService implements IShipmentCancellationService {
  private readonly logger = new Logger(ShipmentCancellationService.name);

  constructor(
    @Inject(SHIPMENT_REPOSITORY_TOKEN)
    private readonly shipments: ShipmentRepositoryPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
  ) {}

  async cancel(shipmentId: string): Promise<Shipment> {
    const shipment = await this.shipments.findById(shipmentId);
    if (!shipment) {
      throw new ShipmentNotFoundException(shipmentId);
    }

    // Idempotent: re-cancelling an already-cancelled shipment is a no-op.
    if (shipment.status === SHIPMENT_STATUS.Cancelled) {
      return shipment;
    }

    if (!CANCELLABLE_STATUSES.includes(shipment.status)) {
      throw new ShipmentNotCancellableException(
        shipmentId,
        `status is '${shipment.status}' (only ${CANCELLABLE_STATUSES.join(' / ')} can be cancelled)`,
      );
    }

    const adapter = await this.integrations.getCapabilityAdapter<ShippingProviderManagerPort>(
      shipment.connectionId,
      SHIPPING_PROVIDER_MANAGER_CAPABILITY,
    );
    if (!isShipmentCanceller(adapter)) {
      throw new ShipmentCancellationNotSupportedException(shipmentId, shipment.connectionId);
    }

    // A `draft` may have no provider shipment yet (label never generated) — only
    // void provider-side when there's something to void.
    if (shipment.providerShipmentId) {
      try {
        await adapter.cancelShipment({ providerShipmentId: shipment.providerShipmentId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `cancelShipment failed for shipment ${shipmentId} (provider ${shipment.providerShipmentId}): ${message}`,
        );
        // Intentionally leave the row untouched (still `generated`) — a failed
        // void should stay cancellable/retryable, NOT flip to a terminal state.
        // (Contrast the dispatch seam, which persists `failed` on label-gen error.)
        throw error;
      }
    }

    return this.shipments.update(shipmentId, {
      status: SHIPMENT_STATUS.Cancelled,
      cancelledAt: new Date(),
    });
  }
}

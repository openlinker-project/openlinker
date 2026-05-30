/**
 * Shipment Label Service
 *
 * Fetches the printable label document for a generated shipment (#884).
 * Resolves the shipment's shipping-provider adapter via the integrations
 * registry, narrows the `LabelDocumentReader` sub-capability, and returns the
 * raw bytes + provider-reported content type for the HTTP layer to stream.
 *
 * Read-only: never mutates the `Shipment` row. Mirrors the resolve+narrow
 * shape of `ShipmentCancellationService`.
 *
 * @module libs/core/src/shipping/application/services
 * @implements {IShipmentLabelService}
 */

import { Inject, Injectable } from '@nestjs/common';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';

import type { IShipmentLabelService } from '../interfaces/shipment-label.service.interface';
import type { LabelDocument } from '../../domain/types/label-document.types';
import { LabelDocumentNotSupportedException } from '../../domain/exceptions/label-document-not-supported.exception';
import { LabelNotAvailableException } from '../../domain/exceptions/label-not-available.exception';
import { ShipmentNotFoundException } from '../../domain/exceptions/shipment-not-found.exception';
import { isLabelDocumentReader } from '../../domain/ports/capabilities/label-document-reader.capability';
import type { ShippingProviderManagerPort } from '../../domain/ports/shipping-provider-manager.port';
import { ShipmentRepositoryPort } from '../../domain/ports/shipment-repository.port';
import { SHIPMENT_REPOSITORY_TOKEN } from '../../shipping.tokens';

/** Capability the shipment's connection must declare to resolve a provider adapter. */
const SHIPPING_PROVIDER_MANAGER_CAPABILITY = 'ShippingProviderManager';

@Injectable()
export class ShipmentLabelService implements IShipmentLabelService {
  constructor(
    @Inject(SHIPMENT_REPOSITORY_TOKEN)
    private readonly shipments: ShipmentRepositoryPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
  ) {}

  async fetchLabel(shipmentId: string): Promise<LabelDocument> {
    const shipment = await this.shipments.findById(shipmentId);
    if (!shipment) {
      throw new ShipmentNotFoundException(shipmentId);
    }

    // No provider shipment ⇒ no label was ever generated. Distinct from the
    // capability gap below so the operator gets a "generate the label first"
    // message rather than "this carrier can't return labels".
    if (!shipment.providerShipmentId) {
      throw new LabelNotAvailableException(shipmentId);
    }

    const adapter = await this.integrations.getCapabilityAdapter<ShippingProviderManagerPort>(
      shipment.connectionId,
      SHIPPING_PROVIDER_MANAGER_CAPABILITY,
    );
    if (!isLabelDocumentReader(adapter)) {
      throw new LabelDocumentNotSupportedException(shipmentId, shipment.connectionId);
    }

    return adapter.fetchLabel({ providerShipmentId: shipment.providerShipmentId });
  }
}

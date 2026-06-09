/**
 * Shipment Label Service unit tests (#884).
 *
 * Mocks `ShipmentRepositoryPort` + `IIntegrationsService` (→ a fake
 * `ShippingProviderManager` adapter that may or may not implement
 * `LabelDocumentReader`). Covers: happy path (bytes passed through), not-found,
 * no-provider-shipment (label not available), provider-lacks-reader, and
 * provider error rethrow.
 */

import type { IIntegrationsService } from '@openlinker/core/integrations';

import { ShipmentLabelService } from './shipment-label.service';
import { Shipment } from '../../domain/entities/shipment.entity';
import { LabelDocumentNotSupportedException } from '../../domain/exceptions/label-document-not-supported.exception';
import { LabelNotAvailableException } from '../../domain/exceptions/label-not-available.exception';
import { ShipmentNotFoundException } from '../../domain/exceptions/shipment-not-found.exception';
import type { LabelDocumentReader } from '../../domain/ports/capabilities/label-document-reader.capability';
import type { ShipmentRepositoryPort } from '../../domain/ports/shipment-repository.port';
import type { ShippingProviderManagerPort } from '../../domain/ports/shipping-provider-manager.port';

const CONNECTION = 'conn-inpost';

function makeShipment(overrides: Partial<Shipment> = {}): Shipment {
  return new Shipment(
    overrides.id ?? 'ol_shipment_1',
    overrides.orderId ?? 'ol_order_1',
    overrides.connectionId ?? CONNECTION,
    overrides.shippingMethod ?? 'paczkomat',
    overrides.status ?? 'generated',
    // Honour an explicit `null` (the no-provider-shipment case) — `??` would
    // wrongly fall through to the default.
    overrides.providerShipmentId !== undefined ? overrides.providerShipmentId : 'shipx-1',
    overrides.paczkomatId ?? 'POZ08A',
    overrides.trackingNumber ?? null,
    overrides.labelPdfRef ?? 'shipx:label:1',
    null,
    null,
    overrides.cancelledAt ?? null,
    null,
    null,
    new Date(),
    new Date(),
    overrides.sourceDeliveryMethodId ?? null,
    overrides.carrier ?? null,
    overrides.deliveryIntent ?? null,
  );
}

describe('ShipmentLabelService', () => {
  let repository: jest.Mocked<ShipmentRepositoryPort>;
  let integrations: jest.Mocked<IIntegrationsService>;
  let readerAdapter: jest.Mocked<ShippingProviderManagerPort & LabelDocumentReader>;
  let service: ShipmentLabelService;

  beforeEach(() => {
    repository = {
      create: jest.fn(),
      findMany: jest.fn(),
      findById: jest.fn(),
      findByOrderId: jest.fn(),
      findActiveByOrderId: jest.fn(),
      findByProviderShipmentId: jest.fn(),
      findBranchOneByOrderAndConnection: jest.fn(),
      update: jest.fn(),
    };
    readerAdapter = {
      generateLabel: jest.fn(),
      getTracking: jest.fn(),
      getSupportedMethods: jest.fn(),
      fetchLabel: jest.fn().mockResolvedValue({
        contentType: 'application/pdf',
        body: new Uint8Array([1, 2, 3]),
      }),
    };
    integrations = {
      getAdapter: jest.fn(),
      getCapabilityAdapter: jest.fn().mockResolvedValue(readerAdapter),
      resolveAdapterMetadata: jest.fn(),
      listCapabilityAdapters: jest.fn(),
    };
    service = new ShipmentLabelService(repository, integrations);
  });

  it('should resolve the provider adapter and return the label bytes for a generated shipment', async () => {
    repository.findById.mockResolvedValue(
      makeShipment({ status: 'generated', providerShipmentId: 'shipx-1' }),
    );

    const result = await service.fetchLabel('ol_shipment_1');

    expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith(
      CONNECTION,
      'ShippingProviderManager',
    );
    expect(readerAdapter.fetchLabel).toHaveBeenCalledWith({ providerShipmentId: 'shipx-1' });
    expect(result).toEqual({ contentType: 'application/pdf', body: new Uint8Array([1, 2, 3]) });
  });

  it('should pass through a non-PDF content type unchanged', async () => {
    repository.findById.mockResolvedValue(makeShipment({ status: 'generated' }));
    readerAdapter.fetchLabel.mockResolvedValue({
      contentType: 'application/zpl',
      body: new Uint8Array([9]),
    });

    const result = await service.fetchLabel('ol_shipment_1');

    expect(result.contentType).toBe('application/zpl');
  });

  it('should throw ShipmentNotFoundException when the shipment does not exist', async () => {
    repository.findById.mockResolvedValue(null);

    await expect(service.fetchLabel('missing')).rejects.toBeInstanceOf(ShipmentNotFoundException);
    expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
  });

  it('should throw LabelNotAvailableException when the shipment has no provider shipment id', async () => {
    repository.findById.mockResolvedValue(
      makeShipment({ status: 'draft', providerShipmentId: null }),
    );

    await expect(service.fetchLabel('ol_shipment_1')).rejects.toBeInstanceOf(
      LabelNotAvailableException,
    );
    expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
  });

  it('should throw LabelDocumentNotSupportedException when the adapter lacks LabelDocumentReader', async () => {
    repository.findById.mockResolvedValue(makeShipment({ status: 'generated' }));
    const nonReader: ShippingProviderManagerPort = {
      generateLabel: jest.fn(),
      getTracking: jest.fn(),
      getSupportedMethods: jest.fn(),
    };
    integrations.getCapabilityAdapter.mockResolvedValue(nonReader);

    await expect(service.fetchLabel('ol_shipment_1')).rejects.toBeInstanceOf(
      LabelDocumentNotSupportedException,
    );
  });

  it('should rethrow when the provider fetchLabel rejects', async () => {
    repository.findById.mockResolvedValue(makeShipment({ status: 'generated' }));
    const boom = new Error('provider label fetch rejected');
    readerAdapter.fetchLabel.mockRejectedValue(boom);

    await expect(service.fetchLabel('ol_shipment_1')).rejects.toBe(boom);
  });
});

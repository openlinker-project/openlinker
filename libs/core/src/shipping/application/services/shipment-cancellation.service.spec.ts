/**
 * Shipment Cancellation Service unit tests (#846).
 *
 * Mocks `ShipmentRepositoryPort` + `IIntegrationsService` (→ a fake
 * `ShippingProviderManager` adapter that may or may not implement
 * `ShipmentCanceller`). Covers: generated→cancelled happy path, draft with no
 * provider shipment (no provider call), idempotent re-cancel, not-found,
 * non-cancellable state, provider-lacks-canceller, and provider error rethrow.
 */

import type { IIntegrationsService } from '@openlinker/core/integrations';

import { ShipmentCancellationService } from './shipment-cancellation.service';
import { Shipment } from '../../domain/entities/shipment.entity';
import { ShipmentCancellationNotSupportedException } from '../../domain/exceptions/shipment-cancellation-not-supported.exception';
import { ShipmentNotCancellableException } from '../../domain/exceptions/shipment-not-cancellable.exception';
import { ShipmentNotFoundException } from '../../domain/exceptions/shipment-not-found.exception';
import type { ShipmentCanceller } from '../../domain/ports/capabilities/shipment-canceller.capability';
import type { ShipmentRepositoryPort } from '../../domain/ports/shipment-repository.port';
import type { ShippingProviderManagerPort } from '../../domain/ports/shipping-provider-manager.port';
import type { ShipmentStatus } from '../../domain/types/shipment-status.types';

const CONNECTION = 'conn-inpost';

function makeShipment(overrides: Partial<Shipment> = {}): Shipment {
  return new Shipment(
    overrides.id ?? 'ol_shipment_1',
    overrides.orderId ?? 'ol_order_1',
    overrides.connectionId ?? CONNECTION,
    overrides.shippingMethod ?? 'paczkomat',
    overrides.status ?? 'generated',
    // Honour an explicit `null` (the draft-with-no-provider case) — `??` would
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
  );
}

describe('ShipmentCancellationService', () => {
  let repository: jest.Mocked<ShipmentRepositoryPort>;
  let integrations: jest.Mocked<IIntegrationsService>;
  let cancellerAdapter: jest.Mocked<ShippingProviderManagerPort & ShipmentCanceller>;
  let service: ShipmentCancellationService;

  beforeEach(() => {
    repository = {
      create: jest.fn(),
      findMany: jest.fn(),
      findById: jest.fn(),
      findByOrderId: jest.fn(),
      findActiveByOrderId: jest.fn(),
      findByProviderShipmentId: jest.fn(),
      update: jest.fn(),
    };
    cancellerAdapter = {
      generateLabel: jest.fn(),
      getTracking: jest.fn(),
      getSupportedMethods: jest.fn(),
      cancelShipment: jest.fn().mockResolvedValue(undefined),
    };
    integrations = {
      getAdapter: jest.fn(),
      getCapabilityAdapter: jest.fn().mockResolvedValue(cancellerAdapter),
      resolveAdapterMetadata: jest.fn(),
      listCapabilityAdapters: jest.fn(),
    };
    service = new ShipmentCancellationService(repository, integrations);
  });

  it('should void the provider shipment and persist cancelled for a generated shipment', async () => {
    const shipment = makeShipment({ status: 'generated', providerShipmentId: 'shipx-1' });
    repository.findById.mockResolvedValue(shipment);
    const cancelled = makeShipment({ status: 'cancelled', cancelledAt: new Date() });
    repository.update.mockResolvedValue(cancelled);

    const result = await service.cancel('ol_shipment_1');

    expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith(
      CONNECTION,
      'ShippingProviderManager',
    );
    expect(cancellerAdapter.cancelShipment).toHaveBeenCalledWith({ providerShipmentId: 'shipx-1' });
    expect(repository.update).toHaveBeenCalledWith(
      'ol_shipment_1',
      expect.objectContaining({ status: 'cancelled', cancelledAt: expect.any(Date) }),
    );
    expect(result).toBe(cancelled);
  });

  it('should skip the provider call for a draft with no provider shipment', async () => {
    repository.findById.mockResolvedValue(
      makeShipment({ status: 'draft', providerShipmentId: null }),
    );
    repository.update.mockResolvedValue(makeShipment({ status: 'cancelled' }));

    await service.cancel('ol_shipment_1');

    expect(cancellerAdapter.cancelShipment).not.toHaveBeenCalled();
    expect(repository.update).toHaveBeenCalledWith(
      'ol_shipment_1',
      expect.objectContaining({ status: 'cancelled' }),
    );
  });

  it('should return the shipment unchanged when already cancelled (idempotent)', async () => {
    const cancelled = makeShipment({ status: 'cancelled' });
    repository.findById.mockResolvedValue(cancelled);

    const result = await service.cancel('ol_shipment_1');

    expect(result).toBe(cancelled);
    expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('should throw ShipmentNotFoundException when the shipment does not exist', async () => {
    repository.findById.mockResolvedValue(null);

    await expect(service.cancel('missing')).rejects.toBeInstanceOf(ShipmentNotFoundException);
  });

  it.each<ShipmentStatus>(['dispatched', 'in-transit', 'delivered', 'failed'])(
    'should throw ShipmentNotCancellableException when status is %s',
    async (status) => {
      repository.findById.mockResolvedValue(makeShipment({ status }));

      await expect(service.cancel('ol_shipment_1')).rejects.toBeInstanceOf(
        ShipmentNotCancellableException,
      );
      expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
      expect(repository.update).not.toHaveBeenCalled();
    },
  );

  it('should throw ShipmentCancellationNotSupportedException when the adapter lacks ShipmentCanceller', async () => {
    repository.findById.mockResolvedValue(makeShipment({ status: 'generated' }));
    const nonCanceller: ShippingProviderManagerPort = {
      generateLabel: jest.fn(),
      getTracking: jest.fn(),
      getSupportedMethods: jest.fn(),
    };
    integrations.getCapabilityAdapter.mockResolvedValue(nonCanceller);

    await expect(service.cancel('ol_shipment_1')).rejects.toBeInstanceOf(
      ShipmentCancellationNotSupportedException,
    );
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('should rethrow when the provider cancelShipment rejects', async () => {
    repository.findById.mockResolvedValue(makeShipment({ status: 'generated' }));
    const boom = new Error('provider cancel rejected');
    cancellerAdapter.cancelShipment.mockRejectedValue(boom);

    await expect(service.cancel('ol_shipment_1')).rejects.toBe(boom);
    expect(repository.update).not.toHaveBeenCalled();
  });
});

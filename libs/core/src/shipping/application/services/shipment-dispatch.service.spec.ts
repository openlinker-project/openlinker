/**
 * Shipment Dispatch Service unit tests (#835).
 *
 * Mocks the three ports (ShipmentRepositoryPort + IFulfillmentRoutingService +
 * IIntegrationsService → a fake ShippingProviderManager adapter). Covers every
 * branch of the convergence seam: omp_fulfilled (default + configured),
 * ol_managed_carrier happy path, source_brokered identical path, idempotency,
 * generateLabel failure, and the exhaustiveness guard.
 */

import type { IIntegrationsService } from '@openlinker/core/integrations';
import {
  FULFILLMENT_PROCESSOR_KIND,
  type FulfillmentProcessorKind,
  type FulfillmentRoutingResolution,
  type IFulfillmentRoutingService,
} from '@openlinker/core/mappings';
import { ShipmentDispatchService } from './shipment-dispatch.service';
import type { ShipmentDispatchInput } from '../types/shipment-dispatch.types';
import { Shipment } from '../../domain/entities/shipment.entity';
import type { ShipmentRepositoryPort } from '../../domain/ports/shipment-repository.port';
import type { ShippingProviderManagerPort } from '../../domain/ports/shipping-provider-manager.port';
import { UndispatchableResolutionException } from '../../domain/exceptions/undispatchable-resolution.exception';

const SOURCE = 'conn-allegro';
const INPOST = 'conn-inpost';
const PS = 'conn-prestashop';

function makeInput(overrides: Partial<ShipmentDispatchInput> = {}): ShipmentDispatchInput {
  return {
    sourceConnectionId: SOURCE,
    sourceDeliveryMethodId: 'allegro-courier',
    orderId: 'ol_order_1',
    shippingMethod: 'kurier',
    recipient: {
      email: 'buyer@example.com',
      phone: '+48500600700',
      address: {
        street: 'Krakowska',
        buildingNumber: '12',
        city: 'Poznań',
        postCode: '60-001',
        countryCode: 'PL',
      },
    },
    parcel: { dimensions: { length: 200, width: 150, height: 100 }, weightGrams: 1200 },
    ...overrides,
  };
}

function makeShipment(overrides: Partial<Shipment> = {}): Shipment {
  return new Shipment(
    overrides.id ?? 'ol_shipment_1',
    overrides.orderId ?? 'ol_order_1',
    overrides.connectionId ?? INPOST,
    overrides.shippingMethod ?? 'kurier',
    overrides.status ?? 'draft',
    overrides.providerShipmentId ?? null,
    overrides.paczkomatId ?? null,
    overrides.trackingNumber ?? null,
    overrides.labelPdfRef ?? null,
    null,
    null,
    null,
    overrides.failedAt ?? null,
    overrides.errorMessage ?? null,
    new Date(),
    new Date(),
  );
}

function resolution(
  overrides: Partial<FulfillmentRoutingResolution> = {},
): FulfillmentRoutingResolution {
  return {
    processorKind: overrides.processorKind ?? FULFILLMENT_PROCESSOR_KIND.OlManagedCarrier,
    processorConnectionId:
      overrides.processorConnectionId === undefined ? INPOST : overrides.processorConnectionId,
    source: overrides.source ?? 'rule',
  };
}

describe('ShipmentDispatchService', () => {
  let repository: jest.Mocked<ShipmentRepositoryPort>;
  let routing: jest.Mocked<IFulfillmentRoutingService>;
  let integrations: jest.Mocked<IIntegrationsService>;
  let adapter: jest.Mocked<ShippingProviderManagerPort>;
  let service: ShipmentDispatchService;

  beforeEach(() => {
    repository = {
      create: jest.fn(),
      findById: jest.fn(),
      findByOrderId: jest.fn(),
      findActiveByOrderId: jest.fn(),
      findByProviderShipmentId: jest.fn(),
      update: jest.fn(),
    };
    routing = {
      getRules: jest.fn(),
      getCandidateProcessors: jest.fn(),
      replaceRules: jest.fn(),
      resolve: jest.fn(),
    };
    adapter = {
      generateLabel: jest.fn(),
      getTracking: jest.fn(),
      getSupportedMethods: jest.fn(),
    };
    integrations = {
      getAdapter: jest.fn(),
      getCapabilityAdapter: jest.fn().mockResolvedValue(adapter),
      resolveAdapterMetadata: jest.fn(),
      listCapabilityAdapters: jest.fn(),
    };
    service = new ShipmentDispatchService(repository, routing, integrations);
  });

  describe('omp_fulfilled (branch-1, no OL label)', () => {
    it('should return omp_fulfilled for the default (null connection)', async () => {
      routing.resolve.mockResolvedValue(
        resolution({ processorKind: FULFILLMENT_PROCESSOR_KIND.OmpFulfilled, processorConnectionId: null, source: 'default' }),
      );

      const result = await service.dispatch(makeInput());

      expect(result).toEqual({ kind: 'omp_fulfilled' });
      expect(repository.findActiveByOrderId).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
      expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
    });

    it('should return omp_fulfilled for a CONFIGURED omp_fulfilled rule (non-null connection)', async () => {
      // The Q3 catch: a configured omp_fulfilled rule pins a method to a
      // specific OMP and resolves with a non-null connection — but the OMP
      // still ships externally, so no OL label.
      routing.resolve.mockResolvedValue(
        resolution({ processorKind: FULFILLMENT_PROCESSOR_KIND.OmpFulfilled, processorConnectionId: PS, source: 'rule' }),
      );

      const result = await service.dispatch(makeInput());

      expect(result).toEqual({ kind: 'omp_fulfilled' });
      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  describe('label-generating dispatch', () => {
    it('should create a draft shipment, generate the label, and persist generated for ol_managed_carrier', async () => {
      routing.resolve.mockResolvedValue(
        resolution({ processorKind: FULFILLMENT_PROCESSOR_KIND.OlManagedCarrier, processorConnectionId: INPOST }),
      );
      repository.findActiveByOrderId.mockResolvedValue(null);
      const draft = makeShipment({ status: 'draft' });
      repository.create.mockResolvedValue(draft);
      adapter.generateLabel.mockResolvedValue({
        providerShipmentId: 'shipx-1',
        trackingNumber: null,
        labelPdfRef: 'shipx:label:shipx-1',
      });
      const generated = makeShipment({ status: 'generated', providerShipmentId: 'shipx-1' });
      repository.update.mockResolvedValue(generated);

      const input = makeInput({ shippingMethod: 'paczkomat', paczkomatId: 'POZ08A' });
      const result = await service.dispatch(input);

      expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith(INPOST, 'ShippingProviderManager');
      expect(repository.create).toHaveBeenCalledWith({
        orderId: 'ol_order_1',
        connectionId: INPOST,
        shippingMethod: 'paczkomat',
        paczkomatId: 'POZ08A',
      });
      expect(adapter.generateLabel).toHaveBeenCalledWith(
        expect.objectContaining({
          shipmentId: draft.id,
          connectionId: INPOST,
          orderId: 'ol_order_1',
          shippingMethod: 'paczkomat',
          paczkomatId: 'POZ08A',
          recipient: input.recipient,
          parcel: input.parcel,
        }),
      );
      expect(repository.update).toHaveBeenCalledWith(
        draft.id,
        expect.objectContaining({
          status: 'generated',
          providerShipmentId: 'shipx-1',
          trackingNumber: undefined,
          labelPdfRef: 'shipx:label:shipx-1',
        }),
      );
      expect(result).toEqual({ kind: 'dispatched', shipment: generated });
    });

    it('should dispatch source_brokered through the identical path (no rework for #833)', async () => {
      routing.resolve.mockResolvedValue(
        resolution({ processorKind: FULFILLMENT_PROCESSOR_KIND.SourceBrokered, processorConnectionId: SOURCE }),
      );
      repository.findActiveByOrderId.mockResolvedValue(null);
      repository.create.mockResolvedValue(makeShipment({ connectionId: SOURCE }));
      adapter.generateLabel.mockResolvedValue({
        providerShipmentId: 'allegro-1',
        trackingNumber: 'TRACK-1',
        labelPdfRef: 'allegro:label:1',
      });
      repository.update.mockResolvedValue(makeShipment({ status: 'generated' }));

      const result = await service.dispatch(makeInput());

      expect(result.kind).toBe('dispatched');
      expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith(SOURCE, 'ShippingProviderManager');
      expect(adapter.generateLabel).toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: 'generated', trackingNumber: 'TRACK-1' }),
      );
    });

    it('should be idempotent — return the existing non-terminal shipment without re-dispatching', async () => {
      routing.resolve.mockResolvedValue(resolution());
      const existing = makeShipment({ status: 'generated', providerShipmentId: 'shipx-existing' });
      repository.findActiveByOrderId.mockResolvedValue(existing);

      const result = await service.dispatch(makeInput());

      expect(result).toEqual({ kind: 'dispatched', shipment: existing });
      expect(repository.create).not.toHaveBeenCalled();
      expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
      expect(adapter.generateLabel).not.toHaveBeenCalled();
    });

    it('should persist failed and rethrow when generateLabel rejects', async () => {
      routing.resolve.mockResolvedValue(resolution());
      repository.findActiveByOrderId.mockResolvedValue(null);
      const draft = makeShipment({ status: 'draft' });
      repository.create.mockResolvedValue(draft);
      const boom = new Error('paczkomat unavailable');
      adapter.generateLabel.mockRejectedValue(boom);
      repository.update.mockResolvedValue(makeShipment({ status: 'failed' }));

      await expect(service.dispatch(makeInput())).rejects.toBe(boom);

      expect(repository.update).toHaveBeenCalledWith(
        draft.id,
        expect.objectContaining({ status: 'failed', errorMessage: 'paczkomat unavailable' }),
      );
    });
  });

  describe('exhaustiveness guard', () => {
    it('should throw for an unknown processor kind', async () => {
      routing.resolve.mockResolvedValue(
        resolution({ processorKind: 'teleporter' as FulfillmentProcessorKind, processorConnectionId: INPOST }),
      );

      await expect(service.dispatch(makeInput())).rejects.toBeInstanceOf(
        UndispatchableResolutionException,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });
  });
});

/**
 * Bulk Shipment Dispatch Service unit tests (#964).
 *
 * Mocks `IShipmentDispatchService` (the looped per-order seam),
 * `ShipmentRepositoryPort`, and `IIntegrationsService` (→ a fake
 * `ShippingProviderManager` adapter that may or may not implement
 * `DispatchProtocolReader`).
 *
 * Covers:
 *  - dispatchBulk: all-success, partial-failure survival, omp_fulfilled passthrough
 *  - generateProtocol: happy path, no-capability, mixed-connection throw,
 *    no-labels / empty throw, label-less ids dropped, provider error rethrow
 */

import type { IIntegrationsService } from '@openlinker/core/integrations';

import { BulkShipmentDispatchService } from './bulk-shipment-dispatch.service';
import type { IShipmentDispatchService } from '../interfaces/shipment-dispatch.service.interface';
import type { BulkShipmentDispatchItem } from '../types/bulk-shipment-dispatch.types';
import { Shipment } from '../../domain/entities/shipment.entity';
import { DispatchProtocolNotSupportedException } from '../../domain/exceptions/dispatch-protocol-not-supported.exception';
import { InvalidProtocolBatchException } from '../../domain/exceptions/invalid-protocol-batch.exception';
import type { DispatchProtocolReader } from '../../domain/ports/capabilities/dispatch-protocol-reader.capability';
import type { ShipmentRepositoryPort } from '../../domain/ports/shipment-repository.port';
import type { ShippingProviderManagerPort } from '../../domain/ports/shipping-provider-manager.port';

const SOURCE_CONNECTION = 'conn-source';
const DPD_CONNECTION = 'conn-dpd';

function makeShipment(overrides: Partial<Shipment> = {}): Shipment {
  return new Shipment(
    overrides.id ?? 'ol_shipment_1',
    overrides.orderId ?? 'ol_order_1',
    overrides.connectionId ?? DPD_CONNECTION,
    overrides.shippingMethod ?? 'kurier',
    overrides.status ?? 'generated',
    overrides.providerShipmentId !== undefined ? overrides.providerShipmentId : 'waybill-1',
    overrides.paczkomatId ?? null,
    overrides.trackingNumber ?? null,
    overrides.labelPdfRef ?? 'waybill-1',
    null,
    null,
    null,
    null,
    null,
    new Date(),
    new Date(),
    overrides.sourceDeliveryMethodId ?? null,
    overrides.carrier ?? null,
  );
}

function makeItem(orderId: string, overrides: Partial<BulkShipmentDispatchItem> = {}): BulkShipmentDispatchItem {
  return {
    sourceDeliveryMethodId: overrides.sourceDeliveryMethodId ?? 'dm-1',
    orderId,
    shippingMethod: overrides.shippingMethod ?? 'kurier',
    paczkomatId: overrides.paczkomatId,
    recipient: overrides.recipient ?? {
      email: 'buyer@example.com',
      phone: '600100200',
      address: {
        street: 'Main',
        buildingNumber: '1',
        city: 'Warsaw',
        postCode: '00-001',
        countryCode: 'PL',
      },
    },
    parcel: overrides.parcel ?? { weightGrams: 1000 },
  };
}

describe('BulkShipmentDispatchService', () => {
  let dispatch: jest.Mocked<IShipmentDispatchService>;
  let repository: jest.Mocked<ShipmentRepositoryPort>;
  let integrations: jest.Mocked<IIntegrationsService>;
  let protocolAdapter: jest.Mocked<ShippingProviderManagerPort & DispatchProtocolReader>;
  let service: BulkShipmentDispatchService;

  beforeEach(() => {
    dispatch = { dispatch: jest.fn() };
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
    protocolAdapter = {
      generateLabel: jest.fn(),
      getTracking: jest.fn(),
      getSupportedMethods: jest.fn(),
      generateProtocol: jest.fn().mockResolvedValue({
        contentType: 'application/pdf',
        body: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      }),
    };
    integrations = {
      getAdapter: jest.fn(),
      getCapabilityAdapter: jest.fn().mockResolvedValue(protocolAdapter),
      resolveAdapterMetadata: jest.fn(),
      listCapabilityAdapters: jest.fn(),
    };
    service = new BulkShipmentDispatchService(dispatch, repository, integrations);
  });

  describe('dispatchBulk', () => {
    it('should dispatch every item and return a dispatched result per order when all succeed', async () => {
      dispatch.dispatch
        .mockResolvedValueOnce({ kind: 'dispatched', shipment: makeShipment({ id: 'ol_shipment_1', orderId: 'ol_order_1' }) })
        .mockResolvedValueOnce({ kind: 'dispatched', shipment: makeShipment({ id: 'ol_shipment_2', orderId: 'ol_order_2' }) });

      const result = await service.dispatchBulk({
        sourceConnectionId: SOURCE_CONNECTION,
        items: [makeItem('ol_order_1'), makeItem('ol_order_2')],
      });

      expect(dispatch.dispatch).toHaveBeenCalledTimes(2);
      // The shared sourceConnectionId is re-attached to each per-order call.
      expect(dispatch.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ sourceConnectionId: SOURCE_CONNECTION, orderId: 'ol_order_1' }),
      );
      expect(result.results).toHaveLength(2);
      expect(result.results.every((r) => r.kind === 'dispatched')).toBe(true);
    });

    it('should isolate a per-order failure so successful siblings still dispatch (AC-6)', async () => {
      dispatch.dispatch
        .mockResolvedValueOnce({ kind: 'dispatched', shipment: makeShipment({ orderId: 'ol_order_1' }) })
        .mockRejectedValueOnce(new Error('carrier rejected order 2'))
        .mockResolvedValueOnce({ kind: 'dispatched', shipment: makeShipment({ orderId: 'ol_order_3' }) });

      const result = await service.dispatchBulk({
        sourceConnectionId: SOURCE_CONNECTION,
        items: [makeItem('ol_order_1'), makeItem('ol_order_2'), makeItem('ol_order_3')],
      });

      expect(result.results).toHaveLength(3);
      expect(result.results[0]).toMatchObject({ kind: 'dispatched', orderId: 'ol_order_1' });
      expect(result.results[1]).toMatchObject({
        kind: 'failed',
        orderId: 'ol_order_2',
        error: 'carrier rejected order 2',
      });
      expect(result.results[2]).toMatchObject({ kind: 'dispatched', orderId: 'ol_order_3' });
    });

    it('should map an omp_fulfilled dispatch to an omp_fulfilled per-order result', async () => {
      dispatch.dispatch.mockResolvedValueOnce({ kind: 'omp_fulfilled' });

      const result = await service.dispatchBulk({
        sourceConnectionId: SOURCE_CONNECTION,
        items: [makeItem('ol_order_1')],
      });

      expect(result.results[0]).toEqual({ kind: 'omp_fulfilled', orderId: 'ol_order_1' });
    });
  });

  describe('generateProtocol', () => {
    it('should resolve the single carrier connection and return the protocol document', async () => {
      repository.findById
        .mockResolvedValueOnce(makeShipment({ id: 'ol_shipment_1', providerShipmentId: 'waybill-1' }))
        .mockResolvedValueOnce(makeShipment({ id: 'ol_shipment_2', providerShipmentId: 'waybill-2' }));

      const doc = await service.generateProtocol({ shipmentIds: ['ol_shipment_1', 'ol_shipment_2'] });

      expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith(
        DPD_CONNECTION,
        'ShippingProviderManager',
      );
      expect(protocolAdapter.generateProtocol).toHaveBeenCalledWith({
        providerShipmentIds: ['waybill-1', 'waybill-2'],
      });
      expect(doc.contentType).toBe('application/pdf');
    });

    it('should throw InvalidProtocolBatchException for an empty shipment set', async () => {
      await expect(service.generateProtocol({ shipmentIds: [] })).rejects.toBeInstanceOf(
        InvalidProtocolBatchException,
      );
      expect(repository.findById).not.toHaveBeenCalled();
    });

    it('should drop label-less / unknown ids and throw when none have a provider id', async () => {
      repository.findById
        .mockResolvedValueOnce(makeShipment({ id: 'ol_shipment_1', providerShipmentId: null }))
        .mockResolvedValueOnce(null);

      await expect(
        service.generateProtocol({ shipmentIds: ['ol_shipment_1', 'missing'] }),
      ).rejects.toBeInstanceOf(InvalidProtocolBatchException);
      expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
    });

    it('should cover only the labelled shipments, dropping label-less ones from the manifest', async () => {
      repository.findById
        .mockResolvedValueOnce(makeShipment({ id: 'ol_shipment_1', providerShipmentId: 'waybill-1' }))
        .mockResolvedValueOnce(makeShipment({ id: 'ol_shipment_2', providerShipmentId: null }));

      await service.generateProtocol({ shipmentIds: ['ol_shipment_1', 'ol_shipment_2'] });

      expect(protocolAdapter.generateProtocol).toHaveBeenCalledWith({
        providerShipmentIds: ['waybill-1'],
      });
    });

    it('should throw InvalidProtocolBatchException when shipments span multiple carrier connections', async () => {
      repository.findById
        .mockResolvedValueOnce(makeShipment({ id: 'ol_shipment_1', connectionId: 'conn-a', providerShipmentId: 'w1' }))
        .mockResolvedValueOnce(makeShipment({ id: 'ol_shipment_2', connectionId: 'conn-b', providerShipmentId: 'w2' }));

      await expect(
        service.generateProtocol({ shipmentIds: ['ol_shipment_1', 'ol_shipment_2'] }),
      ).rejects.toBeInstanceOf(InvalidProtocolBatchException);
      expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
    });

    it('should throw DispatchProtocolNotSupportedException when the carrier lacks the capability', async () => {
      repository.findById.mockResolvedValueOnce(makeShipment({ providerShipmentId: 'waybill-1' }));
      const nonReader: ShippingProviderManagerPort = {
        generateLabel: jest.fn(),
        getTracking: jest.fn(),
        getSupportedMethods: jest.fn(),
      };
      integrations.getCapabilityAdapter.mockResolvedValue(nonReader);

      await expect(
        service.generateProtocol({ shipmentIds: ['ol_shipment_1'] }),
      ).rejects.toBeInstanceOf(DispatchProtocolNotSupportedException);
    });

    it('should rethrow when the provider generateProtocol rejects', async () => {
      repository.findById.mockResolvedValueOnce(makeShipment({ providerShipmentId: 'waybill-1' }));
      const boom = new Error('provider protocol rejected');
      protocolAdapter.generateProtocol.mockRejectedValue(boom);

      await expect(service.generateProtocol({ shipmentIds: ['ol_shipment_1'] })).rejects.toBe(boom);
    });
  });
});

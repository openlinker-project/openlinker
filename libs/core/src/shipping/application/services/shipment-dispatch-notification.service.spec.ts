/**
 * ShipmentDispatchNotificationService — unit tests (#837)
 *
 * @module libs/core/src/shipping/application/services
 */
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { IIdentifierMappingService } from '@openlinker/core/identifier-mapping';
import type { IOrderRecordService, OrderRecord } from '@openlinker/core/orders';

import { Shipment } from '../../domain/entities/shipment.entity';
import type { ShipmentRepositoryPort } from '../../domain/ports/shipment-repository.port';
import { ShipmentDispatchNotificationService } from './shipment-dispatch-notification.service';

const SOURCE = 'conn-allegro';
const INPOST = 'conn-inpost';
const PS = 'conn-ps';

function makeShipment(overrides: Partial<Shipment> = {}): Shipment {
  return new Shipment(
    overrides.id ?? 'ol_shipment_1',
    overrides.orderId ?? 'ol_order_1',
    overrides.connectionId ?? INPOST,
    overrides.shippingMethod ?? 'paczkomat',
    overrides.status ?? 'generated',
    overrides.providerShipmentId ?? 'prov-1',
    overrides.paczkomatId ?? 'POZ08A',
    overrides.trackingNumber ?? '6800000001',
    overrides.labelPdfRef ?? 'shipx:label:1',
    overrides.dispatchedAt ?? null,
    overrides.deliveredAt ?? null,
    overrides.cancelledAt ?? null,
    overrides.failedAt ?? null,
    overrides.errorMessage ?? null,
    overrides.createdAt ?? new Date('2026-05-27T10:00:00.000Z'),
    overrides.updatedAt ?? new Date('2026-05-27T10:00:00.000Z'),
    overrides.sourceDeliveryMethodId ?? 'allegro-method',
    overrides.carrier ?? null,
  );
}

function makeRecord(partial: Partial<OrderRecord> = {}): OrderRecord {
  // The service only reads `sourceConnectionId` + `syncStatus`; return a thin
  // shape rather than the full positional entity.
  return {
    sourceConnectionId: SOURCE,
    syncStatus: [{ destinationConnectionId: PS, status: 'synced', externalOrderId: 'ps-100' }],
    ...partial,
  } as OrderRecord;
}

describe('ShipmentDispatchNotificationService', () => {
  let shipments: jest.Mocked<ShipmentRepositoryPort>;
  let integrations: jest.Mocked<IIntegrationsService>;
  let orderRecords: jest.Mocked<IOrderRecordService>;
  let identifierMapping: jest.Mocked<IIdentifierMappingService>;
  let service: ShipmentDispatchNotificationService;

  let sourceNotify: jest.Mock;
  let destUpdate: jest.Mock;

  beforeEach(() => {
    shipments = {
      create: jest.fn(),
      findMany: jest.fn(),
      findById: jest.fn(),
      findByOrderId: jest.fn(),
      findActiveByOrderId: jest.fn(),
      findByProviderShipmentId: jest.fn(),
      findBranchOneByOrderAndConnection: jest.fn(),
      update: jest.fn(),
    };
    orderRecords = {
      persistOrder: jest.fn(),
      updateSyncStatus: jest.fn(),
      persistIncomingSnapshot: jest.fn(),
      getOrderRecord: jest.fn().mockResolvedValue(makeRecord()),
      findMany: jest.fn(),
    };
    identifierMapping = {
      getInternalId: jest.fn(),
      getExternalIds: jest
        .fn()
        .mockResolvedValue([{ externalId: 'allegro-cf-1', platformType: 'allegro', connectionId: SOURCE, entityType: 'Order' }]),
      getOrCreateInternalId: jest.fn(),
      createMapping: jest.fn(),
      batchGetOrCreateInternalIds: jest.fn(),
    } as unknown as jest.Mocked<IIdentifierMappingService>;

    sourceNotify = jest.fn().mockResolvedValue(undefined);
    destUpdate = jest.fn().mockResolvedValue(undefined);

    integrations = {
      getAdapter: jest.fn().mockResolvedValue({ connection: {}, metadata: { platformType: 'inpost' } }),
      getCapabilityAdapter: jest.fn(),
      listCapabilityAdapters: jest.fn(),
      resolveAdapterMetadata: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;

    // Default: source implements OrderDispatchNotifier; dest implements OrderFulfillmentUpdater.
    (integrations.getCapabilityAdapter as jest.Mock).mockImplementation((_connId: string, cap: string) =>
      Promise.resolve(
        cap === 'OrderSource'
          ? { listOrderFeed: jest.fn(), getOrder: jest.fn(), notifyDispatched: sourceNotify }
          : { createOrder: jest.fn(), updateFulfillment: destUpdate },
      ),
    );

    service = new ShipmentDispatchNotificationService(
      shipments,
      integrations,
      orderRecords,
      identifierMapping,
    );
  });

  it('should return shipment-not-found when the shipment does not exist', async () => {
    shipments.findById.mockResolvedValue(null);
    const result = await service.notifyDispatched({ shipmentId: 'missing' });
    expect(result.outcome).toBe('shipment-not-found');
    expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
  });

  it('should skip (status-gate) when the shipment is not generated', async () => {
    shipments.findById.mockResolvedValue(makeShipment({ status: 'dispatched' }));
    const result = await service.notifyDispatched({ shipmentId: 'ol_shipment_1' });
    expect(result.outcome).toBe('skipped-not-generated');
    expect(sourceNotify).not.toHaveBeenCalled();
    expect(shipments.update).not.toHaveBeenCalled();
  });

  it('should notify source + destination and advance to dispatched on success', async () => {
    shipments.findById.mockResolvedValue(makeShipment());
    const result = await service.notifyDispatched({ shipmentId: 'ol_shipment_1' });

    expect(sourceNotify).toHaveBeenCalledWith({
      externalOrderId: 'allegro-cf-1',
      trackingNumber: '6800000001',
      carrier: { platformType: 'inpost' },
    });
    expect(destUpdate).toHaveBeenCalledWith({
      externalOrderId: 'ps-100',
      status: 'shipped',
      trackingNumber: '6800000001',
    });
    expect(shipments.update).toHaveBeenCalledWith(
      'ol_shipment_1',
      expect.objectContaining({ status: 'dispatched', dispatchedAt: expect.any(Date) }),
    );
    expect(result).toMatchObject({ outcome: 'notified', source: 'ok', destinations: [{ connectionId: PS, status: 'ok' }] });
  });

  it('should not advance to dispatched when the source notify fails (retriable)', async () => {
    shipments.findById.mockResolvedValue(makeShipment());
    sourceNotify.mockRejectedValue(new Error('Allegro 422'));

    const result = await service.notifyDispatched({ shipmentId: 'ol_shipment_1' });

    expect(result.source).toBe('failed');
    expect(shipments.update).not.toHaveBeenCalled(); // stays generated → retriable
    expect(destUpdate).toHaveBeenCalled(); // B still attempted
  });

  it('should advance to dispatched when there is no source-notify capability (absent)', async () => {
    shipments.findById.mockResolvedValue(makeShipment());
    (integrations.getCapabilityAdapter as jest.Mock).mockImplementation((_c: string, cap: string) =>
      Promise.resolve(
        cap === 'OrderSource'
          ? { listOrderFeed: jest.fn(), getOrder: jest.fn() } // no notifyDispatched
          : { createOrder: jest.fn(), updateFulfillment: destUpdate },
      ),
    );

    const result = await service.notifyDispatched({ shipmentId: 'ol_shipment_1' });

    expect(result.source).toBe('absent');
    expect(shipments.update).toHaveBeenCalledWith('ol_shipment_1', expect.objectContaining({ status: 'dispatched' }));
  });

  it('should mark an unsupported destination without failing and still dispatch', async () => {
    shipments.findById.mockResolvedValue(makeShipment());
    (integrations.getCapabilityAdapter as jest.Mock).mockImplementation((_c: string, cap: string) =>
      Promise.resolve(
        cap === 'OrderSource'
          ? { listOrderFeed: jest.fn(), getOrder: jest.fn(), notifyDispatched: sourceNotify }
          : { createOrder: jest.fn() }, // no updateFulfillment
      ),
    );

    const result = await service.notifyDispatched({ shipmentId: 'ol_shipment_1' });

    expect(result.destinations).toEqual([{ connectionId: PS, status: 'unsupported' }]);
    expect(shipments.update).toHaveBeenCalledWith('ol_shipment_1', expect.objectContaining({ status: 'dispatched' }));
  });

  it('should treat a destination failure as best-effort and still dispatch', async () => {
    shipments.findById.mockResolvedValue(makeShipment());
    destUpdate.mockRejectedValue(new Error('PS 500'));

    const result = await service.notifyDispatched({ shipmentId: 'ol_shipment_1' });

    expect(result.source).toBe('ok');
    expect(result.destinations).toEqual([{ connectionId: PS, status: 'failed' }]);
    expect(shipments.update).toHaveBeenCalledWith('ol_shipment_1', expect.objectContaining({ status: 'dispatched' }));
  });

  it('should isolate per-destination outcomes when one of several destinations fails', async () => {
    const PS2 = 'conn-ps-2';
    shipments.findById.mockResolvedValue(makeShipment());
    orderRecords.getOrderRecord.mockResolvedValue(
      makeRecord({
        syncStatus: [
          { destinationConnectionId: PS, status: 'synced', externalOrderId: 'ps-100' },
          { destinationConnectionId: PS2, status: 'synced', externalOrderId: 'ps-200' },
        ],
      }),
    );
    // First destination succeeds, second rejects — the rejection must not
    // suppress the first's `ok` (Promise.all over per-item try/catch).
    const destUpdate2 = jest.fn().mockRejectedValue(new Error('PS2 500'));
    (integrations.getCapabilityAdapter as jest.Mock).mockImplementation((connId: string, cap: string) =>
      Promise.resolve(
        cap === 'OrderSource'
          ? { listOrderFeed: jest.fn(), getOrder: jest.fn(), notifyDispatched: sourceNotify }
          : { createOrder: jest.fn(), updateFulfillment: connId === PS2 ? destUpdate2 : destUpdate },
      ),
    );

    const result = await service.notifyDispatched({ shipmentId: 'ol_shipment_1' });

    expect(result.destinations).toEqual([
      { connectionId: PS, status: 'ok' },
      { connectionId: PS2, status: 'failed' },
    ]);
    // Source succeeded → still advances despite the partial destination failure.
    expect(shipments.update).toHaveBeenCalledWith('ol_shipment_1', expect.objectContaining({ status: 'dispatched' }));
  });
});

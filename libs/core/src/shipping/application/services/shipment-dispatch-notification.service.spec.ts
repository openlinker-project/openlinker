/**
 * ShipmentDispatchNotificationService — unit tests (#837 / #1168)
 *
 * Since #1168 the cross-system "shipped + tracking" propagation runs through the
 * single role-agnostic `OrderStatusWriteback` lifecycle relay. These tests mock
 * `IOrderLifecycleRelayService` and assert: the relay is driven once with the
 * carrier connection as origin + the dispatched event; the per-target relay
 * outcomes are re-labelled back into the `{source, destinations}` contract by
 * connection id; and the advance-gate (advance iff source ∈ {ok, absent}) is
 * preserved.
 *
 * @module libs/core/src/shipping/application/services
 */
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type {
  IOrderLifecycleRelayService,
  IOrderRecordService,
  OrderLifecycleRelayResult,
  OrderRecord,
} from '@openlinker/core/orders';

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
    overrides.deliveryIntent ?? null,
  );
}

function makeRecord(partial: Partial<OrderRecord> = {}): OrderRecord {
  // The service only reads `sourceConnectionId` to re-label relay targets.
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
  let relay: jest.Mocked<IOrderLifecycleRelayService>;
  let service: ShipmentDispatchNotificationService;

  function relayResult(...targets: OrderLifecycleRelayResult['targets']): OrderLifecycleRelayResult {
    return { targets };
  }

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
      updateFulfillmentState: jest.fn(),
    };

    integrations = {
      getAdapter: jest.fn().mockResolvedValue({ connection: {}, metadata: { platformType: 'inpost' } }),
      getCapabilityAdapter: jest.fn(),
      listCapabilityAdapters: jest.fn(),
      resolveAdapterMetadata: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;

    // Default: source applied, destination applied.
    relay = {
      relay: jest.fn().mockResolvedValue(
        relayResult(
          { connectionId: SOURCE, outcome: 'applied' },
          { connectionId: PS, outcome: 'applied' },
        ),
      ),
    };

    service = new ShipmentDispatchNotificationService(
      shipments,
      integrations,
      orderRecords,
      relay,
    );
  });

  it('should return shipment-not-found when the shipment does not exist', async () => {
    shipments.findById.mockResolvedValue(null);
    const result = await service.notifyDispatched({ shipmentId: 'missing' });
    expect(result.outcome).toBe('shipment-not-found');
    expect(relay.relay).not.toHaveBeenCalled();
  });

  it('should skip (status-gate) when the shipment is not generated — relay not called', async () => {
    shipments.findById.mockResolvedValue(makeShipment({ status: 'dispatched' }));
    const result = await service.notifyDispatched({ shipmentId: 'ol_shipment_1' });
    expect(result.outcome).toBe('skipped-not-generated');
    expect(relay.relay).not.toHaveBeenCalled();
    expect(shipments.update).not.toHaveBeenCalled();
  });

  it('should relay the dispatched event once with the carrier connection as origin', async () => {
    shipments.findById.mockResolvedValue(makeShipment());

    await service.notifyDispatched({ shipmentId: 'ol_shipment_1' });

    expect(relay.relay).toHaveBeenCalledTimes(1);
    expect(relay.relay).toHaveBeenCalledWith({
      internalOrderId: 'ol_order_1',
      originConnectionId: INPOST, // the carrier connection — never an order participant
      event: {
        type: 'dispatched',
        trackingNumber: '6800000001',
        carrier: { platformType: 'inpost' },
      },
    });
  });

  it('should re-label relay targets into {source, destinations} and advance on source applied', async () => {
    shipments.findById.mockResolvedValue(makeShipment());

    const result = await service.notifyDispatched({ shipmentId: 'ol_shipment_1' });

    expect(result).toMatchObject({
      outcome: 'notified',
      source: 'ok',
      destinations: [{ connectionId: PS, status: 'ok' }],
    });
    expect(shipments.update).toHaveBeenCalledWith(
      'ol_shipment_1',
      expect.objectContaining({ status: 'dispatched', dispatchedAt: expect.any(Date) }),
    );
  });

  it('should NOT advance to dispatched when the source target is rejected (retriable)', async () => {
    shipments.findById.mockResolvedValue(makeShipment());
    relay.relay.mockResolvedValue(
      relayResult(
        { connectionId: SOURCE, outcome: 'rejected', detail: 'Allegro 422' },
        { connectionId: PS, outcome: 'applied' },
      ),
    );

    const result = await service.notifyDispatched({ shipmentId: 'ol_shipment_1' });

    expect(result.source).toBe('failed');
    expect(shipments.update).not.toHaveBeenCalled(); // stays generated → retriable
    expect(result.destinations).toEqual([{ connectionId: PS, status: 'ok' }]);
  });

  it('should advance when there is no source target (absent)', async () => {
    shipments.findById.mockResolvedValue(makeShipment());
    relay.relay.mockResolvedValue(relayResult({ connectionId: PS, outcome: 'applied' }));

    const result = await service.notifyDispatched({ shipmentId: 'ol_shipment_1' });

    expect(result.source).toBe('absent');
    expect(shipments.update).toHaveBeenCalledWith(
      'ol_shipment_1',
      expect.objectContaining({ status: 'dispatched' }),
    );
  });

  it('should map a source `unsupported` outcome to absent and still advance', async () => {
    shipments.findById.mockResolvedValue(makeShipment());
    relay.relay.mockResolvedValue(
      relayResult({ connectionId: SOURCE, outcome: 'unsupported', detail: 'no order-writeback capability' }),
    );

    const result = await service.notifyDispatched({ shipmentId: 'ol_shipment_1' });

    expect(result.source).toBe('absent');
    expect(shipments.update).toHaveBeenCalledWith(
      'ol_shipment_1',
      expect.objectContaining({ status: 'dispatched' }),
    );
  });

  it('should map a destination `unsupported`/`rejected` outcome without blocking the dispatch advance', async () => {
    const PS2 = 'conn-ps-2';
    shipments.findById.mockResolvedValue(makeShipment());
    relay.relay.mockResolvedValue(
      relayResult(
        { connectionId: SOURCE, outcome: 'applied' },
        { connectionId: PS, outcome: 'unsupported' },
        { connectionId: PS2, outcome: 'rejected', detail: 'PS2 500' },
      ),
    );

    const result = await service.notifyDispatched({ shipmentId: 'ol_shipment_1' });

    expect(result.source).toBe('ok');
    expect(result.destinations).toEqual([
      { connectionId: PS, status: 'unsupported' },
      { connectionId: PS2, status: 'failed' },
    ]);
    // Source applied → still advances despite the per-destination failures.
    expect(shipments.update).toHaveBeenCalledWith(
      'ol_shipment_1',
      expect.objectContaining({ status: 'dispatched' }),
    );
  });

  it('should degrade carrier hint to undefined when adapter metadata resolution fails', async () => {
    shipments.findById.mockResolvedValue(makeShipment());
    (integrations.getAdapter as jest.Mock).mockRejectedValue(new Error('connection gone'));

    await service.notifyDispatched({ shipmentId: 'ol_shipment_1' });

    expect(relay.relay).toHaveBeenCalledWith(
      expect.objectContaining({
        event: { type: 'dispatched', trackingNumber: '6800000001', carrier: undefined },
      }),
    );
  });

  it('should NOT advance when the relay throws catastrophically (retriable, not silently dispatched)', async () => {
    shipments.findById.mockResolvedValue(makeShipment());
    relay.relay.mockRejectedValue(new Error('identifier resolution boom'));

    const result = await service.notifyDispatched({ shipmentId: 'ol_shipment_1' });

    // A relay throw is a source `failed`, NOT `absent` — the shipment stays
    // `generated` so the operator/retry can re-drive rather than skipping
    // notification permanently past the at-most-once gate.
    expect(result.source).toBe('failed');
    expect(result.destinations).toEqual([]);
    expect(shipments.update).not.toHaveBeenCalled();
  });
});

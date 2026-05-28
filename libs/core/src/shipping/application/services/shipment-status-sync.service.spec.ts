/**
 * ShipmentStatusSyncService — unit tests (#838)
 *
 * Covers the two v1 workarounds explicitly: push-first ordering (failed OMP
 * push drops `trackingNumber` from the patch) and the `>= dispatched` push
 * gate (generated shipments backfill `Shipment.trackingNumber` but don't fire
 * the destination OMP).
 *
 * @module libs/core/src/shipping/application/services
 */
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { IOrderRecordService, OrderRecord } from '@openlinker/core/orders';

import { Shipment } from '../../domain/entities/shipment.entity';
import type { ShipmentRepositoryPort } from '../../domain/ports/shipment-repository.port';
import type { TrackingSnapshot } from '../../domain/types/tracking-snapshot.types';
import { ShipmentStatusSyncService } from './shipment-status-sync.service';

const CARRIER = 'conn-allegro-delivery';
const PS1 = 'conn-ps-1';
const PS2 = 'conn-ps-2';

function makeShipment(overrides: Partial<Shipment> = {}): Shipment {
  // `?? 'prov-abc'` would mask an explicit `null`, but `=== undefined` keeps
  // null pass-through clean without a non-null assertion.
  return new Shipment(
    overrides.id ?? 'ol_shipment_1',
    overrides.orderId ?? 'ol_order_1',
    overrides.connectionId ?? CARRIER,
    overrides.shippingMethod ?? 'paczkomat',
    overrides.status ?? 'dispatched',
    overrides.providerShipmentId === undefined ? 'prov-abc' : overrides.providerShipmentId,
    overrides.paczkomatId ?? null,
    overrides.trackingNumber ?? null,
    overrides.labelPdfRef ?? null,
    overrides.dispatchedAt ?? new Date('2026-05-27T10:00:00.000Z'),
    overrides.deliveredAt ?? null,
    overrides.cancelledAt ?? null,
    overrides.failedAt ?? null,
    overrides.errorMessage ?? null,
    overrides.createdAt ?? new Date('2026-05-27T09:00:00.000Z'),
    overrides.updatedAt ?? new Date('2026-05-27T10:00:00.000Z'),
    overrides.sourceDeliveryMethodId ?? null,
  );
}

function makeRecord(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    syncStatus: [
      { destinationConnectionId: PS1, status: 'synced', externalOrderId: 'ps1-100' },
    ],
    ...overrides,
  } as OrderRecord;
}

function snapshot(overrides: Partial<TrackingSnapshot> = {}): TrackingSnapshot {
  return {
    status: 'dispatched',
    ...overrides,
  };
}

describe('ShipmentStatusSyncService', () => {
  let shipments: jest.Mocked<ShipmentRepositoryPort>;
  let integrations: jest.Mocked<IIntegrationsService>;
  let orderRecords: jest.Mocked<IOrderRecordService>;
  let getTracking: jest.Mock;
  let updateFulfillment: jest.Mock;
  let service: ShipmentStatusSyncService;

  beforeEach(() => {
    shipments = {
      create: jest.fn(),
      findMany: jest.fn(),
      findById: jest.fn(),
      findByOrderId: jest.fn(),
      findActiveByOrderId: jest.fn(),
      findByProviderShipmentId: jest.fn(),
      findBranchOneByOrderAndConnection: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ShipmentRepositoryPort>;

    orderRecords = {
      persistOrder: jest.fn(),
      updateSyncStatus: jest.fn(),
      persistIncomingSnapshot: jest.fn(),
      getOrderRecord: jest.fn().mockResolvedValue(makeRecord()),
      findMany: jest.fn(),
    } as unknown as jest.Mocked<IOrderRecordService>;

    getTracking = jest.fn();
    updateFulfillment = jest.fn().mockResolvedValue(undefined);

    integrations = {
      getAdapter: jest.fn(),
      getCapabilityAdapter: jest.fn(),
      listCapabilityAdapters: jest.fn(),
      resolveAdapterMetadata: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;

    (integrations.getCapabilityAdapter as jest.Mock).mockImplementation(
      (_connId: string, cap: string) => {
        if (cap === 'ShippingProviderManager') {
          return Promise.resolve({ getTracking });
        }
        // OrderProcessorManager — return an adapter that implements
        // OrderFulfillmentUpdater (the `updateFulfillment` presence is what
        // `isOrderFulfillmentUpdater` checks).
        return Promise.resolve({ createOrder: jest.fn(), updateFulfillment });
      },
    );

    service = new ShipmentStatusSyncService(shipments, integrations, orderRecords);
  });

  describe('page mechanics', () => {
    it('returns zero counters and wraps to 0 when the page is empty', async () => {
      shipments.findMany.mockResolvedValue({ items: [], total: 0 });
      const result = await service.sync(CARRIER, { limit: 50 });
      expect(result).toEqual({
        scanned: 0,
        updated: 0,
        propagated: 0,
        failed: 0,
        total: 0,
        nextOffset: 0,
      });
      expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
    });

    it('keeps the offset stationary when the page is empty mid-scan (so the cursor can advance externally)', async () => {
      // Empty page is a degenerate read; consumed = offset + 0 = offset. The
      // caller's cursor advancer sees the same offset on the next tick — that's
      // expected for the OfferStatusSync precedent too.
      shipments.findMany.mockResolvedValue({ items: [], total: 100 });
      const result = await service.sync(CARRIER, { offset: 50, limit: 50 });
      expect(result.nextOffset).toBe(50);
    });

    it('wraps nextOffset to 0 when the scan reaches total', async () => {
      const s = makeShipment({ trackingNumber: '6800000001', status: 'dispatched' });
      getTracking.mockResolvedValue(snapshot({ status: 'delivered', trackingNumber: '6800000001', deliveredAt: new Date('2026-05-28') }));
      shipments.findMany.mockResolvedValue({ items: [s], total: 1 });
      const result = await service.sync(CARRIER, { offset: 0, limit: 50 });
      expect(result.nextOffset).toBe(0);
      expect(result.scanned).toBe(1);
    });

    it('skips shipments without a providerShipmentId without calling the carrier', async () => {
      const s = makeShipment({ providerShipmentId: null });
      shipments.findMany.mockResolvedValue({ items: [s], total: 1 });
      const result = await service.sync(CARRIER, { limit: 50 });
      expect(getTracking).not.toHaveBeenCalled();
      expect(shipments.update).not.toHaveBeenCalled();
      expect(result.failed).toBe(0);
    });

    it('counts a failure when getTracking throws but continues the page', async () => {
      const failing = makeShipment({ id: 'ol_shipment_a' });
      const succeeding = makeShipment({ id: 'ol_shipment_b' });
      shipments.findMany.mockResolvedValue({ items: [failing, succeeding], total: 2 });
      getTracking
        .mockRejectedValueOnce(new Error('carrier 500'))
        .mockResolvedValueOnce(snapshot({ status: 'delivered', deliveredAt: new Date('2026-05-28') }));
      const result = await service.sync(CARRIER, { limit: 50 });
      expect(result).toMatchObject({ scanned: 2, failed: 1, updated: 1 });
    });
  });

  describe('status transitions', () => {
    it('advances into a terminal state (delivered) with deliveredAt set', async () => {
      const s = makeShipment({ trackingNumber: '6800000001' });
      shipments.findMany.mockResolvedValue({ items: [s], total: 1 });
      const deliveredAt = new Date('2026-05-28T12:00:00.000Z');
      getTracking.mockResolvedValue(snapshot({ status: 'delivered', deliveredAt }));
      await service.sync(CARRIER, { limit: 50 });
      expect(shipments.update).toHaveBeenCalledWith(
        s.id,
        expect.objectContaining({ status: 'delivered', deliveredAt }),
      );
    });

    it('advances into terminal cancelled with cancelledAt populated', async () => {
      const s = makeShipment({ trackingNumber: '6800000001' });
      shipments.findMany.mockResolvedValue({ items: [s], total: 1 });
      getTracking.mockResolvedValue(snapshot({ status: 'cancelled' }));
      await service.sync(CARRIER, { limit: 50 });
      const patch = shipments.update.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(patch.status).toBe('cancelled');
      expect(patch.cancelledAt).toBeInstanceOf(Date);
    });

    it('does NOT advance generated → dispatched (left to #837 notifyDispatched)', async () => {
      const s = makeShipment({ status: 'generated', trackingNumber: '6800000001' });
      shipments.findMany.mockResolvedValue({ items: [s], total: 1 });
      getTracking.mockResolvedValue(snapshot({ status: 'dispatched' }));
      await service.sync(CARRIER, { limit: 50 });
      expect(shipments.update).not.toHaveBeenCalled();
    });

    it('does NOT advance dispatched → in-transit (non-terminal forward)', async () => {
      const s = makeShipment({ status: 'dispatched', trackingNumber: '6800000001' });
      shipments.findMany.mockResolvedValue({ items: [s], total: 1 });
      getTracking.mockResolvedValue(snapshot({ status: 'in-transit' }));
      await service.sync(CARRIER, { limit: 50 });
      expect(shipments.update).not.toHaveBeenCalled();
    });
  });

  describe('tracking-number backfill', () => {
    it('backfills tracking on generated shipment WITHOUT pushing to the destination OMP (workaround #2)', async () => {
      const s = makeShipment({ status: 'generated', trackingNumber: null });
      shipments.findMany.mockResolvedValue({ items: [s], total: 1 });
      getTracking.mockResolvedValue(snapshot({ status: 'generated', trackingNumber: 'NEW123' }));
      const result = await service.sync(CARRIER, { limit: 50 });
      expect(shipments.update).toHaveBeenCalledWith(
        s.id,
        expect.objectContaining({ trackingNumber: 'NEW123' }),
      );
      expect(updateFulfillment).not.toHaveBeenCalled();
      expect(result.propagated).toBe(0);
      expect(result.updated).toBe(1);
    });

    it('backfills tracking on dispatched shipment AND pushes shipped+tracking to every destination', async () => {
      orderRecords.getOrderRecord.mockResolvedValue(
        makeRecord({
          syncStatus: [
            { destinationConnectionId: PS1, status: 'synced', externalOrderId: 'ps1-100' },
            { destinationConnectionId: PS2, status: 'synced', externalOrderId: 'ps2-200' },
          ],
        } as Partial<OrderRecord>),
      );
      const s = makeShipment({ status: 'dispatched', trackingNumber: null });
      shipments.findMany.mockResolvedValue({ items: [s], total: 1 });
      getTracking.mockResolvedValue(snapshot({ status: 'dispatched', trackingNumber: 'NEW456' }));
      const result = await service.sync(CARRIER, { limit: 50 });
      expect(updateFulfillment).toHaveBeenCalledTimes(2);
      expect(updateFulfillment).toHaveBeenCalledWith({
        externalOrderId: 'ps1-100',
        status: 'shipped',
        trackingNumber: 'NEW456',
      });
      expect(updateFulfillment).toHaveBeenCalledWith({
        externalOrderId: 'ps2-200',
        status: 'shipped',
        trackingNumber: 'NEW456',
      });
      expect(shipments.update).toHaveBeenCalledWith(
        s.id,
        expect.objectContaining({ trackingNumber: 'NEW456' }),
      );
      expect(result.propagated).toBe(1);
    });

    it('PUSH-FIRST: drops trackingNumber from the patch when ANY destination push throws (workaround #1)', async () => {
      orderRecords.getOrderRecord.mockResolvedValue(
        makeRecord({
          syncStatus: [
            { destinationConnectionId: PS1, status: 'synced', externalOrderId: 'ps1-100' },
            { destinationConnectionId: PS2, status: 'synced', externalOrderId: 'ps2-200' },
          ],
        } as Partial<OrderRecord>),
      );
      // First push succeeds, second throws.
      updateFulfillment
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('500 from PS2'));
      const s = makeShipment({ status: 'dispatched', trackingNumber: null });
      shipments.findMany.mockResolvedValue({ items: [s], total: 1 });
      getTracking.mockResolvedValue(snapshot({ status: 'dispatched', trackingNumber: 'NEW456' }));
      const result = await service.sync(CARRIER, { limit: 50 });
      // Push attempted on both, only second threw.
      expect(updateFulfillment).toHaveBeenCalledTimes(2);
      // No update call — patch was empty because the single field (tracking) was dropped.
      expect(shipments.update).not.toHaveBeenCalled();
      expect(result.propagated).toBe(0);
      expect(result.updated).toBe(0);
      // Per-item error was caught at the destination layer, not the outer try, so it's not "failed".
      expect(result.failed).toBe(0);
    });

    it('pushes nothing when no destinations have an externalOrderId yet — still backfills tracking', async () => {
      orderRecords.getOrderRecord.mockResolvedValue(
        makeRecord({ syncStatus: [{ destinationConnectionId: PS1, status: 'pending' }] } as Partial<OrderRecord>),
      );
      const s = makeShipment({ status: 'dispatched', trackingNumber: null });
      shipments.findMany.mockResolvedValue({ items: [s], total: 1 });
      getTracking.mockResolvedValue(snapshot({ status: 'dispatched', trackingNumber: 'NEW456' }));
      const result = await service.sync(CARRIER, { limit: 50 });
      expect(updateFulfillment).not.toHaveBeenCalled();
      expect(shipments.update).toHaveBeenCalledWith(
        s.id,
        expect.objectContaining({ trackingNumber: 'NEW456' }),
      );
      expect(result.propagated).toBe(1); // vacuously: all-zero destinations all-ok
    });

    it('skips a destination that does not implement OrderFulfillmentUpdater (no failure)', async () => {
      (integrations.getCapabilityAdapter as jest.Mock).mockImplementation(
        (_connId: string, cap: string) => {
          if (cap === 'ShippingProviderManager') return Promise.resolve({ getTracking });
          // OrderProcessorManager that LACKS updateFulfillment.
          return Promise.resolve({ createOrder: jest.fn() });
        },
      );
      const s = makeShipment({ status: 'dispatched', trackingNumber: null });
      shipments.findMany.mockResolvedValue({ items: [s], total: 1 });
      getTracking.mockResolvedValue(snapshot({ status: 'dispatched', trackingNumber: 'NEW456' }));
      const result = await service.sync(CARRIER, { limit: 50 });
      // Push not invoked, but the shipment is patched (treated as vacuously OK).
      expect(shipments.update).toHaveBeenCalledWith(
        s.id,
        expect.objectContaining({ trackingNumber: 'NEW456' }),
      );
      expect(result.failed).toBe(0);
    });

    it('does not overwrite a previously-set tracking number', async () => {
      const s = makeShipment({ status: 'dispatched', trackingNumber: 'EXISTING' });
      shipments.findMany.mockResolvedValue({ items: [s], total: 1 });
      getTracking.mockResolvedValue(snapshot({ status: 'dispatched', trackingNumber: 'WOULD_OVERWRITE' }));
      await service.sync(CARRIER, { limit: 50 });
      expect(updateFulfillment).not.toHaveBeenCalled();
      expect(shipments.update).not.toHaveBeenCalled();
    });
  });
});

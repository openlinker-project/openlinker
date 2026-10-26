/**
 * SourceFulfillmentStatusSyncService - unit tests (ADR-012 amendment)
 *
 * Covers the source-side read-back: recording a waybill a third party added in
 * the order's SOURCE, the fill-in of an existing source-observed row, the
 * idempotent re-run, every echo case (OL's own waybill read back), the
 * cancelled-order skip, a source that declares no readback, the
 * `waybills: null` vs `[]` distinction, and the claimed relay to destinations.
 */
import type { IIdentifierMappingService } from '@openlinker/core/identifier-mapping';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type {
  IOrderLifecycleRelayService,
  IOrderRecordService,
  OrderRecord,
  SourceFulfillmentReadback,
} from '@openlinker/core/orders';

import { Shipment } from '../../domain/entities/shipment.entity';
import type { ShipmentRepositoryPort } from '../../domain/ports/shipment-repository.port';
import { SourceFulfillmentStatusSyncService } from './source-fulfillment-status-sync.service';

const SHOPER = 'conn-shoper-src';
const PS = 'conn-ps-dest';
const ORDER = 'ol_order_1';
const SOURCE_ORDER_ID = '1001';

function makeRecord(
  overrides: {
    cancelled?: boolean;
    syncedTo?: Array<{ destinationConnectionId: string; externalOrderId?: string }>;
  } = {},
): OrderRecord {
  return {
    internalOrderId: ORDER,
    sourceConnectionId: SHOPER,
    syncStatus: overrides.syncedTo ?? [
      { destinationConnectionId: PS, status: 'synced', externalOrderId: 'ps-100' },
    ],
    orderSnapshot: {},
    isCancelled: overrides.cancelled ?? false,
  } as unknown as OrderRecord;
}

function makeShipment(overrides: Partial<Shipment> = {}): Shipment {
  return new Shipment(
    overrides.id ?? 'ol_shipment_src',
    overrides.orderId ?? ORDER,
    overrides.connectionId ?? SHOPER,
    overrides.shippingMethod ?? 'omp',
    overrides.status ?? 'dispatched',
    overrides.providerShipmentId ?? null,
    null,
    overrides.trackingNumber ?? null,
    null,
    overrides.dispatchedAt ?? new Date('2026-10-20T10:00:00.000Z'),
    null,
    null,
    null,
    null,
    new Date('2026-10-20T10:00:00.000Z'),
    new Date('2026-10-20T10:00:00.000Z'),
    null,
    null,
    null,
    null,
    overrides.waybillRelayedAt ?? null,
    'outbound',
    null,
    null,
    overrides.waybillRelayFailure ?? null,
    { relayedAt: null, failureCount: 0, lastFailureAt: null },
  );
}

function readback(overrides: Partial<SourceFulfillmentReadback> = {}): SourceFulfillmentReadback {
  return {
    outcome: 'read',
    rawStatus: '3',
    dispatched: true,
    waybills: [{ waybill: 'TP-3RD-PARTY-1', carrierName: 'InPost' }],
    ...overrides,
  };
}

describe('SourceFulfillmentStatusSyncService', () => {
  let shipments: jest.Mocked<
    Pick<
      ShipmentRepositoryPort,
      | 'findByOrderId'
      | 'create'
      | 'update'
      | 'claimWaybillRelay'
      | 'releaseWaybillRelay'
      | 'giveUpWaybillRelay'
      | 'clearWaybillRelayFailures'
    >
  >;
  let orderRecords: { findMany: jest.Mock };
  let identifierMapping: { getExternalIds: jest.Mock };
  let integrations: { getCapabilityAdapter: jest.Mock };
  let readFulfillment: jest.Mock;
  let recompute: jest.Mock;
  let relay: jest.Mocked<IOrderLifecycleRelayService>;
  let service: SourceFulfillmentStatusSyncService;

  beforeEach(() => {
    shipments = {
      findByOrderId: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation((input: { trackingNumber?: string }) =>
        Promise.resolve(makeShipment({ trackingNumber: input.trackingNumber ?? null })),
      ),
      update: jest.fn().mockImplementation((_id: string, patch: { trackingNumber?: string }) =>
        Promise.resolve(makeShipment({ trackingNumber: patch.trackingNumber ?? null })),
      ),
      claimWaybillRelay: jest.fn().mockResolvedValue(true),
      releaseWaybillRelay: jest.fn(),
      giveUpWaybillRelay: jest.fn(),
      clearWaybillRelayFailures: jest.fn(),
    };
    orderRecords = {
      findMany: jest.fn().mockResolvedValue({ items: [makeRecord()], total: 1 }),
    };
    identifierMapping = {
      getExternalIds: jest.fn().mockResolvedValue([
        { connectionId: PS, externalId: 'ps-100', platformType: 'prestashop', entityType: 'Order' },
        { connectionId: SHOPER, externalId: SOURCE_ORDER_ID, platformType: 'shoper', entityType: 'Order' },
      ]),
    };
    readFulfillment = jest.fn().mockResolvedValue(readback());
    integrations = {
      getCapabilityAdapter: jest.fn().mockResolvedValue({
        listOrderFeed: jest.fn(),
        getOrder: jest.fn(),
        readFulfillment,
      }),
    };
    recompute = jest.fn();
    relay = {
      relay: jest.fn().mockResolvedValue({
        targets: [{ connectionId: PS, outcome: 'applied' }],
      }),
    };

    service = new SourceFulfillmentStatusSyncService(
      shipments as unknown as ShipmentRepositoryPort,
      orderRecords as unknown as IOrderRecordService,
      identifierMapping as unknown as IIdentifierMappingService,
      integrations as unknown as IIntegrationsService,
      { recompute },
      relay,
    );
  });

  describe('a waybill a third party added in the source', () => {
    it('should create a dispatched branch-1 row on the SOURCE connection carrying the waybill', async () => {
      const result = await service.sync(SHOPER, { limit: 100 });

      expect(readFulfillment).toHaveBeenCalledWith({ externalOrderId: SOURCE_ORDER_ID });
      expect(shipments.create).toHaveBeenCalledTimes(1);
      const input = shipments.create.mock.calls[0][0];
      expect(input).toEqual(
        expect.objectContaining({
          orderId: ORDER,
          connectionId: SHOPER,
          shippingMethod: 'omp',
          initialStatus: 'dispatched',
          trackingNumber: 'TP-3RD-PARTY-1',
        }),
      );
      expect(input.dispatchedAt).toBeInstanceOf(Date);
      // A source-observed row never carries a provider id: OL holds none.
      expect(Object.keys(input)).not.toContain('providerShipmentId');
      expect(recompute).toHaveBeenCalledWith(ORDER);
      expect(result).toEqual(
        expect.objectContaining({ scanned: 1, created: 1, updated: 0, relayed: 1, skipped: 0, failed: 0 }),
      );
    });

    it('should relay dispatched + the waybill to the destinations with the SOURCE as origin, under the claim', async () => {
      await service.sync(SHOPER, { limit: 100 });

      expect(shipments.claimWaybillRelay).toHaveBeenCalledWith('ol_shipment_src', expect.any(Date));
      expect(relay.relay).toHaveBeenCalledWith({
        internalOrderId: ORDER,
        originConnectionId: SHOPER,
        event: { type: 'dispatched', trackingNumber: 'TP-3RD-PARTY-1', carrier: undefined },
      });
      expect(shipments.clearWaybillRelayFailures).toHaveBeenCalledWith('ol_shipment_src');
    });

    it('should page only ready, not-cancelled orders ingested from this source', async () => {
      await service.sync(SHOPER, { limit: 25, offset: 50, updatedSinceDays: 7 });

      const [filters, pagination] = orderRecords.findMany.mock.calls[0] as [
        { updatedSince: unknown },
        unknown,
      ];
      expect(filters).toEqual(
        expect.objectContaining({
          sourceConnectionId: SHOPER,
          recordStatus: 'ready',
          cancelled: false,
        }),
      );
      expect(filters.updatedSince).toBeInstanceOf(Date);
      expect(pagination).toEqual({ offset: 50, limit: 25 });
    });

    it('should skip the reported waybills OL already knows and record the first unknown one', async () => {
      shipments.findByOrderId.mockResolvedValue([
        makeShipment({
          id: 'ol_shipment_old',
          connectionId: 'conn-inpost',
          providerShipmentId: 'inpost-1',
          status: 'cancelled',
          trackingNumber: 'OL-VOIDED-1',
        }),
      ]);
      readFulfillment.mockResolvedValue(
        readback({ waybills: [{ waybill: 'ol-voided-1 ' }, { waybill: 'TP-3RD-PARTY-2' }] }),
      );

      await service.sync(SHOPER, { limit: 100 });

      expect(shipments.create.mock.calls[0][0].trackingNumber).toBe('TP-3RD-PARTY-2');
    });
  });

  describe('fill-in of an existing source-observed row', () => {
    it('should fill a null tracking number in (null -> value) and relay it', async () => {
      shipments.findByOrderId.mockResolvedValue([makeShipment({ trackingNumber: null })]);

      const result = await service.sync(SHOPER, { limit: 100 });

      expect(shipments.create).not.toHaveBeenCalled();
      expect(shipments.update).toHaveBeenCalledWith('ol_shipment_src', {
        trackingNumber: 'TP-3RD-PARTY-1',
      });
      expect(relay.relay).toHaveBeenCalledTimes(1);
      expect(result.updated).toBe(1);
    });

    it('should not revive a cancelled source-observed row with a number', async () => {
      shipments.findByOrderId.mockResolvedValue([
        makeShipment({ trackingNumber: null, status: 'cancelled' }),
      ]);

      const result = await service.sync(SHOPER, { limit: 100 });

      expect(shipments.update).not.toHaveBeenCalled();
      expect(relay.relay).not.toHaveBeenCalled();
      expect(result.skipped).toBe(1);
    });
  });

  describe('idempotent re-run', () => {
    it('should neither read the source nor write when the row already holds its relayed waybill', async () => {
      shipments.findByOrderId.mockResolvedValue([
        makeShipment({
          trackingNumber: 'TP-3RD-PARTY-1',
          waybillRelayedAt: new Date('2026-10-20T10:05:00.000Z'),
        }),
      ]);

      const result = await service.sync(SHOPER, { limit: 100 });

      expect(readFulfillment).not.toHaveBeenCalled();
      expect(shipments.create).not.toHaveBeenCalled();
      expect(shipments.update).not.toHaveBeenCalled();
      expect(relay.relay).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ skipped: 1, relayed: 0 }));
    });

    it('should RE-DRIVE an owed relay without asking the source again', async () => {
      // An earlier relay failed and released the claim; the waybill was kept.
      shipments.findByOrderId.mockResolvedValue([
        makeShipment({ trackingNumber: 'TP-3RD-PARTY-1', waybillRelayedAt: null }),
      ]);

      const result = await service.sync(SHOPER, { limit: 100 });

      expect(readFulfillment).not.toHaveBeenCalled();
      expect(relay.relay).toHaveBeenCalledTimes(1);
      expect(result).toEqual(expect.objectContaining({ skipped: 1, relayed: 1 }));
    });

    it('should release the claim and keep the row owed when a destination rejects the relay', async () => {
      relay.relay.mockResolvedValue({
        targets: [{ connectionId: PS, outcome: 'rejected', detail: 'down' }],
      });

      const result = await service.sync(SHOPER, { limit: 100 });

      expect(shipments.create).toHaveBeenCalledTimes(1);
      expect(shipments.releaseWaybillRelay).toHaveBeenCalledWith(
        'ol_shipment_src',
        expect.objectContaining({ reason: 'rejected', connectionId: PS }),
      );
      expect(result).toEqual(expect.objectContaining({ created: 1, relayed: 0 }));
    });

    it('should not relay when another trigger already holds the claim', async () => {
      shipments.claimWaybillRelay.mockResolvedValue(false);

      await service.sync(SHOPER, { limit: 100 });

      expect(relay.relay).not.toHaveBeenCalled();
    });

    it('should leave the row owed and NOT relay when the order has no destination yet', async () => {
      orderRecords.findMany.mockResolvedValue({
        items: [makeRecord({ syncedTo: [] })],
        total: 1,
      });

      const result = await service.sync(SHOPER, { limit: 100 });

      // The parcel is still recorded - OL now knows the order shipped.
      expect(shipments.create).toHaveBeenCalledTimes(1);
      // But nobody is told, and the claim is never taken, so a destination
      // provisioned later still receives the waybill on a later tick.
      expect(shipments.claimWaybillRelay).not.toHaveBeenCalled();
      expect(relay.relay).not.toHaveBeenCalled();
      expect(result.relayed).toBe(0);
    });
  });

  describe('echo guard - OL reading its own dispatch back (ADR-027)', () => {
    it('should not read the source at all when OL already tracks a live parcel for the order', async () => {
      // OL bought the label and relayed OL-TRK-1 into the source.
      shipments.findByOrderId.mockResolvedValue([
        makeShipment({
          id: 'ol_shipment_ol',
          connectionId: 'conn-inpost',
          providerShipmentId: 'inpost-1',
          trackingNumber: 'OL-TRK-1',
        }),
      ]);

      const result = await service.sync(SHOPER, { limit: 100 });

      expect(readFulfillment).not.toHaveBeenCalled();
      expect(shipments.create).not.toHaveBeenCalled();
      expect(relay.relay).not.toHaveBeenCalled();
      expect(result.skipped).toBe(1);
    });

    it('should not read the source when a destination branch-1 row already carries a tracking number', async () => {
      // The destination shipped; FulfillmentStatusSyncService relayed DEST-TRK
      // into the source, which now reports it back.
      shipments.findByOrderId.mockResolvedValue([
        makeShipment({ id: 'ol_shipment_dest', connectionId: PS, trackingNumber: 'DEST-TRK' }),
      ]);

      await service.sync(SHOPER, { limit: 100 });

      expect(readFulfillment).not.toHaveBeenCalled();
      expect(shipments.create).not.toHaveBeenCalled();
    });

    it('should ignore a waybill equal to one OL already holds, even on a voided label', async () => {
      // A dead label's tracking number does not stop the read - the order may
      // genuinely have shipped another way - but its echo is not a new parcel.
      shipments.findByOrderId.mockResolvedValue([
        makeShipment({
          id: 'ol_shipment_ol',
          connectionId: 'conn-inpost',
          providerShipmentId: 'inpost-1',
          status: 'cancelled',
          trackingNumber: 'OL-TRK-1',
        }),
      ]);
      readFulfillment.mockResolvedValue(readback({ waybills: [{ waybill: 'OL-TRK-1' }] }));

      const result = await service.sync(SHOPER, { limit: 100 });

      expect(readFulfillment).toHaveBeenCalledTimes(1);
      expect(shipments.create).not.toHaveBeenCalled();
      expect(relay.relay).not.toHaveBeenCalled();
      expect(result.skipped).toBe(1);
    });

    it('should not record a dispatch that carries no waybill (indistinguishable from OL relaying a tracking-less dispatch)', async () => {
      readFulfillment.mockResolvedValue(readback({ waybills: [] }));

      const result = await service.sync(SHOPER, { limit: 100 });

      expect(shipments.create).not.toHaveBeenCalled();
      expect(result.skipped).toBe(1);
    });
  });

  describe('what the source answered', () => {
    it('should treat waybills: null as "not reported", never as a dispatch without tracking', async () => {
      readFulfillment.mockResolvedValue(readback({ waybills: null }));

      const result = await service.sync(SHOPER, { limit: 100 });

      expect(shipments.create).not.toHaveBeenCalled();
      expect(shipments.update).not.toHaveBeenCalled();
      expect(result.skipped).toBe(1);
    });

    it.each([
      ['not dispatched', { dispatched: false }],
      ['an unrecognised status (dispatched: null)', { dispatched: null }],
      ['unavailable', { outcome: 'unavailable' as const, dispatched: null, waybills: null }],
    ])('should record nothing when the source answered %s', async (_label, overrides) => {
      readFulfillment.mockResolvedValue(readback(overrides));

      const result = await service.sync(SHOPER, { limit: 100 });

      expect(shipments.create).not.toHaveBeenCalled();
      expect(result.skipped).toBe(1);
    });

    it('should degrade a throwing readback to "no answer", not a failed record', async () => {
      readFulfillment.mockRejectedValue(new Error('boom'));

      const result = await service.sync(SHOPER, { limit: 100 });

      expect(result).toEqual(expect.objectContaining({ skipped: 1, failed: 0 }));
    });

    it('should skip an order with no source-side identifier mapping', async () => {
      identifierMapping.getExternalIds.mockResolvedValue([
        { connectionId: PS, externalId: 'ps-100', platformType: 'prestashop', entityType: 'Order' },
      ]);

      const result = await service.sync(SHOPER, { limit: 100 });

      // Never asks the source with a DESTINATION's id.
      expect(readFulfillment).not.toHaveBeenCalled();
      expect(result.skipped).toBe(1);
    });
  });

  describe('cancelled order', () => {
    it('should not create a row for an order cancelled between the page read and the readback', async () => {
      orderRecords.findMany.mockResolvedValue({ items: [makeRecord({ cancelled: true })], total: 1 });

      const result = await service.sync(SHOPER, { limit: 100 });

      expect(shipments.findByOrderId).not.toHaveBeenCalled();
      expect(readFulfillment).not.toHaveBeenCalled();
      expect(shipments.create).not.toHaveBeenCalled();
      expect(result.skipped).toBe(1);
    });
  });

  describe('source adapter', () => {
    it('should skip the whole page when the source declares no OrderFulfillmentReadback', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue({
        listOrderFeed: jest.fn(),
        getOrder: jest.fn(),
      });

      const result = await service.sync(SHOPER, { limit: 100 });

      expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith(SHOPER, 'OrderSource');
      expect(shipments.findByOrderId).not.toHaveBeenCalled();
      expect(result).toEqual(
        expect.objectContaining({ scanned: 1, skipped: 1, failed: 0, created: 0, nextOffset: 0 }),
      );
    });

    it('should mark the page failed when the adapter cannot be resolved', async () => {
      integrations.getCapabilityAdapter.mockRejectedValue(new Error('needs_reauth'));

      const result = await service.sync(SHOPER, { limit: 100 });

      expect(result).toEqual(expect.objectContaining({ scanned: 1, failed: 1, skipped: 0 }));
    });
  });

  describe('error containment and cursor', () => {
    it('should count a throwing record as failed and carry on with the page', async () => {
      orderRecords.findMany.mockResolvedValue({
        items: [makeRecord(), makeRecord()],
        total: 2,
      });
      shipments.create
        .mockRejectedValueOnce(new Error('duplicate key value violates unique constraint'))
        .mockResolvedValueOnce(makeShipment({ trackingNumber: 'TP-3RD-PARTY-1' }));

      const result = await service.sync(SHOPER, { limit: 100 });

      expect(result).toEqual(expect.objectContaining({ failed: 1, created: 1 }));
    });

    it('should advance the offset while rows remain and wrap to 0 at the end', async () => {
      orderRecords.findMany.mockResolvedValue({ items: [makeRecord()], total: 5 });
      const mid = await service.sync(SHOPER, { limit: 1, offset: 2 });
      expect(mid.nextOffset).toBe(3);

      const end = await service.sync(SHOPER, { limit: 1, offset: 4 });
      expect(end.nextOffset).toBe(0);
    });
  });
});

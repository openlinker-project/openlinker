/**
 * FulfillmentStatusSyncService — unit tests (#834)
 *
 * Covers the orchestration: routing-cache amortisation, branch-1
 * disambiguation against branches 2/3, the projection-only null skip, and
 * find-or-create with diff-patching against existing branch-1 rows.
 */
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { IFulfillmentRoutingService } from '@openlinker/core/mappings';
import { FULFILLMENT_PROCESSOR_KIND } from '@openlinker/core/mappings';
import type {
  FulfillmentStatusReader,
  IOrderRecordService,
  OrderRecord,
} from '@openlinker/core/orders';
import { FULFILLMENT_STATUS } from '@openlinker/core/orders';

import { Shipment } from '../../domain/entities/shipment.entity';
import type { ShipmentRepositoryPort } from '../../domain/ports/shipment-repository.port';
import { SHIPMENT_STATUS } from '../../domain/types/shipment-status.types';
import { FulfillmentStatusSyncService } from './fulfillment-status-sync.service';

const PS = 'conn-ps-1';
const ALLEGRO = 'conn-allegro-1';

function makeOrderRecord(overrides: {
  internalOrderId?: string;
  sourceConnectionId?: string;
  methodId?: string | null;
  syncedTo?: Array<{ destinationConnectionId: string; externalOrderId?: string }>;
} = {}): OrderRecord {
  const shipping = overrides.methodId === null
    ? {}
    : { shipping: { methodId: overrides.methodId ?? 'allegro-courier' } };
  return {
    internalOrderId: overrides.internalOrderId ?? 'ol_order_1',
    sourceConnectionId: overrides.sourceConnectionId ?? ALLEGRO,
    syncStatus: overrides.syncedTo ?? [
      { destinationConnectionId: PS, status: 'synced', externalOrderId: 'ps-100' },
    ],
    orderSnapshot: shipping as Record<string, unknown>,
  } as unknown as OrderRecord;
}

function makeBranchOneShipment(overrides: Partial<Shipment> = {}): Shipment {
  return new Shipment(
    overrides.id ?? 'ol_shipment_1',
    overrides.orderId ?? 'ol_order_1',
    overrides.connectionId ?? PS,
    overrides.shippingMethod ?? 'omp',
    overrides.status ?? 'dispatched',
    null,                                  // providerShipmentId — branch-1 invariant
    overrides.paczkomatId ?? null,
    overrides.trackingNumber ?? null,
    overrides.labelPdfRef ?? null,
    overrides.dispatchedAt ?? null,
    overrides.deliveredAt ?? null,
    overrides.cancelledAt ?? null,
    overrides.failedAt ?? null,
    overrides.errorMessage ?? null,
    overrides.createdAt ?? new Date('2026-05-27T09:00:00.000Z'),
    overrides.updatedAt ?? new Date('2026-05-27T10:00:00.000Z'),
    overrides.sourceDeliveryMethodId ?? null,
    overrides.carrier === undefined ? null : overrides.carrier,
  );
}

describe('FulfillmentStatusSyncService', () => {
  let shipments: jest.Mocked<ShipmentRepositoryPort>;
  let orderRecords: jest.Mocked<IOrderRecordService>;
  let routing: jest.Mocked<IFulfillmentRoutingService>;
  let integrations: jest.Mocked<IIntegrationsService>;
  let getFulfillmentStatus: jest.Mock;
  let service: FulfillmentStatusSyncService;

  beforeEach(() => {
    shipments = {
      create: jest.fn(),
      findMany: jest.fn(),
      findById: jest.fn(),
      findByOrderId: jest.fn(),
      findActiveByOrderId: jest.fn(),
      findByProviderShipmentId: jest.fn(),
      findBranchOneByOrderAndConnection: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
    };

    orderRecords = {
      persistOrder: jest.fn(),
      updateSyncStatus: jest.fn(),
      persistIncomingSnapshot: jest.fn(),
      getOrderRecord: jest.fn(),
      findMany: jest.fn(),
    };

    routing = {
      resolve: jest.fn().mockResolvedValue({
        processorKind: FULFILLMENT_PROCESSOR_KIND.OmpFulfilled,
        processorConnectionId: null,
        source: 'default',
      }),
      // The other IFulfillmentRoutingService methods aren't called by the
      // sync service; stub them so the Mocked<…> shape is satisfied.
      getCandidateProcessors: jest.fn(),
      replaceRules: jest.fn(),
      listRules: jest.fn(),
    } as unknown as jest.Mocked<IFulfillmentRoutingService>;

    getFulfillmentStatus = jest.fn();
    const ompAdapter: FulfillmentStatusReader = { getFulfillmentStatus };
    integrations = {
      getCapabilityAdapter: jest.fn().mockResolvedValue(ompAdapter),
    } as unknown as jest.Mocked<IIntegrationsService>;

    service = new FulfillmentStatusSyncService(
      shipments,
      orderRecords,
      routing,
      integrations,
    );
  });

  describe('happy path — branch-1, OMP has acted, no existing shipment', () => {
    it('should create a branch-1 Shipment born at the snapshot status', async () => {
      orderRecords.findMany.mockResolvedValue({
        items: [makeOrderRecord()],
        total: 1,
      });
      getFulfillmentStatus.mockResolvedValue({
        status: FULFILLMENT_STATUS.Dispatched,
        trackingNumber: 'PS-TRK-1',
        deliveredAt: null,
      });

      const result = await service.sync(PS, { limit: 100 });

      expect(shipments.create).toHaveBeenCalledTimes(1);
      const createInput = shipments.create.mock.calls[0][0];
      expect(createInput.connectionId).toBe(PS);
      expect(createInput.orderId).toBe('ol_order_1');
      expect(createInput.shippingMethod).toBe('omp');
      expect(createInput.initialStatus).toBe(SHIPMENT_STATUS.Dispatched);
      expect(createInput.trackingNumber).toBe('PS-TRK-1');
      expect(createInput.dispatchedAt).toBeInstanceOf(Date);
      expect(createInput.deliveredAt).toBeUndefined();
      expect(createInput.sourceDeliveryMethodId).toBe('allegro-courier');
      expect(result).toMatchObject({
        scanned: 1,
        created: 1,
        updated: 0,
        skipped: 0,
        failed: 0,
      });
    });

    it('should set deliveredAt on Delivered transitions', async () => {
      orderRecords.findMany.mockResolvedValue({
        items: [makeOrderRecord()],
        total: 1,
      });
      const deliveredAt = new Date('2026-05-28T08:00:00.000Z');
      getFulfillmentStatus.mockResolvedValue({
        status: FULFILLMENT_STATUS.Delivered,
        trackingNumber: 'PS-TRK-1',
        deliveredAt,
      });

      await service.sync(PS, { limit: 100 });

      const createInput = shipments.create.mock.calls[0][0];
      expect(createInput.initialStatus).toBe(SHIPMENT_STATUS.Delivered);
      expect(createInput.deliveredAt).toEqual(deliveredAt);
    });
  });

  describe('routing-cache amortisation', () => {
    it('should call routing.resolve once per distinct (sourceConn, methodId) — even with many records', async () => {
      const records = [
        makeOrderRecord({ internalOrderId: 'ol_order_1', methodId: 'm1' }),
        makeOrderRecord({ internalOrderId: 'ol_order_2', methodId: 'm1' }),
        makeOrderRecord({ internalOrderId: 'ol_order_3', methodId: 'm1' }),
      ];
      orderRecords.findMany.mockResolvedValue({ items: records, total: 3 });
      getFulfillmentStatus.mockResolvedValue({
        status: null,
        trackingNumber: null,
        deliveredAt: null,
      });

      await service.sync(PS, { limit: 100 });

      expect(routing.resolve).toHaveBeenCalledTimes(1);
      expect(routing.resolve).toHaveBeenCalledWith({
        sourceConnectionId: ALLEGRO,
        sourceDeliveryMethodId: 'm1',
      });
    });

    it('should call routing.resolve once per distinct method even within one page', async () => {
      const records = [
        makeOrderRecord({ internalOrderId: 'ol_order_1', methodId: 'm1' }),
        makeOrderRecord({ internalOrderId: 'ol_order_2', methodId: 'm2' }),
        makeOrderRecord({ internalOrderId: 'ol_order_3', methodId: 'm1' }),
      ];
      orderRecords.findMany.mockResolvedValue({ items: records, total: 3 });
      getFulfillmentStatus.mockResolvedValue({
        status: null,
        trackingNumber: null,
        deliveredAt: null,
      });

      await service.sync(PS, { limit: 100 });

      expect(routing.resolve).toHaveBeenCalledTimes(2);
    });
  });

  describe('branch-2/3 disambiguation', () => {
    it('should skip records whose routing resolves to OlManagedCarrier', async () => {
      routing.resolve.mockResolvedValue({
        processorKind: FULFILLMENT_PROCESSOR_KIND.OlManagedCarrier,
        processorConnectionId: 'conn-inpost',
        source: 'rule',
      });
      orderRecords.findMany.mockResolvedValue({
        items: [makeOrderRecord()],
        total: 1,
      });

      const result = await service.sync(PS, { limit: 100 });

      expect(shipments.create).not.toHaveBeenCalled();
      expect(getFulfillmentStatus).not.toHaveBeenCalled();
      expect(result.skipped).toBe(1);
      expect(result.created).toBe(0);
    });

    it('should skip records whose routing resolves to a different OMP connection', async () => {
      routing.resolve.mockResolvedValue({
        processorKind: FULFILLMENT_PROCESSOR_KIND.OmpFulfilled,
        processorConnectionId: 'conn-different-ps',
        source: 'rule',
      });
      orderRecords.findMany.mockResolvedValue({
        items: [makeOrderRecord()],
        total: 1,
      });

      const result = await service.sync(PS, { limit: 100 });

      expect(shipments.create).not.toHaveBeenCalled();
      expect(result.skipped).toBe(1);
    });

    it('should NOT skip records when the rule pins processorConnectionId to this connection', async () => {
      routing.resolve.mockResolvedValue({
        processorKind: FULFILLMENT_PROCESSOR_KIND.OmpFulfilled,
        processorConnectionId: PS,
        source: 'rule',
      });
      orderRecords.findMany.mockResolvedValue({
        items: [makeOrderRecord()],
        total: 1,
      });
      getFulfillmentStatus.mockResolvedValue({
        status: FULFILLMENT_STATUS.Dispatched,
        trackingNumber: null,
        deliveredAt: null,
      });

      const result = await service.sync(PS, { limit: 100 });

      expect(result.created).toBe(1);
    });
  });

  describe('projection-only null skip', () => {
    it('should skip when snapshot.status is null (OMP has not acted)', async () => {
      orderRecords.findMany.mockResolvedValue({
        items: [makeOrderRecord()],
        total: 1,
      });
      getFulfillmentStatus.mockResolvedValue({
        status: null,
        trackingNumber: null,
        deliveredAt: null,
      });

      const result = await service.sync(PS, { limit: 100 });

      expect(shipments.create).not.toHaveBeenCalled();
      expect(shipments.update).not.toHaveBeenCalled();
      expect(result.skipped).toBe(1);
      expect(result.created).toBe(0);
    });
  });

  describe('externalOrderId resolution', () => {
    it('should skip when the record has no synced destination for this connection', async () => {
      orderRecords.findMany.mockResolvedValue({
        items: [
          makeOrderRecord({
            syncedTo: [
              { destinationConnectionId: 'conn-other', externalOrderId: 'other-1' },
            ],
          }),
        ],
        total: 1,
      });

      const result = await service.sync(PS, { limit: 100 });

      expect(getFulfillmentStatus).not.toHaveBeenCalled();
      expect(result.skipped).toBe(1);
    });
  });

  describe('find-or-create + diff-patching', () => {
    it('should patch status when an existing branch-1 row advances', async () => {
      orderRecords.findMany.mockResolvedValue({
        items: [makeOrderRecord()],
        total: 1,
      });
      shipments.findBranchOneByOrderAndConnection.mockResolvedValue(
        makeBranchOneShipment({ status: 'dispatched' }),
      );
      const deliveredAt = new Date('2026-05-28T09:00:00.000Z');
      getFulfillmentStatus.mockResolvedValue({
        status: FULFILLMENT_STATUS.Delivered,
        trackingNumber: null,
        deliveredAt,
      });

      const result = await service.sync(PS, { limit: 100 });

      expect(shipments.update).toHaveBeenCalledTimes(1);
      const [updateId, patch] = shipments.update.mock.calls[0];
      expect(updateId).toBe('ol_shipment_1');
      expect(patch.status).toBe(SHIPMENT_STATUS.Delivered);
      expect(patch.deliveredAt).toEqual(deliveredAt);
      expect(result.updated).toBe(1);
      expect(result.created).toBe(0);
    });

    it('should backfill trackingNumber when present and not already set', async () => {
      orderRecords.findMany.mockResolvedValue({
        items: [makeOrderRecord()],
        total: 1,
      });
      shipments.findBranchOneByOrderAndConnection.mockResolvedValue(
        makeBranchOneShipment({ status: 'dispatched', trackingNumber: null }),
      );
      getFulfillmentStatus.mockResolvedValue({
        status: FULFILLMENT_STATUS.Dispatched,
        trackingNumber: 'PS-TRK-NEW',
        deliveredAt: null,
      });

      await service.sync(PS, { limit: 100 });

      const [, patch] = shipments.update.mock.calls[0];
      expect(patch.trackingNumber).toBe('PS-TRK-NEW');
      expect(patch.status).toBeUndefined();
    });

    it('should no-op (no update) when the snapshot matches the existing row', async () => {
      orderRecords.findMany.mockResolvedValue({
        items: [makeOrderRecord()],
        total: 1,
      });
      shipments.findBranchOneByOrderAndConnection.mockResolvedValue(
        makeBranchOneShipment({ status: 'dispatched', trackingNumber: 'PS-TRK-1' }),
      );
      getFulfillmentStatus.mockResolvedValue({
        status: FULFILLMENT_STATUS.Dispatched,
        trackingNumber: 'PS-TRK-1',
        deliveredAt: null,
      });

      const result = await service.sync(PS, { limit: 100 });

      expect(shipments.update).not.toHaveBeenCalled();
      expect(result.updated).toBe(0);
    });
  });

  describe('error containment', () => {
    it('should count per-record throws as `failed` and continue', async () => {
      orderRecords.findMany.mockResolvedValue({
        items: [
          makeOrderRecord({ internalOrderId: 'ol_order_1' }),
          makeOrderRecord({ internalOrderId: 'ol_order_2' }),
        ],
        total: 2,
      });
      getFulfillmentStatus
        .mockRejectedValueOnce(new Error('PS WS 500'))
        .mockResolvedValueOnce({
          status: FULFILLMENT_STATUS.Dispatched,
          trackingNumber: null,
          deliveredAt: null,
        });

      const result = await service.sync(PS, { limit: 100 });

      expect(result.failed).toBe(1);
      expect(result.created).toBe(1);
    });

    it('should count partial-unique-index conflict on concurrent create as `failed`, not throw', async () => {
      // Two ticks racing on the same order: this tick's `findBranchOneByOrderAndConnection`
      // returns null, but by the time `create` fires, the sibling tick has
      // already inserted the branch-1 row and the partial-unique index
      // `UQ_shipments_branch_one_per_order_conn` rejects this INSERT.
      // The sync service must catch the duplicate-key error, increment
      // `failed`, and NOT propagate the throw out — otherwise the worker
      // handler retries the whole page and the cursor never advances.
      orderRecords.findMany.mockResolvedValue({
        items: [makeOrderRecord()],
        total: 1,
      });
      getFulfillmentStatus.mockResolvedValue({
        status: FULFILLMENT_STATUS.Dispatched,
        trackingNumber: null,
        deliveredAt: null,
      });
      shipments.create.mockRejectedValueOnce(
        new Error(
          'duplicate key value violates unique constraint "UQ_shipments_branch_one_per_order_conn"',
        ),
      );

      const result = await service.sync(PS, { limit: 100 });

      expect(shipments.create).toHaveBeenCalledTimes(1);
      expect(result.failed).toBe(1);
      expect(result.created).toBe(0);
      expect(result.skipped).toBe(0);
    });

    it('should mark the page as `failed` when adapter resolution throws (integration error, not platform-shape limitation)', async () => {
      (integrations.getCapabilityAdapter as jest.Mock).mockRejectedValue(
        new Error('Connection 999 not found'),
      );
      orderRecords.findMany.mockResolvedValue({
        items: [makeOrderRecord(), makeOrderRecord({ internalOrderId: 'ol_order_2' })],
        total: 2,
      });

      const result = await service.sync(PS, { limit: 100 });

      expect(result.failed).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.created).toBe(0);
      expect(shipments.create).not.toHaveBeenCalled();
    });

    it('should return zeroResult when the adapter does not declare FulfillmentStatusReader', async () => {
      // Resolve a bare port without the sub-capability method.
      (integrations.getCapabilityAdapter as jest.Mock).mockResolvedValue({});
      orderRecords.findMany.mockResolvedValue({
        items: [makeOrderRecord()],
        total: 1,
      });

      const result = await service.sync(PS, { limit: 100 });

      expect(shipments.create).not.toHaveBeenCalled();
      expect(result.created).toBe(0);
      expect(result.skipped).toBe(1);
    });
  });

  describe('cursor advancement', () => {
    it('should wrap nextOffset to 0 when the page reaches `total`', async () => {
      orderRecords.findMany.mockResolvedValue({
        items: [makeOrderRecord()],
        total: 1,
      });
      getFulfillmentStatus.mockResolvedValue({
        status: null,
        trackingNumber: null,
        deliveredAt: null,
      });

      const result = await service.sync(PS, { limit: 100, offset: 0 });

      expect(result.nextOffset).toBe(0);
    });

    it('should advance nextOffset by page size when more rows remain', async () => {
      orderRecords.findMany.mockResolvedValue({
        items: [makeOrderRecord()],
        total: 100,
      });
      getFulfillmentStatus.mockResolvedValue({
        status: null,
        trackingNumber: null,
        deliveredAt: null,
      });

      const result = await service.sync(PS, { limit: 1, offset: 5 });

      expect(result.nextOffset).toBe(6);
    });
  });
});

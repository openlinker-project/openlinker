/**
 * Order Ingestion Service Tests
 *
 * Unit tests for OrderIngestionService. Focus on cursor safety, locking, and enqueue behavior.
 *
 * @module libs/core/src/orders/application/services/__tests__
 */

import { OrderIngestionService } from '../order-ingestion.service';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { OrderSourcePort } from '@openlinker/core/orders';
import type {
  ISyncCursorsService,
  SyncJobQueuePort,
  SyncLockPort,
} from '@openlinker/core/sync';
import type { IIdentifierMappingService } from '@openlinker/core/identifier-mapping';
import type {
  ICustomerIdentityResolverService,
  IOrderCustomerProjectionUpdaterService,
} from '@openlinker/core/customers';
import type { IOrderSyncService } from '../../interfaces/order-sync.service.interface';
import type { IOrderRecordService } from '../../interfaces/order-record.service.interface';
import type { IOrderItemRefResolverService } from '../../interfaces/order-item-ref-resolver.service.interface';
import type { IOrderLifecycleRelayService } from '../../interfaces/order-lifecycle-relay.service.interface';
import type { IAutoIssueTriggerService } from '@openlinker/core/invoicing';
import type { IProductsService, ITaxRateJournalService } from '@openlinker/core/products';
import type { IReservationService } from '@openlinker/core/inventory';
import { AmbiguousReservationPositionError } from '@openlinker/core/inventory';
import type { IFulfillmentRoutingService } from '@openlinker/core/mappings';
import type {
  FulfillmentBlockReason,
  IRoutingCommitService,
  RoutingCommitOutcome,
} from '@openlinker/core/fulfillment';
import type { ConnectionPort } from '@openlinker/core/identifier-mapping';
import type { IncomingOrder } from '../../../domain/types/incoming-order.types';
import { MissingOrderItemMappingError } from '../../../domain/exceptions/missing-order-item-mapping.error';
import type { OrderRecord } from '../../../domain/entities/order-record.entity';

// #2396 — the ONE router-resolution seam. Mocked so the `selected` arm is
// reachable in a unit test; on every real installation it answers `null`, which
// is why the production default below is `null` too and every pre-existing spec
// keeps asserting the pass-through.
jest.mock('../fulfillment-router-resolution', () => ({
  resolveFulfillmentRouter: jest.fn().mockResolvedValue(null),
}));
import { resolveFulfillmentRouter } from '../fulfillment-router-resolution';
const resolveRouterMock = resolveFulfillmentRouter as jest.MockedFunction<
  typeof resolveFulfillmentRouter
>;

describe('OrderIngestionService', () => {
  let service: OrderIngestionService;

  let integrationsService: jest.Mocked<IIntegrationsService>;
  // Only the two methods the SUT actually calls — tight Pick<> mock surface
  // per #718 review.
  let syncCursors: jest.Mocked<Pick<ISyncCursorsService, 'getCursor' | 'advanceCursor'>>;
  let jobQueue: jest.Mocked<SyncJobQueuePort>;
  let lock: jest.Mocked<SyncLockPort>;
  let identifierMapping: jest.Mocked<IIdentifierMappingService>;
  let orderSyncService: jest.Mocked<IOrderSyncService>;
  let orderRecordService: jest.Mocked<IOrderRecordService>;
  let orderSource: jest.Mocked<OrderSourcePort>;
  let orderItemRefResolver: jest.Mocked<IOrderItemRefResolverService>;
  let customerIdentityResolver: jest.Mocked<ICustomerIdentityResolverService>;
  let customerProjectionUpdater: jest.Mocked<IOrderCustomerProjectionUpdaterService>;
  let orderLifecycleRelay: jest.Mocked<IOrderLifecycleRelayService>;
  let autoIssueTrigger: jest.Mocked<IAutoIssueTriggerService>;
  let productsService: jest.Mocked<IProductsService>;
  let taxRateJournal: jest.Mocked<ITaxRateJournalService>;
  let reservationService: jest.Mocked<IReservationService>;
  let fulfillmentRouting: jest.Mocked<IFulfillmentRoutingService>;
  // #2396 — the fulfilment intercept's two dependencies. Defaults describe the
  // router-less install every deployment is today: no connection claims A2, so
  // `selectPrimaryFulfillmentRouter` returns `no-claimant` and `route` is never
  // reached. Every pre-existing spec therefore asserts the pass-through.
  let routingCommit: jest.Mocked<IRoutingCommitService>;
  let connections: jest.Mocked<Pick<ConnectionPort, 'list'>>;

  const connectionId = 'connection-123';
  const cursorKey = 'allegro.orders.lastEventId';

  beforeEach(() => {
    orderSource = {
      listOrderFeed: jest.fn(),
      getOrder: jest.fn(),
      updateOfferQuantity: jest.fn(),
    } as unknown as jest.Mocked<OrderSourcePort>;

    integrationsService = {
      getCapabilityAdapter: jest.fn().mockResolvedValue(orderSource),
      getAdapter: jest.fn(),
      listCapabilityAdapters: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;

    syncCursors = {
      getCursor: jest.fn(),
      advanceCursor: jest.fn(),
    };

    jobQueue = {
      enqueue: jest.fn(),
      enqueueBulk: jest.fn(),
    } as unknown as jest.Mocked<SyncJobQueuePort>;

    lock = {
      acquire: jest.fn(),
      release: jest.fn(),
      extend: jest.fn(),
    } as unknown as jest.Mocked<SyncLockPort>;

    identifierMapping = {
      getOrCreateInternalId: jest.fn(),
      getInternalId: jest.fn(),
      getExternalIds: jest.fn(),
      createMapping: jest.fn(),
      batchGetOrCreateInternalIds: jest.fn(),
      deleteMapping: jest.fn(),
    } as unknown as jest.Mocked<IIdentifierMappingService>;

    orderItemRefResolver = {
      resolve: jest.fn(),
      tryResolve: jest.fn(),
    } as unknown as jest.Mocked<IOrderItemRefResolverService>;

    orderSyncService = {
      syncOrder: jest.fn(),
    } as unknown as jest.Mocked<IOrderSyncService>;

    orderRecordService = {
      persistOrder: jest.fn().mockResolvedValue({}),
      persistIncomingSnapshot: jest.fn().mockResolvedValue({}),
      updateSyncStatus: jest.fn().mockResolvedValue(undefined),
      getOrderRecord: jest.fn(),
      findMany: jest.fn(),
      findByIds: jest.fn(),
      markItemResolutionFailure: jest.fn().mockResolvedValue(undefined),
      markCancelled: jest.fn().mockResolvedValue(undefined),
      markSalesDocumentBlock: jest.fn().mockResolvedValue(undefined),
      markFulfillmentBlock: jest.fn().mockResolvedValue(undefined),
      recordAmendment: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<IOrderRecordService>;

    customerIdentityResolver = {
      resolveCustomerIdentity: jest.fn().mockResolvedValue({
        internalCustomerId: 'ol_customer_test',
        usedEmailFallback: false,
        collisionDetected: false,
      }),
    } as unknown as jest.Mocked<ICustomerIdentityResolverService>;

    customerProjectionUpdater = {
      updateProjectionsForOrder: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<IOrderCustomerProjectionUpdaterService>;

    orderLifecycleRelay = {
      relay: jest.fn().mockResolvedValue({ targets: [] }),
    } as unknown as jest.Mocked<IOrderLifecycleRelayService>;
    autoIssueTrigger = {
      onOrderTransition: jest.fn().mockResolvedValue({ kind: 'none' }),
    } as unknown as jest.Mocked<IAutoIssueTriggerService>;
    // #2054: default to "the catalogue has never been asked", the honest
    // post-deploy state - so these specs assert the pre-tax-rate behaviour.
    productsService = {
      getEffectiveTaxRate: jest.fn().mockResolvedValue({
        code: null,
        countryIso2: null,
        readAt: null,
      }),
    } as unknown as jest.Mocked<IProductsService>;
    // #2250: the provenance journal. Default resolves to `null` (a repeat
    // observation), which is what `record` returns when nothing changed.
    taxRateJournal = {
      record: jest.fn().mockResolvedValue(null),
      getLatestPerConnection: jest.fn().mockResolvedValue([]),
    };

    // #2344: the advisory reservation ledger. Defaults grant nothing and skip
    // nothing, so every pre-existing spec asserts the pre-reservation behaviour.
    reservationService = {
      reserveForOrder: jest.fn().mockResolvedValue({ granted: [], skipped: [] }),
    } as unknown as jest.Mocked<IReservationService>;
    // #2344: the default topology is `omp_fulfilled` — the marketplace ships —
    // so a hold is recorded diagnostically and subtracted from nothing.
    fulfillmentRouting = {
      resolve: jest.fn().mockResolvedValue({
        processorKind: 'omp_fulfilled',
        processorConnectionId: null,
        source: 'default',
        processorAvailable: true,
      }),
    } as unknown as jest.Mocked<IFulfillmentRoutingService>;

    routingCommit = {
      route: jest.fn(),
    } as unknown as jest.Mocked<IRoutingCommitService>;
    connections = { list: jest.fn().mockResolvedValue([]) };

    service = new OrderIngestionService(
      integrationsService,
      syncCursors as unknown as ISyncCursorsService,
      jobQueue,
      lock,
      identifierMapping,
      orderItemRefResolver,
      orderSyncService,
      customerIdentityResolver,
      orderRecordService,
      customerProjectionUpdater,
      orderLifecycleRelay,
      autoIssueTrigger,
      productsService,
      taxRateJournal,
      reservationService,
      fulfillmentRouting,
      routingCommit,
      connections as unknown as ConnectionPort
    );
  });

  describe('advisory reservations (#2344)', () => {
    const externalOrderId = 'checkout-res';
    const reservableIncoming = {
      externalOrderId,
      orderNumber: externalOrderId,
      status: 'BOUGHT',
      items: [
        {
          id: 'line-1',
          productRef: { type: 'variant' as const, externalId: 'ext-v1' },
          quantity: 2,
          price: 10,
        },
      ],
      totals: { subtotal: 20, tax: 0, shipping: 0, total: 20, currency: 'PLN' },
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    const ambiguityFor = (orderLineIds: string[]) =>
      new AmbiguousReservationPositionError(
        orderLineIds.map((orderLineId) => ({
          orderLineId,
          productId: 'ol_product_1',
          productVariantId: 'ol_variant_1',
          candidateInventoryItemIds: ['inv-1', 'inv-2'],
        }))
      );

    beforeEach(() => {
      identifierMapping.getOrCreateInternalId.mockResolvedValue('ol_order_res');
      orderSource.getOrder.mockResolvedValue(reservableIncoming);
      integrationsService.getCapabilityAdapter.mockResolvedValue(orderSource);
      orderSyncService.syncOrder.mockResolvedValue([]);
      orderItemRefResolver.tryResolve.mockResolvedValue({
        resolved: true,
        internalProductId: 'ol_product_1',
        internalVariantId: 'ol_variant_1',
      });
    });

    it('should reserve the order lines after persistOrder and before destination dispatch', async () => {
      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(reservationService.reserveForOrder).toHaveBeenCalledTimes(1);
      const input = reservationService.reserveForOrder.mock.calls[0][0];
      expect(input.orderRecordId).toBe('ol_order_res');
      expect(input.lines).toEqual([
        expect.objectContaining({
          orderLineId: 'line-1',
          productId: 'ol_product_1',
          productVariantId: 'ol_variant_1',
          quantity: 2,
        }),
      ]);
      expect(orderRecordService.persistOrder.mock.invocationCallOrder[0]).toBeLessThan(
        reservationService.reserveForOrder.mock.invocationCallOrder[0]
      );
      expect(reservationService.reserveForOrder.mock.invocationCallOrder[0]).toBeLessThan(
        orderSyncService.syncOrder.mock.invocationCallOrder[0]
      );
    });

    it('should stamp diagnostic on the omp_fulfilled topology', async () => {
      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(reservationService.reserveForOrder.mock.calls[0][0].atpEffect).toBe('diagnostic');
    });

    it('should stamp published when OL executes fulfillment', async () => {
      fulfillmentRouting.resolve.mockResolvedValue({
        processorKind: 'ol_managed_carrier',
        processorConnectionId: 'carrier-1',
        source: 'rule',
        processorAvailable: true,
      });

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(reservationService.reserveForOrder.mock.calls[0][0].atpEffect).toBe('published');
    });

    it('should stamp diagnostic when the resolved processor is unavailable', async () => {
      // `published` asserts OL executes this order; claiming that over a route
      // OL cannot drive would be false, and the stamp is insert-only.
      fulfillmentRouting.resolve.mockResolvedValue({
        processorKind: 'ol_managed_carrier',
        processorConnectionId: 'carrier-1',
        source: 'rule',
        processorAvailable: false,
      });

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(reservationService.reserveForOrder.mock.calls[0][0].atpEffect).toBe('diagnostic');
    });

    it('should stamp diagnostic — never published — when routing cannot be resolved', async () => {
      fulfillmentRouting.resolve.mockRejectedValue(new Error('routing store unreachable'));

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(reservationService.reserveForOrder.mock.calls[0][0].atpEffect).toBe('diagnostic');
    });

    it('should not fail ingestion when the reservation throws', async () => {
      // An advisory hold must never cost a paid order.
      reservationService.reserveForOrder.mockRejectedValue(
        new Error('insufficient available-to-promise')
      );

      const results = await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(results).toEqual([]);
      expect(orderSyncService.syncOrder).toHaveBeenCalledTimes(1);
    });

    it('should skip the retry entirely when every line was ambiguous', async () => {
      // One line, and it is the ambiguous one — so there is nothing left to
      // claim and no empty second call is issued.
      reservationService.reserveForOrder.mockRejectedValueOnce(
        ambiguityFor(['line-1'])
      );

      const results = await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(results).toEqual([]);
      expect(reservationService.reserveForOrder).toHaveBeenCalledTimes(1);
    });

    it('should retry once with only the unambiguous lines rather than losing the order\'s holds', async () => {
      orderSource.getOrder.mockResolvedValue({
        ...reservableIncoming,
        items: [
          reservableIncoming.items[0],
          { ...reservableIncoming.items[0], id: 'line-2' },
        ],
      });
      reservationService.reserveForOrder
        .mockRejectedValueOnce(ambiguityFor(['line-1']))
        .mockResolvedValue({ granted: [], skipped: [] });

      const results = await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(results).toEqual([]);
      expect(reservationService.reserveForOrder).toHaveBeenCalledTimes(2);
      expect(reservationService.reserveForOrder.mock.calls[1][0].lines).toEqual([
        expect.objectContaining({ orderLineId: 'line-2' }),
      ]);
    });

    it('should not fail ingestion when the retry itself throws', async () => {
      // The retry is single-pass by construction: a second refusal falls into
      // the outer catch rather than looping.
      orderSource.getOrder.mockResolvedValue({
        ...reservableIncoming,
        items: [
          reservableIncoming.items[0],
          { ...reservableIncoming.items[0], id: 'line-2' },
        ],
      });
      reservationService.reserveForOrder
        .mockRejectedValueOnce(ambiguityFor(['line-1']))
        .mockRejectedValueOnce(new Error('insufficient available-to-promise'));

      const results = await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(results).toEqual([]);
      expect(reservationService.reserveForOrder).toHaveBeenCalledTimes(2);
      expect(orderSyncService.syncOrder).toHaveBeenCalledTimes(1);
    });

    it('should record no hold when the kill switch is off', async () => {
      const previous = process.env.OL_RESERVATIONS_ENABLED;
      process.env.OL_RESERVATIONS_ENABLED = 'false';
      try {
        const results = await service.syncOrderFromSource(connectionId, externalOrderId);

        expect(results).toEqual([]);
        expect(reservationService.reserveForOrder).not.toHaveBeenCalled();
        // Ingestion is otherwise byte-identical to its pre-#2344 behaviour.
        expect(orderSyncService.syncOrder).toHaveBeenCalledTimes(1);
      } finally {
        if (previous === undefined) delete process.env.OL_RESERVATIONS_ENABLED;
        else process.env.OL_RESERVATIONS_ENABLED = previous;
      }
    });

    it('should not reserve for an order that arrived already cancelled', async () => {
      orderSource.getOrder.mockResolvedValue({
        ...reservableIncoming,
        status: 'cancelled',
      });

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(reservationService.reserveForOrder).not.toHaveBeenCalled();
    });
  });

  describe('auto-issue trigger (OL #1120)', () => {
    const externalOrderId = 'checkout-1';
    const baseIncoming = {
      externalOrderId,
      orderNumber: externalOrderId,
      status: 'BOUGHT',
      items: [],
      totals: { subtotal: 0, tax: 0, shipping: 0, total: 0, currency: 'PLN' },
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    beforeEach(() => {
      identifierMapping.getOrCreateInternalId.mockResolvedValue('ol_order_test');
      orderSource.getOrder.mockResolvedValue(baseIncoming);
      integrationsService.getCapabilityAdapter.mockResolvedValue(orderSource);
    });

    it('calls onOrderTransition at the terminal path with the in-scope sourceEventId as the 3rd arg', async () => {
      orderSyncService.syncOrder.mockResolvedValue([]);

      await service.syncOrderFromSource(connectionId, externalOrderId, 'evt-42');

      expect(autoIssueTrigger.onOrderTransition).toHaveBeenCalledTimes(1);
      const [order, srcConn, evt] = autoIssueTrigger.onOrderTransition.mock.calls[0];
      expect(order).toEqual(expect.objectContaining({ id: 'ol_order_test' }));
      expect(srcConn).toBe(connectionId);
      expect(evt).toBe('evt-42');
      // Fires only after destination status is settled.
      expect(orderSyncService.syncOrder.mock.invocationCallOrder[0]).toBeLessThan(
        autoIssueTrigger.onOrderTransition.mock.invocationCallOrder[0]
      );
    });

    it('swallows a thrown onOrderTransition failure — order sync still returns results — with a PII-safe log', async () => {
      const warnSpy = jest
        .spyOn((service as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn')
        .mockImplementation(() => undefined);
      orderSyncService.syncOrder.mockResolvedValue([]);
      autoIssueTrigger.onOrderTransition.mockRejectedValueOnce(
        new Error('issuance exploded for buyer Jan Kowalski')
      );

      const results = await service.syncOrderFromSource(connectionId, externalOrderId, 'evt-7');

      expect(results).toEqual([]);
      const logged = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(logged).not.toContain('Jan Kowalski');
      expect(logged).not.toContain('correlationId');
      expect(logged).toContain('evt-7');
      warnSpy.mockRestore();
    });

    it('a destination-echo re-read returns [] and does NOT call onOrderTransition', async () => {
      orderRecordService.getOrderRecord.mockResolvedValueOnce({
        sourceConnectionId: 'other-connection',
      } as never);

      const results = await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(results).toEqual([]);
      expect(autoIssueTrigger.onOrderTransition).not.toHaveBeenCalled();
    });

    // #2100 (ADR-041 decision 11): the trigger REPORTS a block, this service WRITES
    // it. That split is what keeps the trigger's one-way edge (F3) intact.
    const block = {
      reason: 'unresolved-routing',
      unresolvedReason: 'ambiguous-connection-no-primary',
      detail: '2 invoicing connections, none marked primary',
    } as const;

    it('persists the block the trigger reported', async () => {
      orderSyncService.syncOrder.mockResolvedValue([]);
      autoIssueTrigger.onOrderTransition.mockResolvedValueOnce({ kind: 'blocked', block });

      await service.syncOrderFromSource(connectionId, externalOrderId, 'evt-9');

      expect(orderRecordService.markSalesDocumentBlock).toHaveBeenCalledWith(
        'ol_order_test',
        block,
      );
    });

    it('writes null through on `none` — the level-triggered clear', async () => {
      orderSyncService.syncOrder.mockResolvedValue([]);
      autoIssueTrigger.onOrderTransition.mockResolvedValueOnce({ kind: 'none' });

      await service.syncOrderFromSource(connectionId, externalOrderId, 'evt-10');

      // Skipping this write would make a once-persisted badge permanent. The
      // no-op case is suppressed in the repository's WHERE clause, not here —
      // a caller-side comparison would have to trust a record read before the
      // destination round-trip, and a concurrent clear could make a genuinely
      // new answer look unchanged.
      expect(orderRecordService.markSalesDocumentBlock).toHaveBeenCalledWith('ol_order_test', null);
    });

    it('writes NOTHING on `indeterminate` — the gate could not tell, so the reason stands', async () => {
      orderSyncService.syncOrder.mockResolvedValue([]);
      autoIssueTrigger.onOrderTransition.mockResolvedValueOnce({ kind: 'indeterminate' });

      await service.syncOrderFromSource(connectionId, externalOrderId, 'evt-13');

      // Erasing a true reason and replacing it with nothing is the silent decline
      // ADR-041 §54 forbids — worse than leaving a possibly-stale one.
      expect(orderRecordService.markSalesDocumentBlock).not.toHaveBeenCalled();
    });

    it('swallows a failed block write with its OWN message — the order pipeline still succeeds', async () => {
      const warnSpy = jest
        .spyOn((service as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn')
        .mockImplementation(() => undefined);
      orderSyncService.syncOrder.mockResolvedValue([]);
      autoIssueTrigger.onOrderTransition.mockResolvedValueOnce({
        kind: 'blocked',
        block: { reason: 'trigger-model-manual' },
      });
      orderRecordService.markSalesDocumentBlock.mockRejectedValueOnce(new Error('db down'));

      const results = await service.syncOrderFromSource(connectionId, externalOrderId, 'evt-11');

      // A lost write self-heals on the next transition; a thrown one would not.
      expect(results).toEqual([]);
      const logged = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
      // A persistence failure is not a trigger failure — reporting it as one would
      // send the next reader to the wrong service.
      expect(logged).toContain('Failed to persist the sales-document block outcome');
      expect(logged).not.toContain('Auto-issue trigger failed');
      warnSpy.mockRestore();
    });
  });

  describe('syncFromMarketplace', () => {
    it('skips when lock cannot be acquired', async () => {
      lock.acquire.mockResolvedValueOnce(null);

      const result = await service.ingestOrders(connectionId, { cursorKey, limit: 10 });

      expect(result.skippedDueToLock).toBe(true);
      expect(syncCursors.getCursor).not.toHaveBeenCalled();
      expect(jobQueue.enqueueBulk).not.toHaveBeenCalled();
      expect(syncCursors.advanceCursor).not.toHaveBeenCalled();
    });

    it('commits cursor only after enqueueBulk succeeds', async () => {
      lock.acquire.mockResolvedValueOnce('token-1');
      lock.release.mockResolvedValueOnce(true);

      syncCursors.getCursor.mockResolvedValueOnce('event-100');
      orderSource.listOrderFeed.mockResolvedValueOnce({
        items: [
          {
            externalOrderId: 'checkout-1',
            eventType: 'updated',
            occurredAt: '2024-01-01T00:00:00Z',
            eventKey: 'event-101',
          },
        ],
        nextCursor: 'event-101',
      });

      jobQueue.enqueueBulk.mockResolvedValueOnce([]);

      const result = await service.ingestOrders(connectionId, { cursorKey, limit: 10 });

      expect(result.committed).toBe(true);
      expect(syncCursors.advanceCursor).toHaveBeenCalledWith(connectionId, cursorKey, 'event-101');
      expect(jobQueue.enqueueBulk).toHaveBeenCalledWith([
        expect.objectContaining({
          type: 'marketplace.order.sync',
          connectionId,
          payload: expect.objectContaining({
            externalOrderId: 'checkout-1',
            eventKey: 'event-101',
          }),
          options: { dedupeKey: `marketplace:${connectionId}:order:event-101` },
        }),
      ]);
    });

    it('does not commit cursor when enqueueBulk fails', async () => {
      lock.acquire.mockResolvedValueOnce('token-1');
      lock.release.mockResolvedValueOnce(true);

      syncCursors.getCursor.mockResolvedValueOnce('event-100');
      orderSource.listOrderFeed.mockResolvedValueOnce({
        items: [
          {
            externalOrderId: 'checkout-1',
            eventType: 'updated',
            occurredAt: '2024-01-01T00:00:00Z',
            eventKey: 'event-101',
          },
        ],
        nextCursor: 'event-101',
      });

      jobQueue.enqueueBulk.mockRejectedValueOnce(new Error('enqueue failed'));

      await expect(service.ingestOrders(connectionId, { cursorKey, limit: 10 })).rejects.toThrow(
        'enqueue failed'
      );

      expect(syncCursors.advanceCursor).not.toHaveBeenCalled();
    });

    it('does not commit cursor when adapter returns a regressing cursor', async () => {
      lock.acquire.mockResolvedValueOnce('token-1');
      lock.release.mockResolvedValueOnce(true);

      syncCursors.getCursor.mockResolvedValueOnce('200');
      orderSource.listOrderFeed.mockResolvedValueOnce({
        items: [
          {
            externalOrderId: 'checkout-1',
            eventType: 'updated',
            occurredAt: '2024-01-01T00:00:00Z',
            eventKey: '201',
          },
        ],
        nextCursor: '100',
      });

      jobQueue.enqueueBulk.mockResolvedValueOnce([]);

      const result = await service.ingestOrders(connectionId, { cursorKey, limit: 10 });

      expect(result.committed).toBe(false);
      expect(syncCursors.advanceCursor).not.toHaveBeenCalled();
    });

    const feedWithCursor = (nextCursor: string) => ({
      items: [
        {
          externalOrderId: 'order-1',
          eventType: 'updated' as const,
          occurredAt: '2026-01-15T10:30:00Z',
          eventKey: 'event-1',
        },
      ],
      nextCursor,
    });

    const ingestWithCursors = async (fromCursor: string, nextCursor: string) => {
      lock.acquire.mockResolvedValueOnce('token-1');
      lock.release.mockResolvedValueOnce(true);
      syncCursors.getCursor.mockResolvedValueOnce(fromCursor);
      orderSource.listOrderFeed.mockResolvedValueOnce(feedWithCursor(nextCursor));
      jobQueue.enqueueBulk.mockResolvedValueOnce([]);
      return service.ingestOrders(connectionId, { cursorKey, limit: 10 });
    };

    it('does not commit when a timestamp watermark cursor moves backwards', async () => {
      const result = await ingestWithCursors('2026-01-15T10:30:00Z', '2026-01-15T09:30:00Z');

      expect(result.committed).toBe(false);
      expect(syncCursors.advanceCursor).not.toHaveBeenCalled();
    });

    it('commits when a timestamp watermark cursor moves forward', async () => {
      const result = await ingestWithCursors('2026-01-15T09:30:00Z', '2026-01-15T10:30:00Z');

      expect(result.committed).toBe(true);
      expect(syncCursors.advanceCursor).toHaveBeenCalledWith(
        connectionId,
        cursorKey,
        '2026-01-15T10:30:00Z'
      );
    });

    it('commits when a naive wall-clock watermark cursor moves forward', async () => {
      const result = await ingestWithCursors('2026-01-15 09:30:00', '2026-01-15 10:30:00');

      expect(result.committed).toBe(true);
      expect(syncCursors.advanceCursor).toHaveBeenCalledWith(
        connectionId,
        cursorKey,
        '2026-01-15 10:30:00'
      );
    });

    it('commits an opaque cursor core cannot order rather than wedging ingestion', async () => {
      // A base64 event id that sorts backwards as text. Blocking here would halt
      // this connection permanently on a legitimate forward move.
      const result = await ingestWithCursors('ZXZlbnQtMjAw', 'ZXZlbnQtMTAw');

      expect(result.committed).toBe(true);
      expect(syncCursors.advanceCursor).toHaveBeenCalledWith(
        connectionId,
        cursorKey,
        'ZXZlbnQtMTAw'
      );
    });

    it('commits a shorter numeric cursor that is lexicographically larger', async () => {
      const result = await ingestWithCursors('99', '100');

      expect(result.committed).toBe(true);
      expect(syncCursors.advanceCursor).toHaveBeenCalledWith(connectionId, cursorKey, '100');
    });

    it('warns once per connection and cursor key about an unorderable cursor shape', async () => {
      const warn = jest.spyOn(service['logger'], 'warn');

      await ingestWithCursors('ZXZlbnQtMjAw', 'ZXZlbnQtMTAw');
      await ingestWithCursors('ZXZlbnQtMTAw', 'ZXZlbnQtMzAw');

      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });
  });

  describe('syncOrderFromMarketplace – order record persistence', () => {
    const externalOrderId = 'checkout-1';

    const baseIncoming = {
      externalOrderId,
      orderNumber: externalOrderId,
      status: 'BOUGHT',
      items: [],
      totals: { subtotal: 0, tax: 0, shipping: 0, total: 0, currency: 'PLN' },
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    beforeEach(() => {
      identifierMapping.getOrCreateInternalId.mockResolvedValue('ol_order_test');
      orderSource.getOrder.mockResolvedValue(baseIncoming);
      integrationsService.getCapabilityAdapter.mockResolvedValue(orderSource);
    });

    it('should call persistIncomingSnapshot before item resolution, then persistOrder before syncOrder', async () => {
      orderSyncService.syncOrder.mockResolvedValue([]);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(orderRecordService.persistIncomingSnapshot).toHaveBeenCalledWith(
        baseIncoming,
        'ol_order_test',
        null,
        connectionId,
        null
      );
      expect(orderRecordService.persistOrder).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'ol_order_test' }),
        connectionId,
        null,
        // sourceExternalUrl (#1713) — the test fixture's incoming order carries none.
        null
      );
      expect(orderRecordService.persistIncomingSnapshot.mock.invocationCallOrder[0]).toBeLessThan(
        orderRecordService.persistOrder.mock.invocationCallOrder[0]
      );
      expect(orderRecordService.persistOrder.mock.invocationCallOrder[0]).toBeLessThan(
        orderSyncService.syncOrder.mock.invocationCallOrder[0]
      );
    });

    it('should carry incoming.placedAt onto the unified Order as a Date (#926)', async () => {
      orderSource.getOrder.mockResolvedValueOnce({
        ...baseIncoming,
        placedAt: '2026-05-31T16:00:00.000Z',
      });
      orderSyncService.syncOrder.mockResolvedValue([]);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      const order = orderRecordService.persistOrder.mock.calls[0][0];
      expect(order.placedAt).toEqual(new Date('2026-05-31T16:00:00.000Z'));
    });

    it('should leave Order.placedAt undefined when the incoming order omits it (#926)', async () => {
      // baseIncoming carries no placedAt.
      orderSyncService.syncOrder.mockResolvedValue([]);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      const order = orderRecordService.persistOrder.mock.calls[0][0];
      expect(order.placedAt).toBeUndefined();
    });

    it('should carry incoming.customerEmail onto the unified Order (#948)', async () => {
      orderSource.getOrder.mockResolvedValueOnce({
        ...baseIncoming,
        customerEmail: 'buyer@example.com',
      });
      orderSyncService.syncOrder.mockResolvedValue([]);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      const order = orderRecordService.persistOrder.mock.calls[0][0];
      expect(order.customerEmail).toBe('buyer@example.com');
    });

    it('should leave Order.customerEmail undefined when the incoming order omits it (#948)', async () => {
      // baseIncoming carries no customerEmail.
      orderSyncService.syncOrder.mockResolvedValue([]);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      const order = orderRecordService.persistOrder.mock.calls[0][0];
      expect(order.customerEmail).toBeUndefined();
    });

    it('should carry incoming.shipping and pickupPoint onto the unified Order (#952)', async () => {
      orderSource.getOrder.mockResolvedValueOnce({
        ...baseIncoming,
        shipping: { methodId: 'allegro-courier-1', methodName: 'Kurier DPD' },
        pickupPoint: { id: 'POZ08A', name: 'Paczkomat POZ08A' },
      });
      orderSyncService.syncOrder.mockResolvedValue([]);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      const order = orderRecordService.persistOrder.mock.calls[0][0];
      expect(order.shipping).toEqual({ methodId: 'allegro-courier-1', methodName: 'Kurier DPD' });
      expect(order.pickupPoint).toEqual({ id: 'POZ08A', name: 'Paczkomat POZ08A' });
    });

    it('should call updateSyncStatus with synced when syncOrder succeeds', async () => {
      orderSyncService.syncOrder.mockResolvedValue([
        {
          status: 'success',
          destinationConnectionId: 'dest-conn-1',
          orderRef: { orderId: 'ext-order-1', orderNumber: 'ORD-001' },
        },
      ]);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(orderRecordService.updateSyncStatus).toHaveBeenCalledWith(
        'ol_order_test',
        'dest-conn-1',
        expect.objectContaining({ status: 'synced', externalOrderId: 'ext-order-1' })
      );
    });

    // #2397 — the consumer half of "a deliberate empty routing decision returns
    // []". `OrderSyncService` refuses to throw for that case precisely so this
    // is a no-op; asserted HERE, at the caller, because the claim is about what
    // ingestion does with an empty array, not about what the service returns.
    it('should write no sync-status row when the routing decision named no destination', async () => {
      orderSyncService.syncOrder.mockResolvedValue([]);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(orderRecordService.updateSyncStatus).not.toHaveBeenCalled();
    });

    it('should still run the downstream sales-document gate on an empty routing decision', async () => {
      // The empty array must be a no-op for sync status WITHOUT short-circuiting
      // the rest of ingestion — an order that was routed nowhere is still an
      // order, and its document gate must still decide.
      orderSyncService.syncOrder.mockResolvedValue([]);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(autoIssueTrigger.onOrderTransition).toHaveBeenCalledTimes(1);
    });

    it('should call updateSyncStatus with failed when syncOrder returns a failure result', async () => {
      orderSyncService.syncOrder.mockResolvedValue([
        {
          status: 'failed',
          destinationConnectionId: 'dest-conn-1',
          error: { message: 'destination unavailable' },
        },
      ]);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(orderRecordService.updateSyncStatus).toHaveBeenCalledWith(
        'ol_order_test',
        'dest-conn-1',
        expect.objectContaining({ status: 'failed', error: 'destination unavailable' })
      );
    });

    it('should call updateSyncStatus with skipped_cancelled when the order was cancelled at source', async () => {
      orderSyncService.syncOrder.mockResolvedValue([
        {
          status: 'skipped_cancelled',
          destinationConnectionId: 'dest-conn-1',
          cancelledAt: new Date('2026-08-01T10:00:00.000Z'),
        },
      ]);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(orderRecordService.updateSyncStatus).toHaveBeenCalledWith(
        'ol_order_test',
        'dest-conn-1',
        expect.objectContaining({
          status: 'skipped_cancelled',
          error: 'Order cancelled at source before destination create',
        })
      );
    });

    // #2588 review I-1. The withheld row is written by DROP-then-append
    // (`OrderRecordRepository.updateSyncStatus`), so writing it over an
    // already-provisioned destination destroys that destination's
    // `externalOrderId` / `externalOrderNumber` — the shop's own order number,
    // which is exactly what the operator needs while the hold is on.
    describe('a withheld destination that is already synced (#2588 I-1)', () => {
      const heldResult = {
        status: 'skipped_held' as const,
        destinationConnectionId: 'dest-conn-1',
        holdId: 'hold-1',
        holdReason: 'fraud-review' as const,
      };

      it('does NOT overwrite the row of a destination already synced', async () => {
        orderRecordService.getOrderRecord.mockResolvedValue({
          sourceConnectionId: connectionId,
          syncStatus: [
            {
              destinationConnectionId: 'dest-conn-1',
              status: 'synced',
              externalOrderId: '12345',
              externalOrderNumber: 'PS-9981',
            },
          ],
        } as unknown as OrderRecord);
        orderSyncService.syncOrder.mockResolvedValue([heldResult]);

        await service.syncOrderFromSource(connectionId, externalOrderId);

        expect(orderRecordService.updateSyncStatus).not.toHaveBeenCalled();
      });

      it('still writes the withheld row on a FIRST ingestion, where nothing is provisioned yet', async () => {
        orderRecordService.getOrderRecord.mockResolvedValue(null);
        orderSyncService.syncOrder.mockResolvedValue([heldResult]);

        await service.syncOrderFromSource(connectionId, externalOrderId);

        expect(orderRecordService.updateSyncStatus).toHaveBeenCalledWith(
          'ol_order_test',
          'dest-conn-1',
          expect.objectContaining({
            status: 'pending',
            error: 'Withheld: order is on hold (fraud-review)',
          })
        );
      });

      it('still writes the withheld row for a destination whose existing row is not synced', async () => {
        orderRecordService.getOrderRecord.mockResolvedValue({
          sourceConnectionId: connectionId,
          syncStatus: [
            { destinationConnectionId: 'dest-conn-1', status: 'failed', error: 'boom' },
          ],
        } as unknown as OrderRecord);
        orderSyncService.syncOrder.mockResolvedValue([heldResult]);

        await service.syncOrderFromSource(connectionId, externalOrderId);

        expect(orderRecordService.updateSyncStatus).toHaveBeenCalledWith(
          'ol_order_test',
          'dest-conn-1',
          expect.objectContaining({ status: 'pending' })
        );
      });
    });

    it('should persist snapshot and order even when syncOrder throws', async () => {
      orderSyncService.syncOrder.mockRejectedValue(new Error('no destinations'));

      await expect(service.syncOrderFromSource(connectionId, externalOrderId)).rejects.toThrow(
        'no destinations'
      );

      expect(orderRecordService.persistIncomingSnapshot).toHaveBeenCalled();
      expect(orderRecordService.persistOrder).toHaveBeenCalled();
      expect(orderRecordService.updateSyncStatus).not.toHaveBeenCalled();
    });

    it('should log warning and continue when updateSyncStatus rejects for one destination', async () => {
      const warnSpy = jest.spyOn(service['logger'], 'warn');
      orderSyncService.syncOrder.mockResolvedValue([
        {
          status: 'success',
          destinationConnectionId: 'dest-conn-1',
          orderRef: { orderId: 'ext-order-1' },
        },
        {
          status: 'success',
          destinationConnectionId: 'dest-conn-2',
          orderRef: { orderId: 'ext-order-2' },
        },
      ]);
      orderRecordService.updateSyncStatus
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('db write failed'));

      await expect(
        service.syncOrderFromSource(connectionId, externalOrderId)
      ).resolves.not.toThrow();

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to update order record sync status',
        expect.any(Error)
      );
    });

    it('should call customerProjectionUpdater after persistOrder and before syncOrder when internalCustomerId is resolved', async () => {
      orderSyncService.syncOrder.mockResolvedValue([]);
      orderSource.getOrder.mockResolvedValueOnce({
        ...baseIncoming,
        customerExternalId: 'buyer-ext-1',
        customerEmail: 'buyer@example.com',
      });
      identifierMapping.getOrCreateInternalId.mockResolvedValue('ol_order_test');

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(customerProjectionUpdater.updateProjectionsForOrder).toHaveBeenCalledTimes(1);
      expect(customerProjectionUpdater.updateProjectionsForOrder).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'ol_order_test' }),
        'ol_customer_test',
        connectionId
      );
      // Order: persistOrder → updateProjectionsForOrder → syncOrder
      expect(orderRecordService.persistOrder.mock.invocationCallOrder[0]).toBeLessThan(
        customerProjectionUpdater.updateProjectionsForOrder.mock.invocationCallOrder[0]
      );
      expect(
        customerProjectionUpdater.updateProjectionsForOrder.mock.invocationCallOrder[0]
      ).toBeLessThan(orderSyncService.syncOrder.mock.invocationCallOrder[0]);
    });

    it('should swallow errors from customerProjectionUpdater and still call syncOrder', async () => {
      const warnSpy = jest.spyOn(service['logger'], 'warn');
      orderSyncService.syncOrder.mockResolvedValue([]);
      orderSource.getOrder.mockResolvedValueOnce({
        ...baseIncoming,
        customerExternalId: 'buyer-ext-1',
        customerEmail: 'buyer@example.com',
      });
      customerProjectionUpdater.updateProjectionsForOrder.mockRejectedValueOnce(
        new Error('projection write failed')
      );

      await expect(
        service.syncOrderFromSource(connectionId, externalOrderId)
      ).resolves.not.toThrow();

      expect(orderSyncService.syncOrder).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to update customer projections'),
        expect.any(Error)
      );
    });

    it('should skip customerProjectionUpdater when internalCustomerId is not resolved', async () => {
      orderSyncService.syncOrder.mockResolvedValue([]);
      orderSource.getOrder.mockResolvedValueOnce(baseIncoming); // no buyer info → no resolution call

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(customerProjectionUpdater.updateProjectionsForOrder).not.toHaveBeenCalled();
      expect(orderSyncService.syncOrder).toHaveBeenCalled();
    });
  });

  describe('syncOrderFromSource – destination-echo guard (#940)', () => {
    const externalOrderId = 'ps-order-7';

    const baseIncoming = {
      externalOrderId,
      orderNumber: externalOrderId,
      status: 'BOUGHT',
      items: [],
      totals: { subtotal: 0, tax: 0, shipping: 0, total: 0, currency: 'PLN' },
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    beforeEach(() => {
      identifierMapping.getOrCreateInternalId.mockResolvedValue('ol_order_echo');
      orderSource.getOrder.mockResolvedValue(baseIncoming);
      integrationsService.getCapabilityAdapter.mockResolvedValue(orderSource);
    });

    it('should skip re-ingestion and return [] when the resolved order originated from a different connection', async () => {
      orderRecordService.getOrderRecord.mockResolvedValue({
        sourceConnectionId: 'allegro-connection',
      } as unknown as OrderRecord);

      const result = await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(result).toEqual([]);
      // Source attribution, snapshot and sync history must be left untouched.
      expect(orderRecordService.persistIncomingSnapshot).not.toHaveBeenCalled();
      expect(orderRecordService.persistOrder).not.toHaveBeenCalled();
      expect(orderSyncService.syncOrder).not.toHaveBeenCalled();
      expect(orderItemRefResolver.tryResolve).not.toHaveBeenCalled();
    });

    it('should proceed with ingestion when no existing order record is found (genuinely new order)', async () => {
      orderRecordService.getOrderRecord.mockResolvedValue(null);
      orderSyncService.syncOrder.mockResolvedValue([]);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(orderRecordService.persistIncomingSnapshot).toHaveBeenCalled();
      expect(orderRecordService.persistOrder).toHaveBeenCalled();
      expect(orderSyncService.syncOrder).toHaveBeenCalled();
    });

    it('should proceed with ingestion when the existing order shares the same source connection (genuine same-source reconcile)', async () => {
      orderRecordService.getOrderRecord.mockResolvedValue({
        sourceConnectionId: connectionId,
      } as unknown as OrderRecord);
      orderSyncService.syncOrder.mockResolvedValue([]);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(orderRecordService.persistIncomingSnapshot).toHaveBeenCalled();
      expect(orderRecordService.persistOrder).toHaveBeenCalled();
      expect(orderSyncService.syncOrder).toHaveBeenCalled();
    });
  });

  describe('syncOrderFromSource – cancellation-observe hook (#1146)', () => {
    const externalOrderId = 'checkout-cancel';
    const internalOrderId = 'ol_order_cancel';
    const dedupeKey = `marketplace:${connectionId}:stockRestore:${internalOrderId}`;

    const cancelledIncoming = {
      externalOrderId,
      orderNumber: externalOrderId,
      status: 'cancelled',
      items: [],
      totals: { subtotal: 0, tax: 0, shipping: 0, total: 0, currency: 'PLN' },
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
    };

    beforeEach(() => {
      identifierMapping.getOrCreateInternalId.mockResolvedValue(internalOrderId);
      integrationsService.getCapabilityAdapter.mockResolvedValue(orderSource);
      orderSyncService.syncOrder.mockResolvedValue([]);
    });

    it('should enqueue a stockRestore job when an order transitions to cancelled', async () => {
      orderSource.getOrder.mockResolvedValue(cancelledIncoming);
      // Prior record has a non-cancelled status → transition fires.
      orderRecordService.getOrderRecord.mockResolvedValue({
        sourceConnectionId: connectionId,
        orderSnapshot: { status: 'BOUGHT' },
      } as unknown as OrderRecord);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      // Both the early-fire hook (before item resolution) and the post-persistOrder
      // hook fire — both carry the same dedupeKey, so the job queue deduplicates
      // them to a single job in production.
      expect(jobQueue.enqueue).toHaveBeenCalledTimes(2);
      expect(jobQueue.enqueue).toHaveBeenCalledWith({
        type: 'marketplace.offer.stockRestore',
        connectionId,
        payload: { schemaVersion: 1, internalOrderId },
        options: { dedupeKey },
      });
    });

    it('should enqueue when a first-seen order is already cancelled (no prior record)', async () => {
      orderSource.getOrder.mockResolvedValue(cancelledIncoming);
      orderRecordService.getOrderRecord.mockResolvedValue(null);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      // Early-fire + post-persistOrder, same dedupeKey → one actual job in production.
      expect(jobQueue.enqueue).toHaveBeenCalledTimes(2);
      expect(jobQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'marketplace.offer.stockRestore' })
      );
    });

    it('should NOT enqueue on a re-poll of an already-cancelled order', async () => {
      orderSource.getOrder.mockResolvedValue(cancelledIncoming);
      orderRecordService.getOrderRecord.mockResolvedValue({
        sourceConnectionId: connectionId,
        orderSnapshot: { status: 'cancelled' },
      } as unknown as OrderRecord);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(jobQueue.enqueue).not.toHaveBeenCalled();
    });

    it('should NOT enqueue when the order status is not cancelled', async () => {
      orderSource.getOrder.mockResolvedValue({ ...cancelledIncoming, status: 'BOUGHT' });
      orderRecordService.getOrderRecord.mockResolvedValue(null);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(jobQueue.enqueue).not.toHaveBeenCalled();
    });

    it('should not fail order sync when the stockRestore enqueue fails (loss is logged, not thrown)', async () => {
      orderSource.getOrder.mockResolvedValue(cancelledIncoming);
      orderRecordService.getOrderRecord.mockResolvedValue({
        sourceConnectionId: connectionId,
        orderSnapshot: { status: 'BOUGHT' },
      } as unknown as OrderRecord);
      // The early-fire enqueue attempt fails; the second (post-persistOrder) succeeds.
      jobQueue.enqueue.mockRejectedValueOnce(new Error('redis down'));

      await expect(
        service.syncOrderFromSource(connectionId, externalOrderId)
      ).resolves.not.toThrow();

      // 2 calls: early-fire (fails, swallowed) + post-persistOrder (succeeds).
      expect(jobQueue.enqueue).toHaveBeenCalledTimes(2);
      // Order is still persisted regardless of the early-fire failure.
      expect(orderRecordService.persistOrder).toHaveBeenCalled();
    });

    it('should NOT enqueue on a destination-echo order (cross-origin early-return)', async () => {
      orderSource.getOrder.mockResolvedValue(cancelledIncoming);
      // Existing record originated from a DIFFERENT connection → early-return.
      orderRecordService.getOrderRecord.mockResolvedValue({
        sourceConnectionId: 'other-connection',
        orderSnapshot: { status: 'BOUGHT' },
      } as unknown as OrderRecord);

      const result = await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(result).toEqual([]);
      expect(jobQueue.enqueue).not.toHaveBeenCalled();
      expect(orderRecordService.persistOrder).not.toHaveBeenCalled();
    });

    it('should enqueue stockRestore even when item resolution fails (early-fire, #1146)', async () => {
      // Cancelled order with an unresolvable item — MissingOrderItemMappingError is
      // thrown at Step 4 before persistOrder can run, which would have preempted the
      // original post-persistOrder hook. The early-fire hook must still enqueue.
      const cancelledWithItems = {
        ...cancelledIncoming,
        items: [
          {
            id: 'item-x',
            productRef: { type: 'offer' as const, externalId: 'unmapped-offer' },
            quantity: 1,
            price: 9.99,
          },
        ],
      };
      orderSource.getOrder.mockResolvedValue(cancelledWithItems);
      orderRecordService.getOrderRecord.mockResolvedValue({
        sourceConnectionId: connectionId,
        orderSnapshot: { status: 'BOUGHT' },
      } as unknown as OrderRecord);
      orderItemRefResolver.tryResolve.mockResolvedValue({
        resolved: false,
        productRef: { type: 'offer', externalId: 'unmapped-offer' },
        reason: 'no mapping',
      kind: 'missing_mapping' as const,
      });

      await expect(
        service.syncOrderFromSource(connectionId, externalOrderId)
      ).rejects.toBeInstanceOf(MissingOrderItemMappingError);

      expect(jobQueue.enqueue).toHaveBeenCalledTimes(1);
      expect(jobQueue.enqueue).toHaveBeenCalledWith({
        type: 'marketplace.offer.stockRestore',
        connectionId,
        payload: { schemaVersion: 1, internalOrderId },
        options: { dedupeKey },
      });
      expect(orderRecordService.persistOrder).not.toHaveBeenCalled();
    });
  });

  describe('syncOrderFromMarketplace – customer resolution', () => {
    const externalOrderId = 'checkout-1';

    const baseIncoming = {
      externalOrderId,
      orderNumber: externalOrderId,
      status: 'BOUGHT',
      items: [],
      totals: { subtotal: 0, tax: 0, shipping: 0, total: 0, currency: 'PLN' },
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    beforeEach(() => {
      identifierMapping.getOrCreateInternalId.mockResolvedValue('ol_order_test');
      orderSyncService.syncOrder.mockResolvedValue([]);
    });

    it('should call resolveCustomerIdentity when customerExternalId and customerEmail are present', async () => {
      orderSource.getOrder.mockResolvedValueOnce({
        ...baseIncoming,
        customerExternalId: 'buyer-ext-1',
        customerEmail: 'buyer@example.com',
      });
      integrationsService.getCapabilityAdapter.mockResolvedValue(orderSource);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(customerIdentityResolver.resolveCustomerIdentity).toHaveBeenCalledWith(
        expect.objectContaining({
          externalBuyerId: 'buyer-ext-1',
          email: 'buyer@example.com',
          sourceConnectionId: connectionId,
        })
      );
      expect(identifierMapping.getOrCreateInternalId).not.toHaveBeenCalledWith(
        'Customer',
        expect.anything(),
        expect.anything(),
        expect.anything()
      );
    });

    it('should fall back to identifierMapping when customerExternalId is present but email is absent', async () => {
      orderSource.getOrder.mockResolvedValueOnce({
        ...baseIncoming,
        customerExternalId: 'buyer-ext-2',
      });
      integrationsService.getCapabilityAdapter.mockResolvedValue(orderSource);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(customerIdentityResolver.resolveCustomerIdentity).not.toHaveBeenCalled();
      expect(identifierMapping.getOrCreateInternalId).toHaveBeenCalledWith(
        'Customer',
        'buyer-ext-2',
        connectionId,
        expect.objectContaining({ parentEntityType: 'Order' })
      );
    });

    it('should resolve customer via email when customerEmail is present but customerExternalId is absent (#1208/#995)', async () => {
      orderSource.getOrder.mockResolvedValueOnce({
        ...baseIncoming,
        customerEmail: 'erli-buyer@example.com',
      });
      integrationsService.getCapabilityAdapter.mockResolvedValue(orderSource);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      // Email-only source: the email is the connection-scoped buyer-identity key.
      expect(customerIdentityResolver.resolveCustomerIdentity).toHaveBeenCalledWith({
        externalBuyerId: 'erli-buyer@example.com',
        email: 'erli-buyer@example.com',
        sourceConnectionId: connectionId,
      });
      // The Customer mapping is NOT created directly — resolution goes through
      // the identity resolver, which owns the Customer-mapping write.
      expect(identifierMapping.getOrCreateInternalId).not.toHaveBeenCalledWith(
        'Customer',
        expect.anything(),
        expect.anything(),
        expect.anything()
      );
      // The resolved internal customer id flows onto the persisted snapshot, so
      // the destination order-create has a customerId (the bug fix).
      expect(orderRecordService.persistIncomingSnapshot).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'ol_customer_test',
        connectionId,
        null
      );
    });

    it('should return undefined customer when neither customerExternalId nor customerEmail is present', async () => {
      orderSource.getOrder.mockResolvedValueOnce({ ...baseIncoming });
      integrationsService.getCapabilityAdapter.mockResolvedValue(orderSource);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(customerIdentityResolver.resolveCustomerIdentity).not.toHaveBeenCalled();
      expect(identifierMapping.getOrCreateInternalId).not.toHaveBeenCalledWith(
        'Customer',
        expect.anything(),
        expect.anything(),
        expect.anything()
      );
      expect(orderRecordService.persistIncomingSnapshot).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        null,
        connectionId,
        null
      );
    });
  });

  describe('syncOrderFromMarketplace – item resolution', () => {
    const externalOrderId = 'checkout-item-test';

    const incomingWithItems = {
      externalOrderId,
      orderNumber: externalOrderId,
      status: 'BOUGHT',
      items: [
        {
          id: 'item-1',
          productRef: { type: 'offer' as const, externalId: 'offer-a' },
          quantity: 1,
          price: 9.99,
          name: 'Offer A',
          imageUrl: 'https://cdn.example/a.jpg',
        },
        {
          id: 'item-2',
          productRef: { type: 'offer' as const, externalId: 'offer-b' },
          quantity: 2,
          price: 4.99,
        },
      ],
      totals: { subtotal: 19.97, tax: 0, shipping: 0, total: 19.97, currency: 'PLN' },
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    beforeEach(() => {
      identifierMapping.getOrCreateInternalId.mockResolvedValue('ol_order_item_test');
      orderSource.getOrder.mockResolvedValue(incomingWithItems);
      integrationsService.getCapabilityAdapter.mockResolvedValue(orderSource);
      orderSyncService.syncOrder.mockResolvedValue([]);
    });

    it('happy path: all items resolve — persistIncomingSnapshot then persistOrder called', async () => {
      orderItemRefResolver.tryResolve
        .mockResolvedValueOnce({
          resolved: true,
          internalProductId: 'p-1',
          internalVariantId: 'v-1',
        })
        .mockResolvedValueOnce({
          resolved: true,
          internalProductId: 'p-2',
          internalVariantId: 'v-2',
        });

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(orderRecordService.persistIncomingSnapshot).toHaveBeenCalledTimes(1);
      expect(orderRecordService.persistOrder).toHaveBeenCalledTimes(1);
      expect(orderSyncService.syncOrder).toHaveBeenCalledTimes(1);

      // buildUnifiedOrder must propagate IncomingOrderItem.name / imageUrl
      // onto the resolved OrderItem so persistOrder can persist them. This
      // is the only test that exercises the IncomingOrderItem → OrderItem
      // conversion; the persistOrder spec works with Order directly.
      const persistedOrder = orderRecordService.persistOrder.mock.calls[0][0];
      expect(persistedOrder.items).toHaveLength(2);
      expect(persistedOrder.items[0]).toMatchObject({
        id: 'item-1',
        name: 'Offer A',
        imageUrl: 'https://cdn.example/a.jpg',
      });
      expect(persistedOrder.items[1].name).toBeUndefined();
      expect(persistedOrder.items[1].imageUrl).toBeUndefined();
    });

    it('partial unresolved: persistIncomingSnapshot called, MissingOrderItemMappingError thrown, persistOrder NOT called', async () => {
      orderItemRefResolver.tryResolve
        .mockResolvedValueOnce({
          resolved: true,
          internalProductId: 'p-1',
          internalVariantId: 'v-1',
        })
        .mockResolvedValueOnce({
          resolved: false,
          productRef: { type: 'offer', externalId: 'offer-b' },
          reason: 'no mapping',
        kind: 'missing_mapping' as const,
        });

      await expect(
        service.syncOrderFromSource(connectionId, externalOrderId)
      ).rejects.toBeInstanceOf(MissingOrderItemMappingError);

      expect(orderRecordService.persistIncomingSnapshot).toHaveBeenCalledTimes(1);
      expect(orderRecordService.persistOrder).not.toHaveBeenCalled();
      expect(orderSyncService.syncOrder).not.toHaveBeenCalled();
    });

    it('stale item ref: marks the record source_deleted with the stale reason, then still throws (#1689)', async () => {
      orderItemRefResolver.tryResolve
        .mockResolvedValueOnce({
          resolved: true,
          internalProductId: 'p-1',
          internalVariantId: 'v-1',
        })
        .mockResolvedValueOnce({
          resolved: false,
          productRef: { type: 'offer', externalId: 'offer-b' },
          reason: 'variant ol_variant_b deleted at the master',
          kind: 'source_deleted' as const,
        });

      await expect(
        service.syncOrderFromSource(connectionId, externalOrderId)
      ).rejects.toBeInstanceOf(MissingOrderItemMappingError);

      expect(orderRecordService.markItemResolutionFailure).toHaveBeenCalledWith('ol_order_item_test', {
        status: 'source_deleted',
        reason: 'variant ol_variant_b deleted at the master',
      });
      expect(orderRecordService.persistOrder).not.toHaveBeenCalled();
    });

    it('a mix of missing-mapping + stale refs marks the record source_deleted (higher precedence)', async () => {
      orderItemRefResolver.tryResolve
        .mockResolvedValueOnce({
          resolved: false,
          productRef: { type: 'offer', externalId: 'offer-a' },
          reason: 'no mapping a',
          kind: 'missing_mapping' as const,
        })
        .mockResolvedValueOnce({
          resolved: false,
          productRef: { type: 'offer', externalId: 'offer-b' },
          reason: 'variant ol_variant_b deleted at the master',
          kind: 'source_deleted' as const,
        });

      await expect(
        service.syncOrderFromSource(connectionId, externalOrderId)
      ).rejects.toBeInstanceOf(MissingOrderItemMappingError);

      expect(orderRecordService.markItemResolutionFailure).toHaveBeenCalledWith('ol_order_item_test', {
        status: 'source_deleted',
        reason: 'variant ol_variant_b deleted at the master',
      });
    });

    it('all missing-mapping (no stale refs) marks the record awaiting_mapping', async () => {
      orderItemRefResolver.tryResolve
        .mockResolvedValueOnce({
          resolved: false,
          productRef: { type: 'offer', externalId: 'offer-a' },
          reason: 'no mapping a',
          kind: 'missing_mapping' as const,
        })
        .mockResolvedValueOnce({
          resolved: false,
          productRef: { type: 'offer', externalId: 'offer-b' },
          reason: 'no mapping b',
          kind: 'missing_mapping' as const,
        });

      await expect(
        service.syncOrderFromSource(connectionId, externalOrderId)
      ).rejects.toBeInstanceOf(MissingOrderItemMappingError);

      expect(orderRecordService.markItemResolutionFailure).toHaveBeenCalledWith('ol_order_item_test', {
        status: 'awaiting_mapping',
        reason: 'no mapping a',
      });
    });

    it('all unresolved: persistIncomingSnapshot called, MissingOrderItemMappingError thrown, persistOrder NOT called', async () => {
      orderItemRefResolver.tryResolve
        .mockResolvedValueOnce({
          resolved: false,
          productRef: { type: 'offer', externalId: 'offer-a' },
          reason: 'no mapping a',
        kind: 'missing_mapping' as const,
        })
        .mockResolvedValueOnce({
          resolved: false,
          productRef: { type: 'offer', externalId: 'offer-b' },
          reason: 'no mapping b',
        kind: 'missing_mapping' as const,
        });

      await expect(
        service.syncOrderFromSource(connectionId, externalOrderId)
      ).rejects.toBeInstanceOf(MissingOrderItemMappingError);

      expect(orderRecordService.persistIncomingSnapshot).toHaveBeenCalledTimes(1);
      expect(orderRecordService.persistOrder).not.toHaveBeenCalled();
    });
  });

  describe('syncOrderFromSource – inbound cancellation (#1158 / #1132)', () => {
    const externalOrderId = 'checkout-cancel-1';

    it('relays a cancel to the order destinations and does NOT re-run the create path', async () => {
      identifierMapping.getInternalId.mockResolvedValue('ol_order_cancel');
      orderRecordService.getOrderRecord.mockResolvedValue({
        sourceConnectionId: connectionId,
      } as unknown as OrderRecord);
      orderLifecycleRelay.relay.mockResolvedValue({
        targets: [{ connectionId: 'dest-conn-1', outcome: 'applied' }],
      });

      const result = await service.syncOrderFromSource(
        connectionId,
        externalOrderId,
        'evt-1',
        'cancelled'
      );

      expect(result).toEqual([]);
      expect(orderLifecycleRelay.relay).toHaveBeenCalledWith({
        internalOrderId: 'ol_order_cancel',
        originConnectionId: connectionId,
        event: { type: 'cancelled' },
      });
      // Must NOT hydrate or re-create the order (the #1132 bug was re-creating it).
      expect(orderSource.getOrder).not.toHaveBeenCalled();
      expect(orderRecordService.persistIncomingSnapshot).not.toHaveBeenCalled();
      expect(orderRecordService.persistOrder).not.toHaveBeenCalled();
      expect(orderSyncService.syncOrder).not.toHaveBeenCalled();
    });

    it('does nothing when the cancelled order was never ingested (no internal mapping)', async () => {
      identifierMapping.getInternalId.mockResolvedValue(null);

      const result = await service.syncOrderFromSource(
        connectionId,
        externalOrderId,
        'evt-1',
        'cancelled'
      );

      expect(result).toEqual([]);
      expect(orderLifecycleRelay.relay).not.toHaveBeenCalled();
    });

    it('skips the relay for a destination-echo cancel (order originates from another connection)', async () => {
      identifierMapping.getInternalId.mockResolvedValue('ol_order_cancel');
      orderRecordService.getOrderRecord.mockResolvedValue({
        sourceConnectionId: 'allegro-connection',
      } as unknown as OrderRecord);

      const result = await service.syncOrderFromSource(
        connectionId,
        externalOrderId,
        'evt-1',
        'cancelled'
      );

      expect(result).toEqual([]);
      expect(orderLifecycleRelay.relay).not.toHaveBeenCalled();
    });

    it('logs at warn when a destination rejects the cancel (e.g. already shipped)', async () => {
      const warnSpy = jest.spyOn(service['logger'], 'warn');
      identifierMapping.getInternalId.mockResolvedValue('ol_order_cancel');
      orderRecordService.getOrderRecord.mockResolvedValue({
        sourceConnectionId: connectionId,
      } as unknown as OrderRecord);
      orderLifecycleRelay.relay.mockResolvedValue({
        targets: [
          { connectionId: 'dest-conn-1', outcome: 'rejected', detail: 'order already shipped' },
        ],
      });

      await service.syncOrderFromSource(connectionId, externalOrderId, 'evt-1', 'cancelled');

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('dest-conn-1=rejected'));
    });
  });

  describe('syncOrderFromSource – inbound cancellation durably recorded on the record (#1984)', () => {
    const externalOrderId = 'checkout-cancel-1984';

    it('marks the order record cancelled BEFORE relaying to destinations', async () => {
      identifierMapping.getInternalId.mockResolvedValue('ol_order_cancel');
      orderRecordService.getOrderRecord.mockResolvedValue({
        sourceConnectionId: connectionId,
      } as unknown as OrderRecord);
      orderLifecycleRelay.relay.mockResolvedValue({
        targets: [{ connectionId: 'dest-conn-1', outcome: 'applied' }],
      });

      await service.syncOrderFromSource(connectionId, externalOrderId, 'evt-1', 'cancelled');

      expect(orderRecordService.markCancelled).toHaveBeenCalledWith(
        'ol_order_cancel',
        expect.any(Date)
      );
      const markCancelledOrder =
        orderRecordService.markCancelled.mock.invocationCallOrder[0];
      const relayOrder = orderLifecycleRelay.relay.mock.invocationCallOrder[0];
      expect(markCancelledOrder).toBeLessThan(relayOrder);
    });

    it('does NOT mark the record cancelled when the order was never ingested (no internal mapping)', async () => {
      identifierMapping.getInternalId.mockResolvedValue(null);

      await service.syncOrderFromSource(connectionId, externalOrderId, 'evt-1', 'cancelled');

      expect(orderRecordService.markCancelled).not.toHaveBeenCalled();
    });

    it('does NOT mark the record cancelled on a destination-echo cancel', async () => {
      identifierMapping.getInternalId.mockResolvedValue('ol_order_cancel');
      orderRecordService.getOrderRecord.mockResolvedValue({
        sourceConnectionId: 'allegro-connection',
      } as unknown as OrderRecord);

      await service.syncOrderFromSource(connectionId, externalOrderId, 'evt-1', 'cancelled');

      expect(orderRecordService.markCancelled).not.toHaveBeenCalled();
    });

    it('still relays to destinations when markCancelled throws (the write is best-effort, never blocking)', async () => {
      identifierMapping.getInternalId.mockResolvedValue('ol_order_cancel');
      orderRecordService.getOrderRecord.mockResolvedValue({
        sourceConnectionId: connectionId,
      } as unknown as OrderRecord);
      orderRecordService.markCancelled.mockRejectedValueOnce(new Error('db unavailable'));
      orderLifecycleRelay.relay.mockResolvedValue({
        targets: [{ connectionId: 'dest-conn-1', outcome: 'applied' }],
      });
      const errorSpy = jest.spyOn(service['logger'], 'error').mockImplementation();

      const result = await service.syncOrderFromSource(
        connectionId,
        externalOrderId,
        'evt-1',
        'cancelled'
      );

      expect(result).toEqual([]);
      expect(orderLifecycleRelay.relay).toHaveBeenCalledWith({
        internalOrderId: 'ol_order_cancel',
        originConnectionId: connectionId,
        event: { type: 'cancelled' },
      });
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to record cancellation'),
        expect.anything()
      );
    });
  });

  describe('source-amendment fact (#2283)', () => {
    const externalOrderId = 'amend-1';
    const internalOrderId = 'ol_order_amend';

    const incoming = {
      externalOrderId,
      orderNumber: externalOrderId,
      status: 'BOUGHT',
      items: [
        {
          id: 'l1',
          productRef: { type: 'offer' as const, externalId: 'offer-l1' },
          quantity: 1,
          price: 10,
          sku: 'SKU-l1',
        },
      ],
      totals: { subtotal: 10, tax: 0, shipping: 0, total: 10, currency: 'PLN' },
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
    };

    beforeEach(() => {
      identifierMapping.getOrCreateInternalId.mockResolvedValue(internalOrderId);
      orderSource.getOrder.mockResolvedValue(incoming);
      integrationsService.getCapabilityAdapter.mockResolvedValue(orderSource);
      orderSyncService.syncOrder.mockResolvedValue([]);
      orderItemRefResolver.tryResolve.mockResolvedValue({
        resolved: true,
        internalProductId: 'ol_product_1',
        internalVariantId: 'ol_variant_1',
      });
    });

    const priorWithQuantity = (quantity: number): OrderRecord =>
      ({
        sourceConnectionId: connectionId,
        orderSnapshot: { status: 'BOUGHT', items: [{ id: 'l1', quantity, sku: 'SKU-l1' }] },
      }) as unknown as OrderRecord;

    it('should record the fact once with the observed changes when the source amended the order', async () => {
      orderRecordService.getOrderRecord.mockResolvedValue(priorWithQuantity(3));

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(orderRecordService.recordAmendment).toHaveBeenCalledTimes(1);
      expect(orderRecordService.recordAmendment).toHaveBeenCalledWith(
        internalOrderId,
        expect.any(Date),
        [
          {
            kind: 'line-quantity-changed',
            lineId: 'l1',
            sku: 'SKU-l1',
            fromQuantity: 3,
            toQuantity: 1,
          },
        ]
      );
    });

    it('should record the fact BEFORE the snapshot write that would destroy the evidence', async () => {
      orderRecordService.getOrderRecord.mockResolvedValue(priorWithQuantity(3));

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(orderRecordService.recordAmendment.mock.invocationCallOrder[0]).toBeLessThan(
        orderRecordService.persistIncomingSnapshot.mock.invocationCallOrder[0]
      );
    });

    it('should not record anything on an identical re-poll', async () => {
      orderRecordService.getOrderRecord.mockResolvedValue(priorWithQuantity(1));

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(orderRecordService.recordAmendment).not.toHaveBeenCalled();
    });

    it('should not record anything on a first ingestion', async () => {
      orderRecordService.getOrderRecord.mockResolvedValue(null);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(orderRecordService.recordAmendment).not.toHaveBeenCalled();
    });

    it('should not record anything on the destination-echo skip', async () => {
      orderRecordService.getOrderRecord.mockResolvedValue({
        sourceConnectionId: 'some-other-connection',
        orderSnapshot: { items: [{ id: 'l1', quantity: 99 }] },
      } as unknown as OrderRecord);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(orderRecordService.recordAmendment).not.toHaveBeenCalled();
    });

    it('should still record the fact when item resolution later throws', async () => {
      orderRecordService.getOrderRecord.mockResolvedValue(priorWithQuantity(3));
      orderItemRefResolver.tryResolve.mockResolvedValue({
        resolved: false,
        productRef: { type: 'offer', externalId: 'unmapped' },
        reason: 'no mapping',
        kind: 'missing_mapping' as const,
      });

      await expect(
        service.syncOrderFromSource(connectionId, externalOrderId)
      ).rejects.toBeInstanceOf(MissingOrderItemMappingError);

      expect(orderRecordService.recordAmendment).toHaveBeenCalledTimes(1);
    });

    it('should not fail the ingestion when recording the fact throws', async () => {
      orderRecordService.getOrderRecord.mockResolvedValue(priorWithQuantity(3));
      orderRecordService.recordAmendment.mockRejectedValueOnce(new Error('db down'));
      const errorSpy = jest
        .spyOn((service as unknown as { logger: { error: jest.Mock } }).logger, 'error')
        .mockImplementation(() => undefined);

      await expect(service.syncOrderFromSource(connectionId, externalOrderId)).resolves.toEqual(
        []
      );

      expect(orderRecordService.persistOrder).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to record source amendment'),
        expect.anything()
      );
    });
  });

  describe('tax-rate journal - channel observations (#2250, ADR-063 § 4)', () => {
    const externalOrderId = 'checkout-journal';

    const incomingWith = (
      items: Array<{ id: string; externalId: string; taxRate?: string }>
    ): IncomingOrder => ({
      externalOrderId,
      orderNumber: externalOrderId,
      status: 'BOUGHT',
      items: items.map((i) => ({
        id: i.id,
        productRef: { type: 'offer' as const, externalId: i.externalId },
        quantity: 1,
        price: 9.99,
        ...(i.taxRate === undefined ? {} : { taxRate: i.taxRate }),
      })),
      totals: { subtotal: 9.99, tax: 0, shipping: 0, total: 9.99, currency: 'PLN' },
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    });

    beforeEach(() => {
      identifierMapping.getOrCreateInternalId.mockResolvedValue('ol_order_journal');
      integrationsService.getCapabilityAdapter.mockResolvedValue(orderSource);
      orderSyncService.syncOrder.mockResolvedValue([]);
      orderItemRefResolver.tryResolve.mockResolvedValue({
        resolved: true,
        internalProductId: 'p-1',
        internalVariantId: 'v-1',
      });
    });

    it('records a channel entry for a line whose source reported its own rate', async () => {
      orderSource.getOrder.mockResolvedValue(
        incomingWith([{ id: 'item-1', externalId: 'offer-a', taxRate: '8' }])
      );

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(taxRateJournal.record).toHaveBeenCalledTimes(1);
      expect(taxRateJournal.record).toHaveBeenCalledWith({
        productId: 'p-1',
        variantId: 'v-1',
        connectionId,
        origin: 'channel',
        taxRate: '8',
      });
    });

    it('records nothing when the channel reported no rate', async () => {
      orderSource.getOrder.mockResolvedValue(
        incomingWith([{ id: 'item-1', externalId: 'offer-a' }])
      );

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(taxRateJournal.record).not.toHaveBeenCalled();
    });

    it('records nothing for a blank channel rate', async () => {
      orderSource.getOrder.mockResolvedValue(
        incomingWith([{ id: 'item-1', externalId: 'offer-a', taxRate: '   ' }])
      );

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(taxRateJournal.record).not.toHaveBeenCalled();
    });

    it('records the CHANNEL value even when the shop rate wins the line', async () => {
      // The line settles on the shop's 23, but the journal must still record
      // that the channel said 8 - otherwise the disagreement is unattributable.
      productsService.getEffectiveTaxRate = jest.fn().mockResolvedValue({
        code: '23',
        countryIso2: 'PL',
        readAt: new Date('2026-02-01T00:00:00Z'),
      });
      orderSource.getOrder.mockResolvedValue(
        incomingWith([{ id: 'item-1', externalId: 'offer-a', taxRate: '8' }])
      );

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(taxRateJournal.record).toHaveBeenCalledWith(
        expect.objectContaining({ origin: 'channel', taxRate: '8' })
      );
      const persistedOrder = orderRecordService.persistOrder.mock.calls[0][0];
      expect(persistedOrder.items[0]).toMatchObject({ taxRate: '23', taxSource: 'shop' });
    });

    it('never fails the ingestion when the journal write throws', async () => {
      taxRateJournal.record.mockRejectedValue(new Error('journal down'));
      orderSource.getOrder.mockResolvedValue(
        incomingWith([{ id: 'item-1', externalId: 'offer-a', taxRate: '8' }])
      );

      await expect(
        service.syncOrderFromSource(connectionId, externalOrderId)
      ).resolves.toEqual([]);
      expect(orderRecordService.persistOrder).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * #2396 — the fulfilment ingestion intercept, characterisation half.
   *
   * DESIGN §5.1's survival property: **a router-less install runs
   * byte-identically to today**. This block is written to pass on UNMODIFIED
   * code and to keep passing after the intercept lands — if it ever fails, the
   * intercept has changed the pass-through, which is the one thing it may not
   * do.
   *
   * The `syncOrder` argument is asserted as a WHOLE OBJECT rather than
   * field-by-field, because the defect being guarded against is an EXTRA key
   * (`destinationConnectionIds`) appearing on the pass-through arm. A
   * `objectContaining` / per-field assertion cannot see an added key, so it
   * would pass through exactly the regression this exists to catch.
   */
  describe('fulfilment ingestion intercept — characterisation (#2396)', () => {
    const externalOrderId = 'checkout-char';
    const charIncoming = {
      externalOrderId,
      orderNumber: externalOrderId,
      status: 'BOUGHT',
      items: [
        {
          id: 'line-1',
          productRef: { type: 'variant' as const, externalId: 'ext-v1' },
          quantity: 1,
          price: 10,
        },
      ],
      totals: { subtotal: 10, tax: 0, shipping: 0, total: 10, currency: 'PLN' },
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    beforeEach(() => {
      identifierMapping.getOrCreateInternalId.mockResolvedValue('ol_order_char');
      orderSource.getOrder.mockResolvedValue(charIncoming);
      integrationsService.getCapabilityAdapter.mockResolvedValue(orderSource);
      orderSyncService.syncOrder.mockResolvedValue([]);
      orderItemRefResolver.tryResolve.mockResolvedValue({
        resolved: true,
        internalProductId: 'ol_product_1',
        internalVariantId: 'ol_variant_1',
      });
    });

    it('passes syncOrder a byte-identical request on a router-less install', async () => {
      await service.syncOrderFromSource(connectionId, externalOrderId, 'evt-1');

      expect(orderSyncService.syncOrder).toHaveBeenCalledTimes(1);

      const request = orderSyncService.syncOrder.mock.calls[0][0];

      // Whole-object equality: the key set is the assertion. An intercept that
      // starts passing `destinationConnectionIds: undefined` EXPLICITLY would
      // still satisfy this (the key is absent from neither side under
      // `toEqual`'s undefined-insensitivity), but one that passes `[]` — the
      // "router selected nobody" value — fails loudly. That is the intended
      // sensitivity: `[]` on a router-less install stops all provisioning.
      expect(request).toEqual({
        order: expect.objectContaining({ id: 'ol_order_char' }),
        sourceConnectionId: connectionId,
        sourceEventId: 'evt-1',
      });
      expect(request.destinationConnectionIds).toBeUndefined();
    });

    it('never writes a fulfilment block reason on a router-less install', async () => {
      await service.syncOrderFromSource(connectionId, externalOrderId, 'evt-1');

      // `markFulfillmentBlock` does not exist on the service before #2396; the
      // mock carries it from the outset so this assertion is meaningful both
      // before and after. A non-null write here would mean the pass-through arm
      // is reporting a block that no operator can act on.
      // Read through a structural cast rather than the interface: this test is
      // written to run BEFORE `markFulfillmentBlock` exists on
      // `IOrderRecordService`, which is what makes it a characterisation of
      // today's behaviour rather than a test of the change.
      const writer = orderRecordService as unknown as {
        markFulfillmentBlock?: jest.Mock;
      };
      const calls = writer.markFulfillmentBlock?.mock.calls ?? [];
      for (const [, block] of calls) {
        expect(block).toBeNull();
      }
    });
  });

  /**
   * #2396 — the fulfilment ingestion intercept, behaviour half.
   *
   * The characterisation block above pins that a router-less install is
   * unchanged. This one pins what the intercept does once a router IS in play,
   * and — just as importantly — what it must NOT persist.
   */
  describe('fulfilment ingestion intercept — behaviour (#2396)', () => {
    const externalOrderId = 'checkout-int';
    const interceptIncoming = {
      externalOrderId,
      orderNumber: externalOrderId,
      status: 'BOUGHT',
      items: [
        {
          id: 'line-1',
          productRef: { type: 'variant' as const, externalId: 'ext-v1' },
          quantity: 1,
          price: 10,
        },
      ],
      totals: { subtotal: 10, tax: 0, shipping: 0, total: 10, currency: 'PLN' },
      shippingAddress: {
        firstName: 'A',
        lastName: 'B',
        address1: 'x',
        city: 'Warsaw',
        postalCode: '00-001',
        country: 'PL',
      },
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    /** A connection claiming A2 (`config-only`, so capability lists are irrelevant). */
    const routerConnection = (id: string) => ({
      id,
      status: 'active',
      enabledCapabilities: [],
      config: { sourcingAuthority: { enabled: true } },
    });

    const markBlock = () =>
      orderRecordService.markFulfillmentBlock as jest.MockedFunction<
        IOrderRecordService['markFulfillmentBlock']
      >;

    beforeEach(() => {
      identifierMapping.getOrCreateInternalId.mockResolvedValue('ol_order_int');
      orderSource.getOrder.mockResolvedValue(interceptIncoming);
      integrationsService.getCapabilityAdapter.mockResolvedValue(orderSource);
      orderSyncService.syncOrder.mockResolvedValue([]);
      orderItemRefResolver.tryResolve.mockResolvedValue({
        resolved: true,
        internalProductId: 'ol_product_1',
        internalVariantId: 'ol_variant_1',
      });
      resolveRouterMock.mockResolvedValue(null);
    });

    describe('the ambiguous arm', () => {
      beforeEach(() => {
        // Two connections both claiming A2 — `multiple-scoped-holders`, which
        // `isFulfillmentRouterUnroutable` reports as uncommittable.
        connections.list.mockResolvedValue([
          routerConnection('conn-a'),
          routerConnection('conn-b'),
        ] as never);
      });

      it('follows today\'s path — the order still reaches its destinations', async () => {
        await service.syncOrderFromSource(connectionId, externalOrderId);

        expect(orderSyncService.syncOrder).toHaveBeenCalledTimes(1);
        expect(orderSyncService.syncOrder.mock.calls[0][0].destinationConnectionIds).toBeUndefined();
      });

      it('persists NOTHING — #2352 already reports A2-A at order grain', async () => {
        // THE assertion this arm exists for. `'sourcing-ambiguous'` (spec row
        // A2-A) is derived on every read by `resolveAuthorities` with
        // `counted: true` and `surfaces: ['order','connection']`. Persisting a
        // reason here too would double-count `Needs attention (N)` — the one
        // number an operator acts on — and a double-counted badge teaches them
        // the count is noise.
        //
        // Written as "never called with a non-null reason" rather than "never
        // called": the level-triggered clear legitimately writes `null` here.
        await service.syncOrderFromSource(connectionId, externalOrderId);

        for (const [, block] of markBlock().mock.calls) {
          expect(block).toBeNull();
        }
      });
    });

    describe('the selected arm', () => {
      const router = { route: jest.fn() };

      beforeEach(() => {
        connections.list.mockResolvedValue([routerConnection('conn-a')] as never);
        resolveRouterMock.mockResolvedValue(router as never);
      });

      it('HOLDS a routed order — no destination mirror, no syncStatus row', async () => {
        routingCommit.route.mockResolvedValue({
          status: 'routed',
          decisionId: 'dec-1',
          workIds: ['w-1'],
        });

        const results = await service.syncOrderFromSource(connectionId, externalOrderId);

        // A hold that still mirrors the order into the shop is not a hold.
        expect(orderSyncService.syncOrder).not.toHaveBeenCalled();
        expect(orderRecordService.updateSyncStatus).not.toHaveBeenCalled();
        expect(results).toEqual([]);
      });

      it('persists nothing for a routed order — the work object is the explanation', async () => {
        routingCommit.route.mockResolvedValue({
          status: 'routed',
          decisionId: 'dec-1',
          workIds: ['w-1'],
        });

        await service.syncOrderFromSource(connectionId, externalOrderId);

        for (const [, block] of markBlock().mock.calls) {
          expect(block).toBeNull();
        }
      });

      // Typed as the real union, NOT `as never`: an `as never` table would
      // defeat the exact typing the exhaustive switch exists to give, so a
      // required field added to an outcome arm would compile here and fail only
      // in production.
      const heldOutcomes: [RoutingCommitOutcome, FulfillmentBlockReason][] = [
        [
          { status: 'in-doubt', decisionId: 'dec-1', cause: 'timeout' },
          'routing-in-doubt',
        ],
        [{ status: 'contended' }, 'routing-contended'],
        [
          { status: 'skipped', reason: 'already-routed' },
          'routing-already-live-elsewhere',
        ],
        [
          { status: 'skipped', reason: 'already-live-elsewhere' },
          'routing-already-live-elsewhere',
        ],
      ];

      it.each(heldOutcomes)('holds and reports %j as %s', async (outcome, reason) => {
        routingCommit.route.mockResolvedValue(outcome);

        await service.syncOrderFromSource(connectionId, externalOrderId);

        expect(orderSyncService.syncOrder).not.toHaveBeenCalled();
        expect(markBlock()).toHaveBeenCalledWith(
          'ol_order_int',
          expect.objectContaining({ reason })
        );
      });

      const passThroughOutcomes: [RoutingCommitOutcome][] = [
        [{ status: 'refused', decisionId: 'dec-1', reason: 'plan-not-conserving' }],
        [{ status: 'skipped', reason: 'order-cancelled' }],
      ];

      it.each(passThroughOutcomes)('does NOT hold on %j', async (outcome) => {
        routingCommit.route.mockResolvedValue(outcome);

        await service.syncOrderFromSource(connectionId, externalOrderId);

        // `refused` is terminal and creates no work, so the order must keep its
        // ordinary destination path rather than being stranded behind a hold
        // nothing would ever clear.
        expect(orderSyncService.syncOrder).toHaveBeenCalledTimes(1);
        for (const [, block] of markBlock().mock.calls) {
          expect(block).toBeNull();
        }
      });

      it('clears a stale reason on the next transition (level-triggered)', async () => {
        // The #2100 lesson: a sticky reason outlives the condition. The
        // intercept re-decides on every transition and writes the answer
        // INCLUDING null, which is the only thing that clears it.
        routingCommit.route.mockResolvedValue({ status: 'contended' });
        await service.syncOrderFromSource(connectionId, externalOrderId);
        expect(markBlock()).toHaveBeenLastCalledWith(
          'ol_order_int',
          expect.objectContaining({ reason: 'routing-contended' })
        );

        // The operator fixes it / the peer finishes: the next transition routes.
        routingCommit.route.mockResolvedValue({
          status: 'routed',
          decisionId: 'dec-9',
          workIds: ['w-9'],
        });
        await service.syncOrderFromSource(connectionId, externalOrderId);

        expect(markBlock()).toHaveBeenLastCalledWith('ol_order_int', null);
      });

      it('follows today\'s path when no router is wired (every install today)', async () => {
        resolveRouterMock.mockResolvedValue(null);

        await service.syncOrderFromSource(connectionId, externalOrderId);

        expect(routingCommit.route).not.toHaveBeenCalled();
        expect(orderSyncService.syncOrder).toHaveBeenCalledTimes(1);
      });

      it('degrades to today\'s path when routing throws', async () => {
        // Fail OPEN. Holding on an unknown would withhold the mirror
        // indefinitely for a paid order.
        routingCommit.route.mockRejectedValue(new Error('routing store unreachable'));

        await service.syncOrderFromSource(connectionId, externalOrderId);

        expect(orderSyncService.syncOrder).toHaveBeenCalledTimes(1);
      });

      it('does not fail ingestion when persisting the block reason throws', async () => {
        // A SEPARATE catch from the intercept's own, and separately
        // load-bearing: `persistFulfillmentOutcome` is awaited BEFORE the
        // held/pass-through branch, on every ingestion on every install — where
        // it is writing `null` over `null`. If its catch ever went missing, a
        // transient DB blip while recording a routing reason would fail the
        // whole order sync. The outcome is re-decided next transition, so a
        // lost write self-heals; a lost ORDER does not.
        routingCommit.route.mockResolvedValue({ status: 'refused', decisionId: 'dec-1', reason: 'plan-not-conserving' });
        markBlock().mockRejectedValue(new Error('order_records unreachable'));

        await expect(
          service.syncOrderFromSource(connectionId, externalOrderId)
        ).resolves.toBeDefined();

        expect(orderSyncService.syncOrder).toHaveBeenCalledTimes(1);
      });

      it('still holds a routed order when persisting the block reason throws', async () => {
        // The hold must not depend on the write succeeding — a swallowed
        // persistence failure that also dropped the hold would mirror an order
        // the router already committed, which is the double-shipment this
        // whole intercept exists to prevent.
        routingCommit.route.mockResolvedValue({
          status: 'in-doubt',
          decisionId: 'dec-1',
          cause: 'timeout',
        });
        markBlock().mockRejectedValue(new Error('order_records unreachable'));

        await service.syncOrderFromSource(connectionId, externalOrderId);

        expect(orderSyncService.syncOrder).not.toHaveBeenCalled();
      });

      it('still runs the invoicing gate for a HELD order', async () => {
        // Issuance (A7) is a separate authority from sourcing (A2): the buyer
        // has paid and the document is owed whether the parcel leaves from a
        // destination shop or from a routed holder.
        routingCommit.route.mockResolvedValue({
          status: 'routed',
          decisionId: 'dec-1',
          workIds: ['w-1'],
        });

        await service.syncOrderFromSource(connectionId, externalOrderId);

        expect(autoIssueTrigger.onOrderTransition).toHaveBeenCalledTimes(1);
      });
    });
  });
});

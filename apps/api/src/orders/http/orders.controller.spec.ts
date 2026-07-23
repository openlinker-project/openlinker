/**
 * Orders Controller Unit Tests
 *
 * @module apps/api/src/orders/http
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ConflictException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import {
  ORDER_RECORD_REPOSITORY_TOKEN,
  ORDER_DESTINATION_RETRY_SERVICE_TOKEN,
  OrderRecord,
  OrderRecordNotFoundException,
  OrderDestinationNotFoundException,
  OrderDestinationNotRetryableException,
  MissingSourceExternalIdException,
} from '@openlinker/core/orders';
import type {
  OrderRecordRepositoryPort,
  IOrderDestinationRetryService,
} from '@openlinker/core/orders';
import { INVOICE_SERVICE_TOKEN } from '@openlinker/core/invoicing';
import type { IInvoiceService } from '@openlinker/core/invoicing';
import { InvoiceRecord } from '@openlinker/core/invoicing';
import {
  FULFILLMENT_ROUTING_SERVICE_TOKEN,
  DELIVERY_RIDER_SERVICE_TOKEN,
} from '@openlinker/core/mappings';
import type {
  IFulfillmentRoutingService,
  IDeliveryRiderService,
} from '@openlinker/core/mappings';

describe('OrdersController', () => {
  let controller: OrdersController;
  let repository: jest.Mocked<OrderRecordRepositoryPort>;
  let retryService: jest.Mocked<IOrderDestinationRetryService>;
  let invoiceService: jest.Mocked<IInvoiceService>;
  let fulfillmentRouting: jest.Mocked<IFulfillmentRoutingService>;
  let deliveryRider: jest.Mocked<IDeliveryRiderService>;

  const mockOrder = new OrderRecord(
    'ol_order_001',
    'ol_customer_001',
    'conn-source-001',
    'event-001',
    { externalOrderId: 'EXT-123', items: [] },
    [
      {
        destinationConnectionId: 'conn-dest-001',
        status: 'synced',
        syncedAt: new Date('2026-04-01T12:00:00Z'),
        externalOrderId: 'PS-456',
        externalOrderNumber: '000456',
      },
    ],
    'ready',
    new Date('2026-04-01T00:00:00Z'),
    new Date('2026-04-01T12:00:00Z')
  );

  beforeEach(async () => {
    const mockRepository: jest.Mocked<OrderRecordRepositoryPort> = {
      findById: jest.fn(),
      upsert: jest.fn(),
      updateSyncStatus: jest.fn(),
      findMany: jest.fn(),
      countByHealth: jest.fn(),
      countBySla: jest.fn(),
      updateFulfillmentState: jest.fn(),
    };

    const mockRetryService: jest.Mocked<IOrderDestinationRetryService> = {
      retry: jest.fn(),
    };

    const mockInvoiceService: jest.Mocked<IInvoiceService> = {
      getInvoiceById: jest.fn(),
      getLatestInvoiceForOrder: jest.fn(),
      getLatestInvoicesForOrders: jest.fn().mockResolvedValue([]),
      issueInvoice: jest.fn(),
      getInvoice: jest.fn(),
      issueCorrection: jest.fn(),
      listInvoices: jest.fn(),
      applyRegulatoryClearance: jest.fn(),
    };

    const mockFulfillmentRouting: jest.Mocked<IFulfillmentRoutingService> = {
      getRules: jest.fn(),
      getCandidateProcessors: jest.fn(),
      replaceRules: jest.fn(),
      resolve: jest.fn(),
      resolveBatch: jest.fn().mockResolvedValue([]),
    };

    const mockDeliveryRider: jest.Mocked<IDeliveryRiderService> = {
      // Default: no actionable hint. Batch mirrors the input length so the
      // controller's positional zip stays aligned.
      resolve: jest.fn().mockResolvedValue({ rider: 'none' }),
      resolveBatch: jest
        .fn()
        .mockImplementation((inputs: unknown[]) =>
          Promise.resolve(inputs.map(() => ({ rider: 'none' })))
        ),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [
        {
          provide: ORDER_RECORD_REPOSITORY_TOKEN,
          useValue: mockRepository,
        },
        {
          provide: ORDER_DESTINATION_RETRY_SERVICE_TOKEN,
          useValue: mockRetryService,
        },
        {
          provide: INVOICE_SERVICE_TOKEN,
          useValue: mockInvoiceService,
        },
        {
          provide: FULFILLMENT_ROUTING_SERVICE_TOKEN,
          useValue: mockFulfillmentRouting,
        },
        {
          provide: DELIVERY_RIDER_SERVICE_TOKEN,
          useValue: mockDeliveryRider,
        },
      ],
    }).compile();

    controller = module.get<OrdersController>(OrdersController);
    repository = module.get(ORDER_RECORD_REPOSITORY_TOKEN);
    retryService = module.get(ORDER_DESTINATION_RETRY_SERVICE_TOKEN);
    invoiceService = module.get(INVOICE_SERVICE_TOKEN);
    fulfillmentRouting = module.get(FULFILLMENT_ROUTING_SERVICE_TOKEN);
    deliveryRider = module.get(DELIVERY_RIDER_SERVICE_TOKEN);
  });

  describe('listOrders', () => {
    it('should return paginated order records', async () => {
      repository.findMany.mockResolvedValue({ items: [mockOrder], total: 1 });

      const result = await controller.listOrders({ limit: 20, offset: 0 });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
      expect(result.items[0].internalOrderId).toBe('ol_order_001');
      expect(result.items[0].syncStatus).toHaveLength(1);
      expect(result.items[0].syncStatus[0].status).toBe('synced');
      expect(result.items[0].syncStatus[0].externalOrderId).toBe('PS-456');
    });

    it('should pass filters to repository', async () => {
      repository.findMany.mockResolvedValue({ items: [], total: 0 });

      await controller.listOrders({
        sourceConnectionId: 'conn-001',
        syncStatus: 'failed',
        customerId: 'cust-001',
        createdFrom: '2026-01-01T00:00:00Z',
        createdTo: '2026-12-31T23:59:59Z',
        limit: 10,
        offset: 5,
      });

      expect(repository.findMany).toHaveBeenCalledWith(
        {
          sourceConnectionId: 'conn-001',
          syncStatus: 'failed',
          customerId: 'cust-001',
          createdFrom: new Date('2026-01-01T00:00:00Z'),
          createdTo: new Date('2026-12-31T23:59:59Z'),
        },
        { limit: 10, offset: 5 }
      );
    });

    it('passes the sort key and direction through to the repository (#944)', async () => {
      repository.findMany.mockResolvedValue({ items: [], total: 0 });

      await controller.listOrders({ sort: 'total', dir: 'desc', limit: 20, offset: 0 });

      expect(repository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ sort: 'total', dir: 'desc' }),
        { limit: 20, offset: 0 }
      );
    });

    it('should return empty list when no orders match', async () => {
      repository.findMany.mockResolvedValue({ items: [], total: 0 });

      const result = await controller.listOrders({ limit: 20, offset: 0 });

      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('should serialize dates as ISO strings', async () => {
      repository.findMany.mockResolvedValue({ items: [mockOrder], total: 1 });

      const result = await controller.listOrders({ limit: 20, offset: 0 });

      expect(result.items[0].createdAt).toBe('2026-04-01T00:00:00.000Z');
      expect(result.items[0].updatedAt).toBe('2026-04-01T12:00:00.000Z');
      expect(result.items[0].syncStatus[0].syncedAt).toBe('2026-04-01T12:00:00.000Z');
    });

    it('should handle sync status with undefined optional fields', async () => {
      const orderWithMinimalSync = new OrderRecord(
        'ol_order_002',
        null,
        'conn-source-001',
        null,
        {},
        [{ destinationConnectionId: 'conn-dest-001', status: 'pending' }],
        'ready',
        new Date('2026-04-01T00:00:00Z'),
        new Date('2026-04-01T00:00:00Z')
      );
      repository.findMany.mockResolvedValue({ items: [orderWithMinimalSync], total: 1 });

      const result = await controller.listOrders({ limit: 20, offset: 0 });

      expect(result.items[0].syncStatus[0].syncedAt).toBeNull();
      expect(result.items[0].syncStatus[0].externalOrderId).toBeNull();
      expect(result.items[0].syncStatus[0].error).toBeNull();
    });

    it('maps syncAttempts to ISO timestamps and nullable fields', async () => {
      const orderWithAttempts = new OrderRecord(
        'ol_order_003',
        null,
        'conn-source-001',
        null,
        {},
        [{ destinationConnectionId: 'conn-dest-001', status: 'synced' }],
        'ready',
        new Date('2026-04-01T00:00:00Z'),
        new Date('2026-04-01T01:00:00Z'),
        [
          {
            destinationConnectionId: 'conn-dest-001',
            status: 'failed',
            attemptedAt: new Date('2026-04-01T00:30:00Z'),
            error: 'PL not active',
          },
          {
            destinationConnectionId: 'conn-dest-001',
            status: 'synced',
            attemptedAt: new Date('2026-04-01T01:00:00Z'),
            externalOrderId: 'PS-456',
          },
        ]
      );
      repository.findMany.mockResolvedValue({ items: [orderWithAttempts], total: 1 });

      const result = await controller.listOrders({ limit: 20, offset: 0 });

      expect(result.items[0].syncAttempts).toHaveLength(2);
      expect(result.items[0].syncAttempts[0]).toEqual({
        destinationConnectionId: 'conn-dest-001',
        status: 'failed',
        attemptedAt: '2026-04-01T00:30:00.000Z',
        error: 'PL not active',
        externalOrderId: null,
        externalOrderNumber: null,
      });
      expect(result.items[0].syncAttempts[1].externalOrderId).toBe('PS-456');
      expect(result.items[0].syncAttempts[1].error).toBeNull();
    });

    it('exposes an empty syncAttempts array when none exist', async () => {
      repository.findMany.mockResolvedValue({ items: [mockOrder], total: 1 });

      const result = await controller.listOrders({ limit: 20, offset: 0 });

      expect(result.items[0].syncAttempts).toEqual([]);
    });

    it('should pass the health filter through to the repository (#929)', async () => {
      repository.findMany.mockResolvedValue({ items: [], total: 0 });

      await controller.listOrders({ health: 'needs_attention', limit: 20, offset: 0 });

      expect(repository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ health: 'needs_attention' }),
        { limit: 20, offset: 0 }
      );
    });

    it('should pass the dispatch-SLA sort and dueBefore filter through to the repository (#927)', async () => {
      repository.findMany.mockResolvedValue({ items: [], total: 0 });

      await controller.listOrders({
        sort: 'dispatchBy',
        dueBefore: '2026-06-01T12:00:00Z',
        limit: 20,
        offset: 0,
      });

      expect(repository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          sort: 'dispatchBy',
          dueBefore: new Date('2026-06-01T12:00:00Z'),
        }),
        { limit: 20, offset: 0 }
      );
    });

    it('should serialize dispatchByAt as an ISO string, or null when absent (#927)', async () => {
      const orderWithDeadline = new OrderRecord(
        'ol_order_sla',
        null,
        'conn-source-001',
        null,
        {},
        [],
        'ready',
        new Date('2026-04-01T00:00:00Z'),
        new Date('2026-04-01T00:00:00Z'),
        [],
        new Date('2026-04-02T16:00:00Z')
      );
      repository.findMany.mockResolvedValue({ items: [orderWithDeadline, mockOrder], total: 2 });

      const result = await controller.listOrders({ limit: 20, offset: 0 });

      expect(result.items[0].dispatchByAt).toBe('2026-04-02T16:00:00.000Z');
      expect(result.items[1].dispatchByAt).toBeNull();
    });

    it('should derive dispatchByEstimated from the snapshot dispatch window (#1776)', async () => {
      const estimatedOrder = new OrderRecord(
        'ol_order_est',
        null,
        'conn-source-001',
        null,
        { dispatchTime: { from: '2026-04-01T00:00:00Z', to: '2026-04-03T00:00:00Z', estimated: true } },
        [],
        'ready',
        new Date('2026-04-01T00:00:00Z'),
        new Date('2026-04-01T00:00:00Z'),
        [],
        new Date('2026-04-03T00:00:00Z')
      );
      repository.findMany.mockResolvedValue({ items: [estimatedOrder, mockOrder], total: 2 });

      const result = await controller.listOrders({ limit: 20, offset: 0 });

      // Erli-style estimated window → true; authoritative/absent window → false.
      expect(result.items[0].dispatchByEstimated).toBe(true);
      expect(result.items[1].dispatchByEstimated).toBe(false);
    });

    it('should attach a batched deliveryResolution only to orders with a source delivery method (#1791)', async () => {
      const orderWithMethod = new OrderRecord(
        'ol_order_shipped',
        null,
        'conn-source-001',
        null,
        { shipping: { methodId: 'courier-standard' } },
        [],
        'ready',
        new Date('2026-04-01T00:00:00Z'),
        new Date('2026-04-01T00:00:00Z')
      );
      repository.findMany.mockResolvedValue({ items: [orderWithMethod, mockOrder], total: 2 });
      fulfillmentRouting.resolveBatch.mockResolvedValue([
        { processorKind: 'ol_managed_carrier', processorConnectionId: 'conn-inpost', source: 'rule' },
      ]);

      const result = await controller.listOrders({ limit: 20, offset: 0 });

      expect(fulfillmentRouting.resolveBatch).toHaveBeenCalledWith([
        { sourceConnectionId: 'conn-source-001', sourceDeliveryMethodId: 'courier-standard' },
      ]);
      expect(result.items[0].deliveryResolution).toEqual({
        source: 'rule',
        processorKind: 'ol_managed_carrier',
        processorConnectionId: 'conn-inpost',
      });
      expect(result.items[1].deliveryResolution).toBeUndefined();
    });

    it('should skip resolveBatch entirely when no order in the page has a delivery method (#1791)', async () => {
      repository.findMany.mockResolvedValue({ items: [mockOrder], total: 1 });

      const result = await controller.listOrders({ limit: 20, offset: 0 });

      expect(fulfillmentRouting.resolveBatch).not.toHaveBeenCalled();
      expect(result.items[0].deliveryResolution).toBeUndefined();
    });

    it('should attach a batched deliveryRider next to deliveryResolution, threading the routing source (#1792)', async () => {
      const orderWithMethod = new OrderRecord(
        'ol_order_rider',
        null,
        'conn-source-001',
        null,
        { shipping: { methodId: 'ai-inpost-1', methodName: 'Allegro Paczkomat InPost' } },
        [],
        'ready',
        new Date('2026-04-01T00:00:00Z'),
        new Date('2026-04-01T00:00:00Z')
      );
      repository.findMany.mockResolvedValue({ items: [orderWithMethod, mockOrder], total: 2 });
      fulfillmentRouting.resolveBatch.mockResolvedValue([
        { processorKind: 'omp_fulfilled', processorConnectionId: null, source: 'default' },
      ]);
      deliveryRider.resolveBatch.mockResolvedValue([
        { rider: 'unmapped', candidateCarrier: { platformType: 'inpost', displayName: 'InPost' } },
      ]);

      const result = await controller.listOrders({ limit: 20, offset: 0 });

      expect(deliveryRider.resolveBatch).toHaveBeenCalledWith([
        {
          sourceConnectionId: 'conn-source-001',
          sourceDeliveryMethod: { name: 'Allegro Paczkomat InPost', typeId: 'ai-inpost-1' },
          resolutionSource: 'default',
        },
      ]);
      expect(result.items[0].deliveryRider).toEqual({
        rider: 'unmapped',
        candidateCarrier: { platformType: 'inpost', displayName: 'InPost' },
      });
      // Typed source-method projection (#1791/#1792) for the #1794 deep link.
      expect(result.items[0].sourceDeliveryMethodId).toBe('ai-inpost-1');
      expect(result.items[0].sourceDeliveryMethodName).toBe('Allegro Paczkomat InPost');
      // No method on mockOrder → no rider attached; method fields null.
      expect(result.items[1].deliveryRider).toBeUndefined();
      expect(result.items[1].sourceDeliveryMethodId).toBeNull();
      expect(result.items[1].sourceDeliveryMethodName).toBeNull();
    });

    it('should omit candidateCarrier from the rider DTO when the rider is "none" (#1792)', async () => {
      const orderWithMethod = new OrderRecord(
        'ol_order_rider_none',
        null,
        'conn-source-001',
        null,
        { shipping: { methodId: 'courier-1', methodName: 'Kurier standardowy' } },
        [],
        'ready',
        new Date('2026-04-01T00:00:00Z'),
        new Date('2026-04-01T00:00:00Z')
      );
      repository.findMany.mockResolvedValue({ items: [orderWithMethod], total: 1 });
      fulfillmentRouting.resolveBatch.mockResolvedValue([
        { processorKind: 'omp_fulfilled', processorConnectionId: null, source: 'default' },
      ]);
      deliveryRider.resolveBatch.mockResolvedValue([{ rider: 'none' }]);

      const result = await controller.listOrders({ limit: 20, offset: 0 });

      expect(result.items[0].deliveryRider).toEqual({ rider: 'none' });
      expect(result.items[0].deliveryRider).not.toHaveProperty('candidateCarrier');
    });
  });

  describe('statusSummary', () => {
    it('should return per-health-bucket counts from the repository (#929)', async () => {
      repository.countByHealth.mockResolvedValue({
        total: 11,
        awaitingMapping: 0,
        needsAttention: 1,
        synced: 1,
        awaitingDispatch: 9,
      });

      const result = await controller.statusSummary({});

      expect(result.total).toBe(11);
      expect(result.needsAttention).toBe(1);
      expect(result.awaitingDispatch).toBe(9);
    });

    it('should forward only the scope subset (source/date) to the repository (#929)', async () => {
      repository.countByHealth.mockResolvedValue({
        total: 0,
        awaitingMapping: 0,
        needsAttention: 0,
        synced: 0,
        awaitingDispatch: 0,
      });

      await controller.statusSummary({
        sourceConnectionId: 'conn-001',
        createdFrom: '2026-01-01T00:00:00Z',
      });

      expect(repository.countByHealth).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceConnectionId: 'conn-001',
          createdFrom: new Date('2026-01-01T00:00:00Z'),
        })
      );
    });
  });

  describe('getOrder', () => {
    it('should return order record when found', async () => {
      repository.findById.mockResolvedValue(mockOrder);

      const result = await controller.getOrder('ol_order_001');

      expect(result.internalOrderId).toBe('ol_order_001');
      expect(result.customerId).toBe('ol_customer_001');
      expect(result.sourceConnectionId).toBe('conn-source-001');
      expect(result.orderSnapshot).toEqual({ externalOrderId: 'EXT-123', items: [] });
    });

    it('should throw NotFoundException when order not found', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(controller.getOrder('ol_order_999')).rejects.toThrow(NotFoundException);
    });

    it('should merge a neutral invoice projection into the snapshot when a record exists (#1224)', async () => {
      repository.findById.mockResolvedValue(mockOrder);
      invoiceService.getLatestInvoiceForOrder.mockResolvedValue(
        new InvoiceRecord(
          'rec-inv-1',
          'conn-ksef-1',
          'ol_order_001',
          'ksef',
          'invoice',
          'issued',
          'SESSION:INVOICE',
          null,
          'accepted',
          '5265877635-20250826-0100001AF629-AF',
          null,
          null,
          new Date('2026-04-01T12:00:00Z'),
          null,
          new Date('2026-04-01T12:00:00Z'),
          new Date('2026-04-01T12:00:00Z')
        )
      );

      const result = await controller.getOrder('ol_order_001');

      expect(result.orderSnapshot.invoice).toEqual({
        invoiceId: 'rec-inv-1',
        documentType: 'invoice',
        status: 'issued',
        regulatoryStatus: 'accepted',
        clearanceReference: '5265877635-20250826-0100001AF629-AF',
        confirmationDocumentAvailable: true,
      });
    });

    it('should set confirmationDocumentAvailable false when the invoice is not yet cleared (#1224)', async () => {
      repository.findById.mockResolvedValue(mockOrder);
      invoiceService.getLatestInvoiceForOrder.mockResolvedValue(
        new InvoiceRecord(
          'rec-inv-2',
          'conn-ksef-1',
          'ol_order_001',
          'ksef',
          'invoice',
          'issued',
          'SESSION:INVOICE',
          null,
          'submitted',
          null,
          null,
          null,
          new Date('2026-04-01T12:00:00Z'),
          null,
          new Date('2026-04-01T12:00:00Z'),
          new Date('2026-04-01T12:00:00Z')
        )
      );

      const result = await controller.getOrder('ol_order_001');

      expect(result.orderSnapshot.invoice).toMatchObject({
        invoiceId: 'rec-inv-2',
        regulatoryStatus: 'submitted',
        confirmationDocumentAvailable: false,
      });
    });

    it('should leave the snapshot untouched when no invoice record exists', async () => {
      repository.findById.mockResolvedValue(mockOrder);
      invoiceService.getLatestInvoiceForOrder.mockResolvedValue(null);

      const result = await controller.getOrder('ol_order_001');

      expect(result.orderSnapshot).toEqual({ externalOrderId: 'EXT-123', items: [] });
    });

    it('should attach deliveryResolution when the order carries a source delivery method (#1791)', async () => {
      const orderWithMethod = new OrderRecord(
        'ol_order_shipped',
        null,
        'conn-source-001',
        null,
        { shipping: { methodId: 'courier-standard' } },
        [],
        'ready',
        new Date('2026-04-01T00:00:00Z'),
        new Date('2026-04-01T00:00:00Z')
      );
      repository.findById.mockResolvedValue(orderWithMethod);
      fulfillmentRouting.resolve.mockResolvedValue({
        processorKind: 'omp_fulfilled',
        processorConnectionId: null,
        source: 'default',
      });

      const result = await controller.getOrder('ol_order_shipped');

      expect(fulfillmentRouting.resolve).toHaveBeenCalledWith({
        sourceConnectionId: 'conn-source-001',
        sourceDeliveryMethodId: 'courier-standard',
      });
      expect(result.deliveryResolution).toEqual({
        source: 'default',
        processorKind: 'omp_fulfilled',
        processorConnectionId: null,
      });
    });

    it('should leave deliveryResolution absent when the order carries no delivery method (#1791)', async () => {
      repository.findById.mockResolvedValue(mockOrder);

      const result = await controller.getOrder('ol_order_001');

      expect(fulfillmentRouting.resolve).not.toHaveBeenCalled();
      expect(result.deliveryResolution).toBeUndefined();
    });

    it('should attach the delivery rider on detail, built from the routing source + snapshot method (#1792)', async () => {
      const orderWithMethod = new OrderRecord(
        'ol_order_rider_detail',
        null,
        'conn-source-001',
        null,
        { shipping: { methodId: 'dpd-1', methodName: 'Kurier DPD' } },
        [],
        'ready',
        new Date('2026-04-01T00:00:00Z'),
        new Date('2026-04-01T00:00:00Z')
      );
      repository.findById.mockResolvedValue(orderWithMethod);
      fulfillmentRouting.resolve.mockResolvedValue({
        processorKind: 'omp_fulfilled',
        processorConnectionId: null,
        source: 'default',
      });
      deliveryRider.resolve.mockResolvedValue({
        rider: 'not-connected',
        candidateCarrier: { platformType: 'dpd', displayName: 'DPD' },
      });

      const result = await controller.getOrder('ol_order_rider_detail');

      expect(deliveryRider.resolve).toHaveBeenCalledWith({
        sourceConnectionId: 'conn-source-001',
        sourceDeliveryMethod: { name: 'Kurier DPD', typeId: 'dpd-1' },
        resolutionSource: 'default',
      });
      expect(result.deliveryRider).toEqual({
        rider: 'not-connected',
        candidateCarrier: { platformType: 'dpd', displayName: 'DPD' },
      });
    });

    it('should not compute a rider when the order carries no delivery method (#1792)', async () => {
      repository.findById.mockResolvedValue(mockOrder);

      const result = await controller.getOrder('ol_order_001');

      expect(deliveryRider.resolve).not.toHaveBeenCalled();
      expect(result.deliveryRider).toBeUndefined();
    });
  });

  describe('retryDestination', () => {
    const internalOrderId = 'ol_order_001';
    const connectionId = '0aa1c2e0-1234-4abc-8def-0123456789ab';

    it('should return job id and types on success (202)', async () => {
      retryService.retry.mockResolvedValue({
        jobId: 'job-new',
        jobType: 'marketplace.order.sync',
      });

      const result = await controller.retryDestination(internalOrderId, connectionId);

      expect(result).toEqual({
        internalOrderId,
        destinationConnectionId: connectionId,
        jobId: 'job-new',
        jobType: 'marketplace.order.sync',
      });
      expect(retryService.retry).toHaveBeenCalledWith({
        internalOrderId,
        destinationConnectionId: connectionId,
      });
    });

    it('should map OrderRecordNotFoundException to NotFoundException (404)', async () => {
      retryService.retry.mockRejectedValue(new OrderRecordNotFoundException(internalOrderId));

      await expect(
        controller.retryDestination(internalOrderId, connectionId)
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('should map OrderDestinationNotFoundException to NotFoundException (404)', async () => {
      retryService.retry.mockRejectedValue(
        new OrderDestinationNotFoundException(internalOrderId, connectionId)
      );

      await expect(
        controller.retryDestination(internalOrderId, connectionId)
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('should map OrderDestinationNotRetryableException to ConflictException (409)', async () => {
      retryService.retry.mockRejectedValue(
        new OrderDestinationNotRetryableException(internalOrderId, connectionId, 'synced')
      );

      await expect(
        controller.retryDestination(internalOrderId, connectionId)
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('should map MissingSourceExternalIdException to InternalServerErrorException (500)', async () => {
      retryService.retry.mockRejectedValue(
        new MissingSourceExternalIdException(internalOrderId, 'conn-source-001')
      );

      await expect(
        controller.retryDestination(internalOrderId, connectionId)
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });
});

/**
 * Allegro Order Sync Handler Tests
 *
 * Unit tests for AllegroOrderSyncHandler. Tests order fetching,
 * adapter resolution, and error handling.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import { AllegroOrderSyncHandler } from '../allegro-order-sync.handler';
import { IIntegrationsService } from '@openlinker/core/integrations/application/interfaces/integrations.service.interface';
import { SyncJob } from '@openlinker/core/sync/domain/entities/sync-job.entity';
import { MarketplaceIntegrationPort } from '@openlinker/core/listings';
import { AllegroOrderSyncByCheckoutFormIdPayload } from '@openlinker/core/sync/domain/types/allegro-job-payloads.types';
import { SyncJobExecutionError } from '@openlinker/core/sync/domain/exceptions/sync-job-execution.error';
import {
  AllegroAuthenticationException,
  AllegroRateLimitException,
  AllegroApiException,
} from '@openlinker/integrations-allegro';
import { Order, IOrderSyncService } from '@openlinker/core/orders';

describe('AllegroOrderSyncHandler', () => {
  let handler: AllegroOrderSyncHandler;
  let integrationsService: jest.Mocked<IIntegrationsService>;
  let orderSyncService: jest.Mocked<IOrderSyncService>;
  let marketplaceAdapter: jest.Mocked<MarketplaceIntegrationPort>;

  const connectionId = 'connection-123';
  const jobId = 'job-123';

  beforeEach(() => {
    marketplaceAdapter = {
      getOrders: jest.fn(),
      getOrderByCheckoutFormId: jest.fn(),
      updateOfferQuantity: jest.fn(),
    } as unknown as jest.Mocked<MarketplaceIntegrationPort>;

    integrationsService = {
      getCapabilityAdapter: jest.fn().mockResolvedValue(marketplaceAdapter),
      listCapabilityAdapters: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;

    orderSyncService = {
      syncOrder: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<IOrderSyncService>;

    handler = new AllegroOrderSyncHandler(integrationsService, orderSyncService);
  });

  describe('execute', () => {
    const createJob = (payload: AllegroOrderSyncByCheckoutFormIdPayload): SyncJob => ({
      id: jobId,
      jobType: 'allegro.order.syncByCheckoutFormId',
      connectionId,
      payload: payload as unknown as Record<string, unknown>,
      idempotencyKey: 'idempotency-key-123',
      status: 'queued',
      attempts: 0,
      maxAttempts: 3,
      nextRunAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    it('should fetch order successfully', async () => {
      const payload: AllegroOrderSyncByCheckoutFormIdPayload = {
        checkoutFormId: 'checkout-1',
        eventId: 'event-1',
      };

      const job = createJob(payload);

      const mockOrder: Order = {
        id: 'ol_order_123',
        orderNumber: 'checkout-1',
        status: 'processing',
        customerId: 'ol_customer_456',
        items: [],
        totals: {
          subtotal: 100,
          tax: 0,
          shipping: 0,
          total: 100,
          currency: 'PLN',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      marketplaceAdapter.getOrderByCheckoutFormId.mockResolvedValue(mockOrder);

      await handler.execute(job);

      expect(marketplaceAdapter.getOrderByCheckoutFormId).toHaveBeenCalledWith('checkout-1');
    });

    it('should throw SyncJobExecutionError on authentication failure', async () => {
      const payload: AllegroOrderSyncByCheckoutFormIdPayload = {
        checkoutFormId: 'checkout-1',
        eventId: 'event-1',
      };

      const job = createJob(payload);

      marketplaceAdapter.getOrderByCheckoutFormId.mockRejectedValue(
        new AllegroAuthenticationException('Invalid token', 401),
      );

      await expect(handler.execute(job)).rejects.toThrow(SyncJobExecutionError);
    });

    it('should throw SyncJobExecutionError on rate limit', async () => {
      const payload: AllegroOrderSyncByCheckoutFormIdPayload = {
        checkoutFormId: 'checkout-1',
        eventId: 'event-1',
      };

      const job = createJob(payload);

      marketplaceAdapter.getOrderByCheckoutFormId.mockRejectedValue(
        new AllegroRateLimitException('Rate limit exceeded', 5000),
      );

      await expect(handler.execute(job)).rejects.toThrow(SyncJobExecutionError);
    });

    it('should throw SyncJobExecutionError on API errors', async () => {
      const payload: AllegroOrderSyncByCheckoutFormIdPayload = {
        checkoutFormId: 'checkout-1',
        eventId: 'event-1',
      };

      const job = createJob(payload);

      marketplaceAdapter.getOrderByCheckoutFormId.mockRejectedValue(
        new AllegroApiException('Order not found', 404, 'Not found'),
      );

      await expect(handler.execute(job)).rejects.toThrow(SyncJobExecutionError);
    });

    it('should throw SyncJobExecutionError on missing payload', async () => {
      const job = createJob({} as AllegroOrderSyncByCheckoutFormIdPayload);

      await expect(handler.execute(job)).rejects.toThrow(SyncJobExecutionError);
    });

    it('should throw SyncJobExecutionError on invalid checkoutFormId', async () => {
      const job = createJob({
        checkoutFormId: '',
        eventId: 'event-1',
      } as AllegroOrderSyncByCheckoutFormIdPayload);

      await expect(handler.execute(job)).rejects.toThrow(SyncJobExecutionError);
    });

    it('should throw SyncJobExecutionError on invalid eventId', async () => {
      const job = createJob({
        checkoutFormId: 'checkout-1',
        eventId: '',
      } as AllegroOrderSyncByCheckoutFormIdPayload);

      await expect(handler.execute(job)).rejects.toThrow(SyncJobExecutionError);
    });
  });
});




/**
 * Allegro Orders Poll Handler Tests
 *
 * Unit tests for AllegroOrdersPollHandler. Tests order event polling,
 * cursor management, job enqueueing, and error handling.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import { AllegroOrdersPollHandler } from '../allegro-orders-poll.handler';
import { IIntegrationsService } from '@openlinker/core/integrations/application/interfaces/integrations.service.interface';
import { ConnectionCursorRepositoryPort } from '@openlinker/core/sync/domain/ports/connection-cursor-repository.port';
import { JobEnqueuePort } from '@openlinker/core/sync/domain/ports/job-enqueue.port';
import { SyncJob } from '@openlinker/core/sync/domain/entities/sync-job.entity';
import { MarketplaceIntegrationPort } from '@openlinker/core/listings';
import { AllegroOrdersPollPayload } from '@openlinker/core/sync/domain/types/allegro-job-payloads.types';
import { SyncJobExecutionError } from '@openlinker/core/sync/domain/exceptions/sync-job-execution.error';
import {
  AllegroAuthenticationException,
  AllegroRateLimitException,
  AllegroApiException,
} from '@openlinker/integrations-allegro';

describe('AllegroOrdersPollHandler', () => {
  let handler: AllegroOrdersPollHandler;
  let integrationsService: jest.Mocked<IIntegrationsService>;
  let cursorRepository: jest.Mocked<ConnectionCursorRepositoryPort>;
  let jobEnqueue: jest.Mocked<JobEnqueuePort>;
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

    cursorRepository = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<ConnectionCursorRepositoryPort>;

    jobEnqueue = {
      enqueueJob: jest.fn(),
    } as unknown as jest.Mocked<JobEnqueuePort>;

    handler = new AllegroOrdersPollHandler(integrationsService, cursorRepository, jobEnqueue);
  });

  describe('execute', () => {
    const createJob = (payload: AllegroOrdersPollPayload): SyncJob => ({
      id: jobId,
      jobType: 'allegro.orders.poll',
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

    it('should poll orders and enqueue sync jobs successfully', async () => {
      const payload: AllegroOrdersPollPayload = {
        cursorKey: 'allegro.orders.lastEventId',
        limit: 10,
      };

      const job = createJob(payload);

      cursorRepository.get.mockResolvedValue('event-100');
      marketplaceAdapter.getOrders.mockResolvedValue({
        items: [
          { eventId: 'event-101', checkoutFormId: 'checkout-1' },
          { eventId: 'event-102', checkoutFormId: 'checkout-2' },
        ],
        nextCursor: 'event-102',
      });
      jobEnqueue.enqueueJob.mockResolvedValue('job-1').mockResolvedValueOnce('job-2');

      await handler.execute(job);

      expect(cursorRepository.get).toHaveBeenCalledWith(connectionId, 'allegro.orders.lastEventId');
      expect(marketplaceAdapter.getOrders).toHaveBeenCalledWith({
        cursor: 'event-100',
        limit: 10,
      });
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(2);
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith({
        jobType: 'allegro.order.syncByCheckoutFormId',
        connectionId,
        payload: {
          checkoutFormId: 'checkout-1',
          eventId: 'event-101',
        },
        idempotencyKey: `allegro:${connectionId}:event-101`,
      });
      expect(cursorRepository.set).toHaveBeenCalledWith(connectionId, 'allegro.orders.lastEventId', 'event-102');
    });

    it('should handle first poll (no cursor)', async () => {
      const payload: AllegroOrdersPollPayload = {
        cursorKey: 'allegro.orders.lastEventId',
      };

      const job = createJob(payload);

      cursorRepository.get.mockResolvedValue(null);
      marketplaceAdapter.getOrders.mockResolvedValue({
        items: [{ eventId: 'event-1', checkoutFormId: 'checkout-1' }],
        nextCursor: 'event-1',
      });
      jobEnqueue.enqueueJob.mockResolvedValue('job-1');

      await handler.execute(job);

      expect(marketplaceAdapter.getOrders).toHaveBeenCalledWith({
        cursor: undefined,
        limit: undefined,
      });
      expect(cursorRepository.set).toHaveBeenCalledWith(connectionId, 'allegro.orders.lastEventId', 'event-1');
    });

    it('should handle empty feed response', async () => {
      const payload: AllegroOrdersPollPayload = {
        cursorKey: 'allegro.orders.lastEventId',
      };

      const job = createJob(payload);

      cursorRepository.get.mockResolvedValue('event-100');
      marketplaceAdapter.getOrders.mockResolvedValue({
        items: [],
        nextCursor: 'event-100',
      });

      await handler.execute(job);

      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
      expect(cursorRepository.set).toHaveBeenCalledWith(connectionId, 'allegro.orders.lastEventId', 'event-100');
    });

    it('should not update cursor if enqueue fails', async () => {
      const payload: AllegroOrdersPollPayload = {
        cursorKey: 'allegro.orders.lastEventId',
      };

      const job = createJob(payload);

      cursorRepository.get.mockResolvedValue('event-100');
      marketplaceAdapter.getOrders.mockResolvedValue({
        items: [{ eventId: 'event-101', checkoutFormId: 'checkout-1' }],
        nextCursor: 'event-101',
      });
      jobEnqueue.enqueueJob.mockRejectedValue(new Error('Enqueue failed'));

      await expect(handler.execute(job)).rejects.toThrow(SyncJobExecutionError);

      expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(1);
      expect(cursorRepository.set).not.toHaveBeenCalled(); // Cursor not updated on failure
    });

    it('should throw SyncJobExecutionError on authentication failure', async () => {
      const payload: AllegroOrdersPollPayload = {
        cursorKey: 'allegro.orders.lastEventId',
      };

      const job = createJob(payload);

      cursorRepository.get.mockResolvedValue(null);
      marketplaceAdapter.getOrders.mockRejectedValue(
        new AllegroAuthenticationException('Invalid token', 401),
      );

      await expect(handler.execute(job)).rejects.toThrow(SyncJobExecutionError);
      expect(cursorRepository.set).not.toHaveBeenCalled();
    });

    it('should throw SyncJobExecutionError on rate limit', async () => {
      const payload: AllegroOrdersPollPayload = {
        cursorKey: 'allegro.orders.lastEventId',
      };

      const job = createJob(payload);

      cursorRepository.get.mockResolvedValue(null);
      marketplaceAdapter.getOrders.mockRejectedValue(
        new AllegroRateLimitException('Rate limit exceeded', 5000),
      );

      await expect(handler.execute(job)).rejects.toThrow(SyncJobExecutionError);
    });

    it('should throw SyncJobExecutionError on API errors', async () => {
      const payload: AllegroOrdersPollPayload = {
        cursorKey: 'allegro.orders.lastEventId',
      };

      const job = createJob(payload);

      cursorRepository.get.mockResolvedValue(null);
      marketplaceAdapter.getOrders.mockRejectedValue(
        new AllegroApiException('API error', 500, 'Error body'),
      );

      await expect(handler.execute(job)).rejects.toThrow(SyncJobExecutionError);
    });

    it('should throw SyncJobExecutionError on missing payload', async () => {
      const job = createJob({} as AllegroOrdersPollPayload);

      await expect(handler.execute(job)).rejects.toThrow(SyncJobExecutionError);
    });

    it('should throw SyncJobExecutionError on invalid cursorKey', async () => {
      const job = createJob({ cursorKey: '' } as AllegroOrdersPollPayload);

      await expect(handler.execute(job)).rejects.toThrow(SyncJobExecutionError);
    });
  });
});



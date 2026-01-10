/**
 * Allegro Offer Quantity Update Handler Tests
 *
 * Unit tests for AllegroOfferQuantityUpdateHandler. Tests offer quantity
 * updates, command status handling, and error handling.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import { AllegroOfferQuantityUpdateHandler } from '../allegro-offer-quantity-update.handler';
import { IIntegrationsService } from '@openlinker/core/integrations/application/interfaces/integrations.service.interface';
import { SyncJob } from '@openlinker/core/sync/domain/entities/sync-job.entity';
import { MarketplaceIntegrationPort } from '@openlinker/core/listings';
import { AllegroOfferQuantityUpdatePayload } from '@openlinker/core/sync/domain/types/allegro-job-payloads.types';
import { SyncJobExecutionError } from '@openlinker/core/sync/domain/exceptions/sync-job-execution.error';
import {
  AllegroAuthenticationException,
  AllegroRateLimitException,
  AllegroApiException,
  AllegroQuantityCommandRepositoryPort,
} from '@openlinker/integrations-allegro';

describe('AllegroOfferQuantityUpdateHandler', () => {
  let handler: AllegroOfferQuantityUpdateHandler;
  let integrationsService: jest.Mocked<IIntegrationsService>;
  let commandRepository: jest.Mocked<AllegroQuantityCommandRepositoryPort>;
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

    commandRepository = {
      findByCommandId: jest.fn(),
      create: jest.fn(),
      find: jest.fn(),
      updateStatus: jest.fn(),
    } as unknown as jest.Mocked<AllegroQuantityCommandRepositoryPort>;

    handler = new AllegroOfferQuantityUpdateHandler(integrationsService, commandRepository);
  });

  describe('execute', () => {
    const createJob = (payload: AllegroOfferQuantityUpdatePayload): SyncJob => ({
      id: jobId,
      jobType: 'allegro.offerQuantity.update',
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

    it('should update offer quantity successfully', async () => {
      const payload: AllegroOfferQuantityUpdatePayload = {
        offerId: 'offer-1',
        quantity: 10,
        idempotencyKey: 'idempotency-key-123',
      };

      const job = createJob(payload);

      marketplaceAdapter.updateOfferQuantity.mockResolvedValue({
        commandId: 'command-123',
        status: 'accepted',
      });

      await handler.execute(job);

      expect(marketplaceAdapter.updateOfferQuantity).toHaveBeenCalledWith({
        offerId: 'offer-1',
        quantity: 10,
        idempotencyKey: 'idempotency-key-123',
      });
    });

    it('should handle queued status', async () => {
      const payload: AllegroOfferQuantityUpdatePayload = {
        offerId: 'offer-1',
        quantity: 10,
        idempotencyKey: 'idempotency-key-123',
      };

      const job = createJob(payload);

      marketplaceAdapter.updateOfferQuantity.mockResolvedValue({
        commandId: 'command-123',
        status: 'queued',
      });

      await handler.execute(job);

      // Should not throw - queued is acceptable
    });

    it('should throw SyncJobExecutionError on rejected status', async () => {
      const payload: AllegroOfferQuantityUpdatePayload = {
        offerId: 'offer-1',
        quantity: 10,
        idempotencyKey: 'idempotency-key-123',
      };

      const job = createJob(payload);

      marketplaceAdapter.updateOfferQuantity.mockResolvedValue({
        commandId: 'command-123',
        status: 'rejected',
      });

      await expect(handler.execute(job)).rejects.toThrow(SyncJobExecutionError);
    });

    it('should throw SyncJobExecutionError on authentication failure', async () => {
      const payload: AllegroOfferQuantityUpdatePayload = {
        offerId: 'offer-1',
        quantity: 10,
        idempotencyKey: 'idempotency-key-123',
      };

      const job = createJob(payload);

      marketplaceAdapter.updateOfferQuantity.mockRejectedValue(
        new AllegroAuthenticationException('Invalid token', 401),
      );

      await expect(handler.execute(job)).rejects.toThrow(SyncJobExecutionError);
    });

    it('should throw SyncJobExecutionError on rate limit', async () => {
      const payload: AllegroOfferQuantityUpdatePayload = {
        offerId: 'offer-1',
        quantity: 10,
        idempotencyKey: 'idempotency-key-123',
      };

      const job = createJob(payload);

      marketplaceAdapter.updateOfferQuantity.mockRejectedValue(
        new AllegroRateLimitException('Rate limit exceeded', 5000),
      );

      await expect(handler.execute(job)).rejects.toThrow(SyncJobExecutionError);
    });

    it('should throw SyncJobExecutionError on API errors', async () => {
      const payload: AllegroOfferQuantityUpdatePayload = {
        offerId: 'offer-1',
        quantity: 10,
        idempotencyKey: 'idempotency-key-123',
      };

      const job = createJob(payload);

      marketplaceAdapter.updateOfferQuantity.mockRejectedValue(
        new AllegroApiException('Offer not found', 404, 'Not found'),
      );

      await expect(handler.execute(job)).rejects.toThrow(SyncJobExecutionError);
    });

    it('should throw SyncJobExecutionError on missing payload', async () => {
      const job = createJob({} as AllegroOfferQuantityUpdatePayload);

      await expect(handler.execute(job)).rejects.toThrow(SyncJobExecutionError);
    });

    it('should throw SyncJobExecutionError on invalid offerId', async () => {
      const job = createJob({
        offerId: '',
        quantity: 10,
        idempotencyKey: 'idempotency-key-123',
      } as AllegroOfferQuantityUpdatePayload);

      await expect(handler.execute(job)).rejects.toThrow(SyncJobExecutionError);
    });

    it('should throw SyncJobExecutionError on invalid quantity', async () => {
      const job = createJob({
        offerId: 'offer-1',
        quantity: null as unknown as number,
        idempotencyKey: 'idempotency-key-123',
      } as AllegroOfferQuantityUpdatePayload);

      await expect(handler.execute(job)).rejects.toThrow(SyncJobExecutionError);
    });

    it('should throw SyncJobExecutionError on invalid idempotencyKey', async () => {
      const job = createJob({
        offerId: 'offer-1',
        quantity: 10,
        idempotencyKey: '',
      } as AllegroOfferQuantityUpdatePayload);

      await expect(handler.execute(job)).rejects.toThrow(SyncJobExecutionError);
    });
  });
});




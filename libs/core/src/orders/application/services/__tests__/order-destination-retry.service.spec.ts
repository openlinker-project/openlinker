/**
 * Order Destination Retry Service Tests
 *
 * Unit tests for OrderDestinationRetryService. Covers happy path, all 4xx
 * branches, and the revert-on-enqueue-failure path.
 *
 * @module libs/core/src/orders/application/services/__tests__
 */
import { OrderDestinationRetryService } from '../order-destination-retry.service';
import type { OrderRecordRepositoryPort } from '../../../domain/ports/order-record-repository.port';
import type { IOrderRecordService } from '../../interfaces/order-record.service.interface';
import type { IIdentifierMappingService } from '@openlinker/core/identifier-mapping';
import type { JobEnqueuePort } from '@openlinker/core/sync';
import type { OrderSyncStatus } from '../../../domain/entities/order-record.entity';
import { OrderRecord } from '../../../domain/entities/order-record.entity';
import { OrderRecordNotFoundException } from '../../../domain/exceptions/order-record-not-found.exception';
import { OrderDestinationNotFoundException } from '../../../domain/exceptions/order-destination-not-found.exception';
import { OrderDestinationNotRetryableException } from '../../../domain/exceptions/order-destination-not-retryable.exception';
import { MissingSourceExternalIdException } from '../../../domain/exceptions/missing-source-external-id.exception';

describe('OrderDestinationRetryService', () => {
  let service: OrderDestinationRetryService;
  let orderRepo: jest.Mocked<OrderRecordRepositoryPort>;
  let recordService: jest.Mocked<IOrderRecordService>;
  let identifierMapping: jest.Mocked<IIdentifierMappingService>;
  let jobEnqueue: jest.Mocked<JobEnqueuePort>;

  const INTERNAL_ORDER_ID = 'ol_order_123';
  const SOURCE_CONN = 'conn-source';
  const DEST_CONN = 'conn-dest';
  const SOURCE_EVENT_ID = 'evt-99';
  const SOURCE_EXTERNAL_ID = 'ext-order-1';

  const failedRow: OrderSyncStatus = {
    destinationConnectionId: DEST_CONN,
    status: 'failed',
    error: 'PrestaShop country PL not active',
  };

  const buildOrder = (rows: OrderSyncStatus[] = [failedRow]): OrderRecord =>
    new OrderRecord(
      INTERNAL_ORDER_ID,
      'ol_customer_1',
      SOURCE_CONN,
      SOURCE_EVENT_ID,
      {},
      rows,
      'ready',
      new Date(),
      new Date()
    );

  beforeEach(() => {
    orderRepo = {
      findById: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      updateSyncStatus: jest.fn(),
    } as unknown as jest.Mocked<OrderRecordRepositoryPort>;

    recordService = {
      persistOrder: jest.fn(),
      updateSyncStatus: jest.fn().mockResolvedValue(undefined),
      persistIncomingSnapshot: jest.fn(),
      getOrderRecord: jest.fn(),
    } as unknown as jest.Mocked<IOrderRecordService>;

    identifierMapping = {
      getOrCreateInternalId: jest.fn(),
      getInternalId: jest.fn(),
      getExternalIds: jest.fn(),
      createMapping: jest.fn(),
      batchGetOrCreateInternalIds: jest.fn(),
    } as unknown as jest.Mocked<IIdentifierMappingService>;

    jobEnqueue = {
      enqueueJob: jest.fn(),
    } as unknown as jest.Mocked<JobEnqueuePort>;

    service = new OrderDestinationRetryService(
      orderRepo,
      recordService,
      identifierMapping,
      jobEnqueue
    );
  });

  describe('retry', () => {
    it('should claim slot, enqueue, and return job id on the happy path', async () => {
      orderRepo.findById.mockResolvedValue(buildOrder());
      identifierMapping.getExternalIds.mockResolvedValue([
        {
          externalId: SOURCE_EXTERNAL_ID,
          platformType: 'allegro',
          connectionId: SOURCE_CONN,
          entityType: 'Order',
        },
      ]);
      jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'job-new', isExisting: false });

      const result = await service.retry({
        internalOrderId: INTERNAL_ORDER_ID,
        destinationConnectionId: DEST_CONN,
      });

      expect(result).toEqual({ jobId: 'job-new', jobType: 'marketplace.order.sync' });

      // Slot was claimed before enqueue
      expect(recordService.updateSyncStatus).toHaveBeenCalledTimes(1);
      expect(recordService.updateSyncStatus).toHaveBeenCalledWith(INTERNAL_ORDER_ID, DEST_CONN, {
        destinationConnectionId: DEST_CONN,
        status: 'pending',
      });

      // Enqueued for the source connection (not the destination) with the right payload
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(1);
      const [req] = jobEnqueue.enqueueJob.mock.calls[0];
      expect(req.jobType).toBe('marketplace.order.sync');
      expect(req.connectionId).toBe(SOURCE_CONN);
      expect(req.payload).toMatchObject({
        schemaVersion: 1,
        externalOrderId: SOURCE_EXTERNAL_ID,
        sourceEventId: SOURCE_EVENT_ID,
      });
      expect(req.idempotencyKey).toMatch(
        new RegExp(`^marketplace:${SOURCE_CONN}:order:${SOURCE_EVENT_ID}:retry:\\d+$`)
      );
    });

    it('should throw OrderRecordNotFoundException when the order does not exist', async () => {
      orderRepo.findById.mockResolvedValue(null);

      await expect(
        service.retry({
          internalOrderId: INTERNAL_ORDER_ID,
          destinationConnectionId: DEST_CONN,
        })
      ).rejects.toBeInstanceOf(OrderRecordNotFoundException);

      expect(recordService.updateSyncStatus).not.toHaveBeenCalled();
      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    });

    it('should throw OrderDestinationNotFoundException when no syncStatus row matches', async () => {
      orderRepo.findById.mockResolvedValue(buildOrder([])); // no destinations

      await expect(
        service.retry({
          internalOrderId: INTERNAL_ORDER_ID,
          destinationConnectionId: DEST_CONN,
        })
      ).rejects.toBeInstanceOf(OrderDestinationNotFoundException);

      expect(recordService.updateSyncStatus).not.toHaveBeenCalled();
      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    });

    it.each(['pending', 'syncing', 'synced'] as const)(
      'should throw OrderDestinationNotRetryableException when status is %s',
      async (status) => {
        orderRepo.findById.mockResolvedValue(
          buildOrder([{ destinationConnectionId: DEST_CONN, status }])
        );

        await expect(
          service.retry({
            internalOrderId: INTERNAL_ORDER_ID,
            destinationConnectionId: DEST_CONN,
          })
        ).rejects.toBeInstanceOf(OrderDestinationNotRetryableException);

        expect(recordService.updateSyncStatus).not.toHaveBeenCalled();
        expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
      }
    );

    it('should throw MissingSourceExternalIdException when source mapping is absent', async () => {
      orderRepo.findById.mockResolvedValue(buildOrder());
      identifierMapping.getExternalIds.mockResolvedValue([
        // mapping for some other connection only
        {
          externalId: 'other',
          platformType: 'prestashop',
          connectionId: 'unrelated-conn',
          entityType: 'Order',
        },
      ]);

      await expect(
        service.retry({
          internalOrderId: INTERNAL_ORDER_ID,
          destinationConnectionId: DEST_CONN,
        })
      ).rejects.toBeInstanceOf(MissingSourceExternalIdException);

      expect(recordService.updateSyncStatus).not.toHaveBeenCalled();
      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    });

    it('should revert status to failed with original error preserved when enqueue fails', async () => {
      orderRepo.findById.mockResolvedValue(buildOrder());
      identifierMapping.getExternalIds.mockResolvedValue([
        {
          externalId: SOURCE_EXTERNAL_ID,
          platformType: 'allegro',
          connectionId: SOURCE_CONN,
          entityType: 'Order',
        },
      ]);
      jobEnqueue.enqueueJob.mockRejectedValue(new Error('redis down'));

      await expect(
        service.retry({
          internalOrderId: INTERNAL_ORDER_ID,
          destinationConnectionId: DEST_CONN,
        })
      ).rejects.toThrow('redis down');

      // First call: claim (failed → pending). Second call: revert (pending → failed with original error).
      expect(recordService.updateSyncStatus).toHaveBeenCalledTimes(2);
      expect(recordService.updateSyncStatus).toHaveBeenNthCalledWith(
        1,
        INTERNAL_ORDER_ID,
        DEST_CONN,
        { destinationConnectionId: DEST_CONN, status: 'pending' }
      );
      expect(recordService.updateSyncStatus).toHaveBeenNthCalledWith(
        2,
        INTERNAL_ORDER_ID,
        DEST_CONN,
        {
          destinationConnectionId: DEST_CONN,
          status: 'failed',
          error: 'PrestaShop country PL not active',
        }
      );
    });

    it('should re-throw the original enqueue error even if the revert itself fails', async () => {
      orderRepo.findById.mockResolvedValue(buildOrder());
      identifierMapping.getExternalIds.mockResolvedValue([
        {
          externalId: SOURCE_EXTERNAL_ID,
          platformType: 'allegro',
          connectionId: SOURCE_CONN,
          entityType: 'Order',
        },
      ]);
      jobEnqueue.enqueueJob.mockRejectedValue(new Error('redis down'));
      // First call succeeds (the claim), second call (revert) fails.
      recordService.updateSyncStatus
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('db connection lost'));

      await expect(
        service.retry({
          internalOrderId: INTERNAL_ORDER_ID,
          destinationConnectionId: DEST_CONN,
        })
      ).rejects.toThrow('redis down'); // original enqueue error, not the revert error

      expect(recordService.updateSyncStatus).toHaveBeenCalledTimes(2);
    });
  });
});

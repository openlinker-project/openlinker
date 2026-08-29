/**
 * Order Provisioning Resume Service — unit tests (#2341)
 *
 * The load-bearing assertion here is the LAST one: the service never throws for
 * a modelled condition. That is the contract the controller's "the release is
 * the fact" behaviour depends on, and the interface docblock states it.
 *
 * @module libs/core/src/orders/application/services/__tests__
 */
import { OrderProvisioningResumeService } from '../order-provisioning-resume.service';
import type { OrderRecordRepositoryPort } from '../../../domain/ports/order-record-repository.port';
import type { OrderRecord } from '../../../domain/entities/order-record.entity';
import type { IIdentifierMappingService } from '@openlinker/core/identifier-mapping';
import type { JobEnqueuePort } from '@openlinker/core/sync';
import type { IOrderRecordService } from '../../interfaces/order-record.service.interface';

const ORDER_ID = 'ol_order_aaa';
const SOURCE_CONNECTION = 'conn-source';

describe('OrderProvisioningResumeService (#2341)', () => {
  let service: OrderProvisioningResumeService;
  let orderRecordRepository: jest.Mocked<OrderRecordRepositoryPort>;
  let identifierMapping: jest.Mocked<IIdentifierMappingService>;
  let jobEnqueue: jest.Mocked<JobEnqueuePort>;
  let orderRecordService: jest.Mocked<IOrderRecordService>;

  // Only the three fields `resume` reads; the rest of `OrderRecord` is
  // irrelevant to this service and stubbing it whole would obscure that.
  const orderRecord = {
    internalOrderId: ORDER_ID,
    sourceConnectionId: SOURCE_CONNECTION,
    sourceEventId: 'evt-1',
    // The rows a hold withheld — the ones a failed re-enqueue strands.
    syncStatus: [
      {
        destinationConnectionId: 'dest-1',
        status: 'pending',
        error: 'Withheld: order is on hold (fraud-review)',
      },
      { destinationConnectionId: 'dest-2', status: 'synced', externalOrderId: '77' },
    ],
  } as unknown as OrderRecord;

  beforeEach(() => {
    orderRecordRepository = {
      findById: jest.fn().mockResolvedValue(orderRecord),
    } as unknown as jest.Mocked<OrderRecordRepositoryPort>;

    identifierMapping = {
      getExternalIds: jest
        .fn()
        .mockResolvedValue([
          { externalId: 'EXT-1', connectionId: SOURCE_CONNECTION },
        ]),
    } as unknown as jest.Mocked<IIdentifierMappingService>;

    jobEnqueue = {
      enqueueJob: jest.fn().mockResolvedValue({ jobId: 'job-1' }),
    } as unknown as jest.Mocked<JobEnqueuePort>;

    orderRecordService = {
      updateSyncStatus: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<IOrderRecordService>;

    service = new OrderProvisioningResumeService(
      orderRecordRepository,
      identifierMapping,
      jobEnqueue,
      orderRecordService
    );
  });

  it('should enqueue the source-side sync when the order resolves to a source mapping', async () => {
    const result = await service.resume(ORDER_ID);

    expect(result).toEqual({
      status: 'enqueued',
      jobId: 'job-1',
      jobType: 'marketplace.order.sync',
    });
    expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: 'marketplace.order.sync',
        connectionId: SOURCE_CONNECTION,
        payload: expect.objectContaining({ externalOrderId: 'EXT-1' }),
      })
    );
  });

  it('should use a hold-release-namespaced idempotency key so it never dedups against a retry wave', async () => {
    await service.resume(ORDER_ID);

    const [request] = jobEnqueue.enqueueJob.mock.calls[0];
    expect(request.idempotencyKey).toContain(':hold-release:');
    expect(request.idempotencyKey).not.toContain(':retry:');
  });

  it('should skip with order-not-found when the order record does not exist', async () => {
    orderRecordRepository.findById.mockResolvedValue(null);

    const result = await service.resume(ORDER_ID);

    expect(result).toEqual({ status: 'skipped', reason: 'order-not-found' });
    expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
  });

  it('should skip with missing-source-external-id when no mapping matches the source connection', async () => {
    identifierMapping.getExternalIds.mockResolvedValue([
      { externalId: 'EXT-OTHER', connectionId: 'a-different-connection' },
    ] as never);

    const result = await service.resume(ORDER_ID);

    expect(result).toEqual({
      status: 'skipped',
      reason: 'missing-source-external-id',
    });
    expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
  });

  it('should report a failure code and never the caught message when the enqueue throws', async () => {
    jobEnqueue.enqueueJob.mockRejectedValue(
      new Error('connect ECONNREFUSED redis://user:hunter2@10.0.0.5:6379')
    );

    const result = await service.resume(ORDER_ID);

    expect(result).toEqual({ status: 'failed', reason: 'enqueue-failed' });
    // The whole point of the code: nothing the provider wrote reaches the caller.
    expect(JSON.stringify(result)).not.toContain('hunter2');
    expect(JSON.stringify(result)).not.toContain('ECONNREFUSED');
  });

  // #2588 review I-2. A failed re-enqueue used to leave every withheld row at
  // `pending` — indistinguishable from healthy in-flight on `/orders`, and NOT
  // retryable (`OrderDestinationRetryService` refuses anything but `failed`),
  // so the remedy the API documents did not exist and the order never shipped.
  describe('stranding a failed resume (#2588 I-2)', () => {
    beforeEach(() => {
      jobEnqueue.enqueueJob.mockRejectedValue(new Error('redis down'));
    });

    it('marks the withheld destination failed, so the documented retry can reach it', async () => {
      await service.resume(ORDER_ID);

      expect(orderRecordService.updateSyncStatus).toHaveBeenCalledWith(
        ORDER_ID,
        'dest-1',
        expect.objectContaining({
          destinationConnectionId: 'dest-1',
          status: 'failed',
        })
      );
    });

    it('never touches a destination that is already provisioned', async () => {
      await service.resume(ORDER_ID);

      expect(orderRecordService.updateSyncStatus).not.toHaveBeenCalledWith(
        ORDER_ID,
        'dest-2',
        expect.anything()
      );
    });

    it('states the cause in the error the operator is shown, and leaks no provider text', async () => {
      jobEnqueue.enqueueJob.mockRejectedValue(
        new Error('connect ECONNREFUSED redis://user:hunter2@10.0.0.5:6379')
      );

      await service.resume(ORDER_ID);

      const [, , status] = orderRecordService.updateSyncStatus.mock.calls[0];
      expect(status.error).toContain('hold was released');
      expect(status.error).not.toContain('hunter2');
      expect(status.error).not.toContain('ECONNREFUSED');
    });

    it('still reports failed/enqueue-failed even when the strand-marking write itself throws', async () => {
      orderRecordService.updateSyncStatus.mockRejectedValue(new Error('db down'));

      await expect(service.resume(ORDER_ID)).resolves.toEqual({
        status: 'failed',
        reason: 'enqueue-failed',
      });
    });

    // #2588 tech-review. The strand write must not become the I-1 defect on a
    // sibling path: `resume`'s record is read BEFORE the enqueue attempt, and a
    // poll-driven ingestion can provision a destination in that window. Writing
    // `failed` from the stale snapshot would drop the synced row and take the
    // shop's own order number with it.
    it('re-reads before stranding, so a destination that reached synced in the window keeps its order number', async () => {
      orderRecordRepository.findById
        // The pre-enqueue snapshot `resume` itself reads: still withheld.
        .mockResolvedValueOnce(orderRecord)
        // The re-read inside the strand pass: a poll got there first.
        .mockResolvedValueOnce({
          internalOrderId: ORDER_ID,
          sourceConnectionId: SOURCE_CONNECTION,
          sourceEventId: 'evt-1',
          syncStatus: [
            {
              destinationConnectionId: 'dest-1',
              status: 'synced',
              externalOrderId: '12345',
              externalOrderNumber: 'PS-9981',
            },
          ],
        } as unknown as OrderRecord);

      const result = await service.resume(ORDER_ID);

      expect(result).toEqual({ status: 'failed', reason: 'enqueue-failed' });
      expect(orderRecordService.updateSyncStatus).not.toHaveBeenCalled();
    });

    it('still reports failed/enqueue-failed when the strand re-read itself throws', async () => {
      orderRecordRepository.findById
        .mockResolvedValueOnce(orderRecord)
        .mockRejectedValueOnce(new Error('db down'));

      await expect(service.resume(ORDER_ID)).resolves.toEqual({
        status: 'failed',
        reason: 'enqueue-failed',
      });
      expect(orderRecordService.updateSyncStatus).not.toHaveBeenCalled();
    });

    it('does not mark anything when the enqueue SUCCEEDS', async () => {
      jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'job-1', isExisting: false });

      await service.resume(ORDER_ID);

      expect(orderRecordService.updateSyncStatus).not.toHaveBeenCalled();
    });
  });

  it('should never throw for any modelled condition', async () => {
    orderRecordRepository.findById.mockRejectedValueOnce(
      new Error('should not be reachable')
    );
    // A repository throw is NOT modelled and is allowed to propagate; every
    // modelled arm below must resolve rather than reject.
    await expect(service.resume(ORDER_ID)).rejects.toThrow();

    orderRecordRepository.findById.mockResolvedValue(null);
    await expect(service.resume(ORDER_ID)).resolves.toMatchObject({
      status: 'skipped',
    });

    orderRecordRepository.findById.mockResolvedValue(orderRecord);
    jobEnqueue.enqueueJob.mockRejectedValue(new Error('boom'));
    await expect(service.resume(ORDER_ID)).resolves.toMatchObject({
      status: 'failed',
    });
  });
});

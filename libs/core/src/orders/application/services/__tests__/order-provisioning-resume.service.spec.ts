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

const ORDER_ID = 'ol_order_aaa';
const SOURCE_CONNECTION = 'conn-source';

describe('OrderProvisioningResumeService (#2341)', () => {
  let service: OrderProvisioningResumeService;
  let orderRecordRepository: jest.Mocked<OrderRecordRepositoryPort>;
  let identifierMapping: jest.Mocked<IIdentifierMappingService>;
  let jobEnqueue: jest.Mocked<JobEnqueuePort>;

  // Only the three fields `resume` reads; the rest of `OrderRecord` is
  // irrelevant to this service and stubbing it whole would obscure that.
  const orderRecord = {
    internalOrderId: ORDER_ID,
    sourceConnectionId: SOURCE_CONNECTION,
    sourceEventId: 'evt-1',
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

    service = new OrderProvisioningResumeService(
      orderRecordRepository,
      identifierMapping,
      jobEnqueue
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

import { SyncJobQueueService } from './sync-job-queue.service';
import type { JobEnqueuePort } from '../../domain/ports/job-enqueue.port';

describe('SyncJobQueueService', () => {
  const request = {
    type: 'marketplace.orders.import' as const,
    connectionId: 'c1',
    payload: { a: 1 },
    options: { dedupeKey: 'k1' },
  };

  let jobEnqueue: jest.Mocked<JobEnqueuePort>;
  let service: SyncJobQueueService;

  beforeEach(() => {
    jobEnqueue = { enqueueJob: jest.fn() } as jest.Mocked<JobEnqueuePort>;
    service = new SyncJobQueueService(jobEnqueue);
  });

  it('should report an existing dedupe key when enqueueDetailed hits one', async () => {
    jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'k1', isExisting: true });

    await expect(service.enqueueDetailed(request)).resolves.toEqual({
      jobId: 'k1',
      isExisting: true,
    });
    expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({ jobType: 'marketplace.orders.import', idempotencyKey: 'k1' })
    );
  });

  it('should still return plain job ids from enqueueBulk', async () => {
    jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'j9', isExisting: false });

    await expect(service.enqueueBulk([request])).resolves.toEqual(['j9']);
  });

  it('should reject a delayed enqueue when the queue cannot delay', async () => {
    await expect(
      service.enqueueDetailed({ ...request, options: { dedupeKey: 'k', delayMs: 5 } })
    ).rejects.toThrow(/Delayed enqueue not supported/);
  });
});

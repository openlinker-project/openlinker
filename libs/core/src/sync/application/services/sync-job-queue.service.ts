/**
 * Sync Job Queue Service
 *
 * Application service implementing SyncJobQueuePort by delegating to the existing
 * JobEnqueuePort (Redis Streams publisher).
 *
 * @module libs/core/src/sync/application/services
 */

import { Injectable, Inject } from '@nestjs/common';
import { JOB_ENQUEUE_TOKEN } from '../../sync.tokens';
import { JobEnqueuePort } from '../../domain/ports/job-enqueue.port';
import type { SyncJobRequest } from '../../domain/types/sync-job.types';
import type {
  EnqueueJobOutcome,
  EnqueueJobRequest,
  SyncJobQueuePort,
} from '../ports/sync-job-queue.port';

@Injectable()
export class SyncJobQueueService implements SyncJobQueuePort {
  constructor(
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort
  ) {}

  async enqueue(request: EnqueueJobRequest): Promise<string> {
    const [jobId] = await this.enqueueBulk([request]);
    return jobId;
  }

  async enqueueBulk(requests: EnqueueJobRequest[]): Promise<string[]> {
    const jobIds: string[] = [];

    for (const req of requests) {
      jobIds.push((await this.enqueueDetailed(req)).jobId);
    }

    return jobIds;
  }

  async enqueueDetailed(req: EnqueueJobRequest): Promise<EnqueueJobOutcome> {
    if (req.options.delayMs !== undefined && req.options.delayMs > 0) {
      // The current Redis-stream enqueue pipeline does not support delayed jobs.
      // Fail fast rather than silently dropping delay semantics.
      throw new Error(
        `Delayed enqueue not supported (delayMs=${req.options.delayMs}) for job type ${req.type}`
      );
    }

    const jobRequest: SyncJobRequest = {
      jobType: req.type,
      connectionId: req.connectionId,
      payload: req.payload,
      idempotencyKey: req.options.dedupeKey,
    };

    const { jobId, isExisting } = await this.jobEnqueue.enqueueJob(jobRequest);
    return { jobId, isExisting };
  }
}

/**
 * Sync Jobs Service
 *
 * Application-layer entry point for scheduling sync jobs from
 * cross-context callers (#718). The single method (`schedule`)
 * bypasses the Redis-stream enqueue path on purpose — the stream
 * backend does not support delayed delivery — and writes the job row
 * directly through `SyncJobRepositoryPort`. The worker poller
 * (`nextRunAt <= now()`) picks the row up at the requested time.
 *
 * @module libs/core/src/sync/application/services
 * @implements {ISyncJobsService}
 * @see {@link ISyncJobsService} for the contract
 * @see {@link SyncJobRepositoryPort} for the persistence port this
 *   service wraps
 */
import { Inject, Injectable } from '@nestjs/common';
import { SYNC_JOB_REPOSITORY_TOKEN } from '../../sync.tokens';
import { SyncJobRepositoryPort } from '../../domain/ports/sync-job-repository.port';
import type { SyncJob } from '../../domain/entities/sync-job.entity';
import type { ISyncJobsService } from './sync-jobs.service.interface';
import type { ScheduleJobInput } from './sync-jobs.types';

@Injectable()
export class SyncJobsService implements ISyncJobsService {
  constructor(
    @Inject(SYNC_JOB_REPOSITORY_TOKEN)
    private readonly syncJobRepository: SyncJobRepositoryPort
  ) {}

  async schedule(input: ScheduleJobInput): Promise<SyncJob> {
    return this.syncJobRepository.createIfNotExistsByIdempotencyKey(
      {
        jobType: input.jobType,
        connectionId: input.connectionId,
        payload: input.payload,
        idempotencyKey: input.idempotencyKey,
        maxAttempts: input.maxAttempts,
      },
      { runAfter: input.runAfter }
    );
  }

  async requeueDeadByIdempotencyKey(idempotencyKey: string): Promise<boolean> {
    // Single guarded UPDATE in the repo (#1585 S3): the status='dead' predicate is
    // part of the write, so overlapping recovery runs cannot both observe `dead`
    // and both requeue. Only a `dead` job needs re-driving; a queued/running one
    // re-drives itself, and an absent key is a no-op (returns false).
    //
    // CROSS-ENTITY KEY COUPLING (#1585 S4): the caller (`PendingRecoveryService`)
    // passes the INVOICE RECORD's `idempotencyKey` to re-drive its ISSUE sync job.
    // This works only because the invoice record and its `invoicing.issue` job are
    // created with the SAME key (both `invoice:{connectionId}:{orderId}` today).
    // That equality is an implicit invariant spanning the invoicing and sync
    // contexts: if either side's key format drifts, this re-drive silently no-ops
    // (returns false), leaving the record `pending` (still claimable) rather than
    // misbehaving - safe, but the coupling must be kept in lock-step.
    return this.syncJobRepository.requeueDeadByIdempotencyKey(idempotencyKey);
  }
}

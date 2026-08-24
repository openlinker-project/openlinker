/**
 * Stuck Job Recovery Service
 *
 * Periodically requeues jobs stuck in `running` longer than the lock timeout
 * — extracted from `SyncJobRunner` for the `maintenance` worker role (#2279,
 * ADR-051): recovery is fleet-level hygiene, not a property of one runner, so
 * a deployment can run job execution and maintenance on different processes.
 * Being imported by `MaintenanceModule` is the role gate; the requeue itself
 * (`requeueStuckJobs`, a conditional UPDATE on stale `lockedAt`) is idempotent
 * across replicas, so no singleton lease is needed here.
 *
 * @module apps/worker/src/maintenance
 */
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ISyncJobsService, SYNC_JOBS_SERVICE_TOKEN } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

@Injectable()
export class StuckJobRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StuckJobRecoveryService.name);
  private readonly STUCK_JOB_TIMEOUT_MINUTES = 15; // Lock timeout for stuck jobs
  private readonly STUCK_JOB_RECOVERY_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes

  private recoveryInterval: NodeJS.Timeout | null = null;

  constructor(
    // Cross-context reads go through the published service interface, never a
    // sibling context's repository port (architecture-overview § Cross-context
    // dependencies in core) — `requeueStuckJobs` was added to `ISyncJobsService`
    // for exactly this caller.
    @Inject(SYNC_JOBS_SERVICE_TOKEN)
    private readonly syncJobsService: ISyncJobsService,
    private readonly configService: ConfigService
  ) {}

  onModuleInit(): void {
    // Same disable seam the runner has (used by tests); default on.
    const enabled =
      this.configService.get<string>('WORKER_MAINTENANCE_ENABLED', 'true') !== 'false';
    if (!enabled) {
      this.logger.log('Stuck job recovery disabled via WORKER_MAINTENANCE_ENABLED=false');
      return;
    }
    this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  /**
   * Start the recovery loop (idempotent).
   *
   * @param intervalMs - Optional interval override (defaults to 5 minutes)
   */
  start(intervalMs?: number): void {
    if (this.recoveryInterval) {
      return;
    }

    const interval = intervalMs ?? this.STUCK_JOB_RECOVERY_INTERVAL_MS;
    this.recoveryInterval = setInterval(() => {
      void this.runOnce();
    }, interval);

    // Don't keep the process alive if only this interval is running.
    if (typeof this.recoveryInterval.unref === 'function') {
      this.recoveryInterval.unref();
    }

    this.logger.log(`Started stuck job recovery (checking every ${interval / 1000}s)`);
  }

  stop(): void {
    if (this.recoveryInterval) {
      clearInterval(this.recoveryInterval);
      this.recoveryInterval = null;
    }
  }

  /** One recovery pass — requeue everything stuck past the lock timeout. */
  async runOnce(): Promise<void> {
    try {
      const requeuedCount = await this.syncJobsService.requeueStuckJobs(
        this.STUCK_JOB_TIMEOUT_MINUTES
      );
      if (requeuedCount > 0) {
        this.logger.warn(`Requeued ${requeuedCount} stuck job(s)`);
      }
    } catch (error) {
      this.logger.error(
        'Error in stuck job recovery',
        error instanceof Error ? error.stack : String(error)
      );
    }
  }
}

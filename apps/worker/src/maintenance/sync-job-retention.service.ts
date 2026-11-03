/**
 * Sync Job Retention Service (#2946, D16)
 *
 * `sync_jobs` has no retention anywhere in the tree
 * (architecture-overview.md § Sync Manager) — this is that retention,
 * living in the `maintenance` worker role (ADR-051 names retention sweeps
 * as exactly this role's future work, and states the property
 * `StuckJobRecoveryService` deliberately does NOT have: "such work *does*
 * need a lease, unlike the idempotent stuck-job recovery").
 *
 * Three properties are load-bearing.
 *
 * **A positive two-value whitelist, never an exclusion list** (ADR-049 /
 * #2604's outbox-retention shape). Only `succeeded` and `dead` rows are ever
 * reachable — through `SyncJobRetentionStatus`'s TYPE, not merely by
 * convention — so `queued`/`running` rows can never be touched even if a
 * future `JobStatus` member is added.
 *
 * **Budgeted batches, never one unbounded DELETE.** Each tick deletes at
 * most `MAX_BATCHES_PER_RUN * PRUNE_BATCH_SIZE` rows per status. A backlog
 * larger than that drains across several ticks instead of holding a
 * multi-minute lock and a long-running transaction against the table every
 * other sync-job write also contends for.
 *
 * **A lease, because two replicas doing the SAME delete work is wasted
 * effort, not a correctness bug.** Unlike `requeueStuckJobs`'s single
 * conditional UPDATE (idempotent across replicas by construction), this
 * service loops several DELETE statements per tick — a `SyncLockPort` lease
 * held for the duration of one run is what keeps two `maintenance`
 * replicas from redundantly racing the same rows. The lease covers ONE
 * RUN, never a renewed leadership term, matching the bounded-sweep shape
 * (`apps/worker/src/sync/bounded-sweep.ts`) rather than
 * `SchedulerLeaseCoordinator`'s fleet-singleton renewal — a lost lock here
 * degrades to a skipped tick, not a correctness gap, so no heartbeat is
 * needed.
 *
 * Retention windows are read from Operational Settings on every tick — no
 * cache, the same `IOperationalSettingsService.resolve()` sweep handlers
 * already call inside `execute()` — so a change takes effect on the next
 * hourly tick with no worker restart.
 *
 * @module apps/worker/src/maintenance
 */
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ISyncJobsService,
  SyncLockPort,
  SYNC_JOBS_SERVICE_TOKEN,
  SYNC_LOCK_TOKEN,
} from '@openlinker/core/sync';
import {
  IOperationalSettingsService,
  OPERATIONAL_SETTINGS_SERVICE_TOKEN,
} from '@openlinker/core/operational-settings';
import { Logger } from '@openlinker/shared/logging';

/** Rows deleted per DELETE statement — one "unit" of the per-run budget. */
export const PRUNE_BATCH_SIZE = 1000;

/**
 * DELETE statements issued per status, per tick. Bounds one tick's DB work
 * to at most `MAX_BATCHES_PER_RUN * PRUNE_BATCH_SIZE` rows regardless of
 * how large the backlog is — a backlog beyond that drains across several
 * ticks, the `runBoundedSweep` precedent applied to a delete rather than an
 * enqueue.
 */
export const MAX_BATCHES_PER_RUN = 50;

/** How often the sweep ticks. Retention is hygiene, not latency-sensitive. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/** Covers one run's worth of batched deletes, never a renewed leadership term. */
const SWEEP_LOCK_TTL_MS = 20 * 60 * 1000; // 20 minutes

const SWEEP_LOCK_KEY = 'maintenance:sync-job-retention:sweep';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface SyncJobRetentionRunResult {
  readonly succeededDeleted: number;
  readonly deadDeleted: number;
  readonly succeededBudgetExhausted: boolean;
  readonly deadBudgetExhausted: boolean;
}

@Injectable()
export class SyncJobRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyncJobRetentionService.name);
  private sweepInterval: NodeJS.Timeout | null = null;

  constructor(
    @Inject(SYNC_JOBS_SERVICE_TOKEN)
    private readonly syncJobsService: ISyncJobsService,
    @Inject(OPERATIONAL_SETTINGS_SERVICE_TOKEN)
    private readonly operationalSettingsService: IOperationalSettingsService,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly syncLock: SyncLockPort,
    private readonly configService: ConfigService
  ) {}

  onModuleInit(): void {
    // Same disable seam StuckJobRecoveryService uses (used by tests); default on.
    const enabled =
      this.configService.get<string>('WORKER_MAINTENANCE_ENABLED', 'true') !== 'false';
    if (!enabled) {
      this.logger.log('Sync job retention disabled via WORKER_MAINTENANCE_ENABLED=false');
      return;
    }
    this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(intervalMs?: number): void {
    if (this.sweepInterval) {
      return;
    }
    const interval = intervalMs ?? SWEEP_INTERVAL_MS;
    this.sweepInterval = setInterval(() => {
      void this.runOnce();
    }, interval);
    if (typeof this.sweepInterval.unref === 'function') {
      this.sweepInterval.unref();
    }
    this.logger.log(`Started sync job retention sweep (checking every ${interval / 1000}s)`);
  }

  stop(): void {
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = null;
    }
  }

  /**
   * One retention pass. Never throws — a failed tick is logged and the
   * table is simply pruned less aggressively than intended until the next
   * one, which is the safe direction (a slow prune is recoverable; a table
   * that stopped receiving jobs because retention took it down is not).
   */
  async runOnce(): Promise<SyncJobRetentionRunResult | null> {
    const token = await this.syncLock.acquire(SWEEP_LOCK_KEY, SWEEP_LOCK_TTL_MS);
    if (token === null) {
      this.logger.debug('Sync job retention sweep already running elsewhere — skipping tick');
      return null;
    }

    try {
      const settings = await this.operationalSettingsService.resolve();
      const succeededCutoff = this.cutoffFromDays(settings.syncJobRetentionDays.value);
      const deadCutoff = this.cutoffFromDays(settings.syncJobDeadRetentionDays.value);

      const [succeeded, dead] = await Promise.all([
        this.pruneStatus('succeeded', succeededCutoff),
        this.pruneStatus('dead', deadCutoff),
      ]);

      const result: SyncJobRetentionRunResult = {
        succeededDeleted: succeeded.deleted,
        deadDeleted: dead.deleted,
        succeededBudgetExhausted: succeeded.budgetExhausted,
        deadBudgetExhausted: dead.budgetExhausted,
      };

      if (result.succeededDeleted > 0 || result.deadDeleted > 0) {
        this.logger.log(
          `Sync job retention: deleted ${String(result.succeededDeleted)} succeeded ` +
            `(older than ${String(settings.syncJobRetentionDays.value)}d) and ` +
            `${String(result.deadDeleted)} dead (older than ${String(settings.syncJobDeadRetentionDays.value)}d)`
        );
      }
      if (result.succeededBudgetExhausted || result.deadBudgetExhausted) {
        this.logger.warn(
          'Sync job retention: this run\'s budget was exhausted with more rows still eligible - ' +
            'the backlog will keep draining across future ticks.'
        );
      }

      return result;
    } catch (error) {
      this.logger.error(
        'Error in sync job retention sweep',
        error instanceof Error ? error.stack : String(error)
      );
      return null;
    } finally {
      await this.syncLock.release(SWEEP_LOCK_KEY, token);
    }
  }

  private cutoffFromDays(days: number): Date {
    return new Date(Date.now() - days * MS_PER_DAY);
  }

  /**
   * Deletes batches for ONE status until either nothing more is eligible or
   * this run's own budget (`MAX_BATCHES_PER_RUN`) is spent.
   */
  private async pruneStatus(
    status: 'succeeded' | 'dead',
    olderThan: Date
  ): Promise<{ deleted: number; budgetExhausted: boolean }> {
    let deleted = 0;
    for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
      const deletedInBatch = await this.syncJobsService.pruneTerminalJobs(
        status,
        olderThan,
        PRUNE_BATCH_SIZE
      );
      deleted += deletedInBatch;
      // A short batch means we reached the end of what is eligible - a full
      // batch means there MIGHT be more, so the loop continues rather than
      // stopping on the count alone.
      if (deletedInBatch < PRUNE_BATCH_SIZE) {
        return { deleted, budgetExhausted: false };
      }
    }
    return { deleted, budgetExhausted: true };
  }
}

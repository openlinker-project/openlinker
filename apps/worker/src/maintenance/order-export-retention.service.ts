/**
 * Order Export Retention Service (#3534 recovery pass, D35, mockup M5)
 *
 * `order_exports` files carry a 7-day TTL (`ORDER_EXPORT_TTL_DAYS`) enforced
 * ONLY at download time (`OrderExportsController.download` refuses an
 * expired run) — nothing ever physically freed the stored base64 blob,
 * which is the largest column on the table by a wide margin. This is that
 * sweep, in the `maintenance` worker role (ADR-051 names retention sweeps as
 * exactly this role's future work) — the `SyncJobRetentionService` (#2946)
 * shape, simplified because an export's expiry is a fixed instant already
 * stamped on the row rather than a configurable "N days after terminal"
 * window, so there is no Operational Settings read on the hot path.
 *
 * Three properties carried over from that precedent, load-bearing for the
 * same reasons there:
 *
 * **The ROW survives; only the blob is cleared.** `purgeExpiredFiles` sets
 * `file = NULL`, never deletes the row — the run stays a lightweight audit
 * record (requester, format, row count, timestamps) after its bytes are
 * gone, and a repeated sweep over an already-cleared row is a no-op rather
 * than a second delete attempt.
 *
 * **Budgeted batches, never one unbounded UPDATE.** Each tick clears at
 * most `MAX_BATCHES_PER_RUN * PURGE_BATCH_SIZE` rows. A backlog larger than
 * that drains across several ticks instead of holding a long-running
 * transaction against a table `POST /orders/export` also writes to.
 *
 * **A lease, because two replicas doing the same clear is wasted effort,
 * not a correctness bug.** The lease covers ONE RUN, never a renewed
 * leadership term (the bounded-sweep shape, not `SchedulerLeaseCoordinator`'s
 * fleet-singleton renewal) — a lost lock here degrades to a skipped tick.
 *
 * @module apps/worker/src/maintenance
 */
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ORDER_EXPORT_SERVICE_TOKEN,
  type IOrderExportService,
} from '@openlinker/core/orders';
import { SYNC_LOCK_TOKEN, type SyncLockPort } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

/** Rows cleared per UPDATE statement — one "unit" of the per-run budget. */
export const PURGE_BATCH_SIZE = 1000;

/**
 * UPDATE statements issued per tick. Bounds one tick's DB work to at most
 * `MAX_BATCHES_PER_RUN * PURGE_BATCH_SIZE` rows regardless of how large the
 * backlog is — the `SyncJobRetentionService` precedent applied to a clear
 * rather than a delete.
 */
export const MAX_BATCHES_PER_RUN = 50;

/** How often the sweep ticks. Retention is hygiene, not latency-sensitive. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/** Covers one run's worth of batched clears, never a renewed leadership term. */
const SWEEP_LOCK_TTL_MS = 20 * 60 * 1000; // 20 minutes

const SWEEP_LOCK_KEY = 'maintenance:order-export-retention:sweep';

export interface OrderExportRetentionRunResult {
  readonly cleared: number;
  readonly budgetExhausted: boolean;
}

@Injectable()
export class OrderExportRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderExportRetentionService.name);
  private sweepInterval: NodeJS.Timeout | null = null;

  constructor(
    @Inject(ORDER_EXPORT_SERVICE_TOKEN)
    private readonly exportService: IOrderExportService,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly syncLock: SyncLockPort,
    private readonly configService: ConfigService
  ) {}

  onModuleInit(): void {
    // Same disable seam StuckJobRecoveryService/SyncJobRetentionService use; default on.
    const enabled =
      this.configService.get<string>('WORKER_MAINTENANCE_ENABLED', 'true') !== 'false';
    if (!enabled) {
      this.logger.log('Order export retention disabled via WORKER_MAINTENANCE_ENABLED=false');
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
    this.logger.log(`Started order export retention sweep (checking every ${interval / 1000}s)`);
  }

  stop(): void {
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = null;
    }
  }

  /**
   * One retention pass. Never throws — a failed tick is logged and the
   * table simply keeps its expired blobs a little longer, which is the safe
   * direction (a delayed purge is recoverable; a worker crash-looping over
   * a retention bug is not).
   */
  async runOnce(): Promise<OrderExportRetentionRunResult | null> {
    const token = await this.syncLock.acquire(SWEEP_LOCK_KEY, SWEEP_LOCK_TTL_MS);
    if (token === null) {
      this.logger.debug('Order export retention sweep already running elsewhere — skipping tick');
      return null;
    }

    try {
      const now = new Date();
      let cleared = 0;
      let budgetExhausted = false;
      for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
        const clearedInBatch = await this.exportService.purgeExpiredFiles(now, PURGE_BATCH_SIZE);
        cleared += clearedInBatch;
        // A short batch means we reached the end of what is eligible — a
        // full batch means there MIGHT be more, so the loop continues
        // rather than stopping on the count alone.
        if (clearedInBatch < PURGE_BATCH_SIZE) {
          budgetExhausted = false;
          break;
        }
        budgetExhausted = batch === MAX_BATCHES_PER_RUN - 1;
      }

      if (cleared > 0) {
        this.logger.log(`Order export retention: cleared ${String(cleared)} expired export file(s)`);
      }
      if (budgetExhausted) {
        this.logger.warn(
          "Order export retention: this run's budget was exhausted with more rows still eligible - " +
            'the backlog will keep draining across future ticks.'
        );
      }

      return { cleared, budgetExhausted };
    } catch (error) {
      this.logger.error(
        'Error in order export retention sweep',
        error instanceof Error ? error.stack : String(error)
      );
      return null;
    } finally {
      await this.syncLock.release(SWEEP_LOCK_KEY, token);
    }
  }
}

/**
 * Order Search Text Reindex Sweep (#3507 G03-14)
 *
 * Schedules `IOrderSearchTextReindexService` in the `maintenance` worker
 * role: once shortly after the worker starts — so turning `OL_STORE_PII` off
 * and restarting takes buyer names and emails out of the order search index
 * without waiting a day — and then daily, which catches nothing in the steady
 * state (every write already derives under the current flag) and exists as
 * the backstop for a flip made without a restart of this role.
 *
 * The `OrderExportRetentionService` shape, for the same reasons:
 *
 * **Budgeted passes.** The core pass reads at most its page budget and
 * returns a resume cursor; a table larger than one pass drains across
 * follow-up ticks scheduled `FOLLOW_UP_DELAY_MS` apart rather than in one
 * long-running scan. The cursor lives in memory only — losing it on a
 * restart just means the next pass rescans from the start, which is safe
 * because the pass is idempotent.
 *
 * **A lease per pass, never a renewed leadership term.** Two replicas doing
 * the same reindex is wasted effort, not a correctness bug (each rewrite is
 * conditional on the text it read), so a lost lock degrades to a skipped tick.
 *
 * **Never throws.** A failed pass is logged; the index simply keeps its stale
 * text until the next tick.
 *
 * @module apps/worker/src/maintenance
 */
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ORDER_SEARCH_TEXT_REINDEX_SERVICE_TOKEN,
  type IOrderSearchTextReindexService,
  type OrderSearchTextReindexRunResult,
} from '@openlinker/core/orders';
import { SYNC_LOCK_TOKEN, type SyncLockPort } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

/** The steady-state cadence: daily. */
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * The first pass waits briefly after boot rather than running inside
 * `onModuleInit`, so a worker start is never slowed by a table scan.
 */
const STARTUP_DELAY_MS = 30 * 1000;

/** Gap between passes while a backlog larger than one pass's budget drains. */
const FOLLOW_UP_DELAY_MS = 60 * 1000;

/** Covers one budgeted pass, never a renewed leadership term. */
const SWEEP_LOCK_TTL_MS = 20 * 60 * 1000;

const SWEEP_LOCK_KEY = 'maintenance:order-search-text-reindex:sweep';

@Injectable()
export class OrderSearchTextReindexSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderSearchTextReindexSweepService.name);
  private sweepInterval: NodeJS.Timeout | null = null;
  private pendingTimeout: NodeJS.Timeout | null = null;
  private resumeCursor: string | null = null;

  constructor(
    @Inject(ORDER_SEARCH_TEXT_REINDEX_SERVICE_TOKEN)
    private readonly reindexService: IOrderSearchTextReindexService,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly syncLock: SyncLockPort,
    private readonly configService: ConfigService
  ) {}

  onModuleInit(): void {
    // Same disable seam as the other maintenance occupants; default on.
    const enabled =
      this.configService.get<string>('WORKER_MAINTENANCE_ENABLED', 'true') !== 'false';
    if (!enabled) {
      this.logger.log('Order search text reindex disabled via WORKER_MAINTENANCE_ENABLED=false');
      return;
    }
    this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(intervalMs: number = SWEEP_INTERVAL_MS, startupDelayMs: number = STARTUP_DELAY_MS): void {
    if (this.sweepInterval) {
      return;
    }
    this.sweepInterval = setInterval(() => {
      void this.runOnce();
    }, intervalMs);
    this.sweepInterval.unref();
    this.schedule(startupDelayMs);
    this.logger.log(
      `Started order search text reindex sweep (first pass in ${startupDelayMs / 1000}s, then every ${intervalMs / 1000}s)`
    );
  }

  stop(): void {
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = null;
    }
    if (this.pendingTimeout) {
      clearTimeout(this.pendingTimeout);
      this.pendingTimeout = null;
    }
  }

  /**
   * One leased pass. Resumes from the cursor a previous budget-exhausted pass
   * left behind, and schedules a follow-up pass when this one also runs out
   * of budget.
   */
  async runOnce(): Promise<OrderSearchTextReindexRunResult | null> {
    const token = await this.syncLock.acquire(SWEEP_LOCK_KEY, SWEEP_LOCK_TTL_MS);
    if (token === null) {
      this.logger.debug('Order search text reindex already running elsewhere — skipping tick');
      return null;
    }

    try {
      const result = await this.reindexService.runOnce(this.resumeCursor);
      if (result.status === 'skipped-pii-stored') {
        this.resumeCursor = null;
        return result;
      }

      this.resumeCursor = result.nextCursor;
      if (result.budgetExhausted && this.sweepInterval !== null) {
        this.logger.warn(
          `Order search text reindex: pass budget exhausted after ${String(result.scanned)} row(s) — ` +
            `continuing in ${FOLLOW_UP_DELAY_MS / 1000}s`
        );
        this.schedule(FOLLOW_UP_DELAY_MS);
      }
      return result;
    } catch (error) {
      this.logger.error(
        'Error in order search text reindex sweep',
        error instanceof Error ? error.stack : String(error)
      );
      return null;
    } finally {
      await this.syncLock.release(SWEEP_LOCK_KEY, token);
    }
  }

  private schedule(delayMs: number): void {
    if (this.pendingTimeout) {
      clearTimeout(this.pendingTimeout);
    }
    this.pendingTimeout = setTimeout(() => {
      this.pendingTimeout = null;
      void this.runOnce();
    }, delayMs);
    this.pendingTimeout.unref();
  }
}

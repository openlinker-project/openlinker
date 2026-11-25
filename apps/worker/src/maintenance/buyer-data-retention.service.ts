/**
 * Buyer Data Retention Sweep (#4289)
 *
 * Schedules `IBuyerDataRetentionService.runOnce` in the `maintenance` worker
 * role - the `InventoryMovementRetentionService` shape:
 *
 * - **Bounded**: the core service caps each connection's batches per run; a
 *   backlog larger than one run drains over later ticks.
 * - **A per-run lease** (`SyncLockPort`), because two replicas erasing the same
 *   rows is wasted work. A lost lock degrades to a skipped tick.
 * - **The rule is read on every tick** from Operational Settings and each
 *   connection's config, so an admin turning it on (or off) takes effect on the
 *   next tick with no worker restart.
 * - **Never throws.** A failed tick is logged; nothing is hidden or erased
 *   until the next one, the safe direction.
 *
 * Does nothing at all until an admin enables the rule, so scheduling it for
 * every install is safe.
 *
 * @module apps/worker/src/maintenance
 */
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BUYER_DATA_RETENTION_SERVICE_TOKEN,
  type BuyerDataRetentionRunResult,
  type IBuyerDataRetentionService,
} from '@openlinker/core/orders';
import { SYNC_LOCK_TOKEN, type SyncLockPort } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
/** One sweep shortly after boot, so a restart does not leave an hour of lag. */
const FIRST_SWEEP_DELAY_MS = 90 * 1000;
const SWEEP_LOCK_TTL_MS = 30 * 60 * 1000; // covers one run, never a leadership term
export const BUYER_DATA_RETENTION_LOCK_KEY = 'maintenance:buyer-data-retention:sweep';

@Injectable()
export class BuyerDataRetentionSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BuyerDataRetentionSweepService.name);
  private sweepInterval: NodeJS.Timeout | null = null;
  private firstSweepTimeout: NodeJS.Timeout | null = null;

  constructor(
    @Inject(BUYER_DATA_RETENTION_SERVICE_TOKEN)
    private readonly retention: IBuyerDataRetentionService,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly syncLock: SyncLockPort,
    private readonly configService: ConfigService
  ) {}

  onModuleInit(): void {
    const enabled =
      this.configService.get<string>('WORKER_MAINTENANCE_ENABLED', 'true') !== 'false';
    if (!enabled) {
      this.logger.log('Buyer data retention disabled via WORKER_MAINTENANCE_ENABLED=false');
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
    this.firstSweepTimeout = setTimeout(() => {
      this.firstSweepTimeout = null;
      void this.runOnce();
    }, FIRST_SWEEP_DELAY_MS);
    if (typeof this.firstSweepTimeout.unref === 'function') {
      this.firstSweepTimeout.unref();
    }
    this.logger.log(`Started buyer data retention sweep (checking every ${interval / 1000}s)`);
  }

  stop(): void {
    if (this.firstSweepTimeout) {
      clearTimeout(this.firstSweepTimeout);
      this.firstSweepTimeout = null;
    }
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = null;
    }
  }

  /** One leased pass. Never throws. */
  async runOnce(): Promise<BuyerDataRetentionRunResult | null> {
    const token = await this.syncLock.acquire(BUYER_DATA_RETENTION_LOCK_KEY, SWEEP_LOCK_TTL_MS);
    if (token === null) {
      this.logger.debug('Buyer data retention sweep already running elsewhere - skipping tick');
      return null;
    }

    try {
      const result = await this.retention.runOnce();
      if (result.budgetExhausted) {
        this.logger.warn(
          "Buyer data retention: this run's budget was exhausted with more orders still due - the backlog will keep draining across future ticks."
        );
      }
      return result;
    } catch (error) {
      this.logger.error(
        'Error in buyer data retention sweep',
        error instanceof Error ? error.stack : String(error)
      );
      return null;
    } finally {
      await this.syncLock.release(BUYER_DATA_RETENTION_LOCK_KEY, token);
    }
  }
}

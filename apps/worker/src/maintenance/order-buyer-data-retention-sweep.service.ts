/**
 * Order Buyer Data Retention Sweep (#4178)
 *
 * Runs `IOrderBuyerDataRetentionService` hourly in the `maintenance` role:
 * removes buyer personal data from orders whose source limits how long it may
 * be kept (Amazon: 30 days after delivery). The rule and what is removed live
 * in the core service; this file only schedules it.
 *
 * A per-run `SyncLockPort` lease keeps two `maintenance` replicas from
 * redacting the same rows at once (the `SyncJobRetentionService` shape); a lost
 * lock is a skipped tick. The first pass runs shortly after boot, so a worker
 * restarted around the hour does not push a due deletion back by an hour.
 *
 * @module apps/worker/src/maintenance
 */
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ORDER_BUYER_DATA_RETENTION_SERVICE_TOKEN,
  type IOrderBuyerDataRetentionService,
  type OrderBuyerDataRetentionRunResult,
} from '@openlinker/core/orders';
import { SYNC_LOCK_TOKEN, type SyncLockPort } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const STARTUP_DELAY_MS = 60 * 1000;
const SWEEP_LOCK_TTL_MS = 20 * 60 * 1000;
const SWEEP_LOCK_KEY = 'maintenance:order-buyer-data-retention:sweep';

@Injectable()
export class OrderBuyerDataRetentionSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderBuyerDataRetentionSweepService.name);
  private sweepInterval: NodeJS.Timeout | null = null;
  private startupTimeout: NodeJS.Timeout | null = null;

  constructor(
    @Inject(ORDER_BUYER_DATA_RETENTION_SERVICE_TOKEN)
    private readonly retention: IOrderBuyerDataRetentionService,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly syncLock: SyncLockPort,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    // Same disable seam as the other maintenance occupants; default on.
    const enabled = this.configService.get<string>('WORKER_MAINTENANCE_ENABLED', 'true') !== 'false';
    if (!enabled) {
      this.logger.log('Order buyer data retention disabled via WORKER_MAINTENANCE_ENABLED=false');
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
    this.startupTimeout = setTimeout(() => {
      this.startupTimeout = null;
      void this.runOnce();
    }, startupDelayMs);
    this.startupTimeout.unref();
  }

  stop(): void {
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = null;
    }
    if (this.startupTimeout) {
      clearTimeout(this.startupTimeout);
      this.startupTimeout = null;
    }
  }

  async runOnce(): Promise<OrderBuyerDataRetentionRunResult | null> {
    const token = await this.syncLock.acquire(SWEEP_LOCK_KEY, SWEEP_LOCK_TTL_MS);
    if (token === null) {
      this.logger.debug('Order buyer data retention already running elsewhere — skipping tick');
      return null;
    }
    try {
      const result = await this.retention.runOnce();
      for (const connection of result.connections.filter((entry) => entry.budgetExhausted)) {
        this.logger.warn(
          `Order buyer data retention: budget spent for connection ${connection.sourceConnectionId}; ` +
            'the rest is removed on the next run',
        );
      }
      return result;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(`order_buyer_data_retention_sweep_failed: ${detail}`);
      return null;
    } finally {
      await this.syncLock.release(SWEEP_LOCK_KEY, token);
    }
  }
}

/**
 * Inventory Movement Retention Service (#3565)
 *
 * `inventory_movements` is append-only, so without retention it grows by one row
 * per stock change for the life of the install. This is that retention: a copy
 * of the `SyncJobRetentionService` shape (#2946) in the `maintenance` worker
 * role, deleting only `inventory_movements` and nothing else - reservations,
 * stock positions and the sale-decrement records are never touched.
 *
 * - **Budgeted batches**, never one unbounded DELETE: each tick deletes at most
 *   `MAX_BATCHES_PER_RUN * PRUNE_BATCH_SIZE` rows; a larger backlog drains over
 *   several ticks.
 * - **A per-run lease** (`SyncLockPort`), because two replicas racing the same
 *   rows is wasted work. A lost lock degrades to a skipped tick, so there is no
 *   heartbeat.
 * - **The window is read on every tick** from Operational Settings, so a change
 *   takes effect on the next hourly tick with no worker restart.
 *
 * @module apps/worker/src/maintenance
 */
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  INVENTORY_MOVEMENT_SERVICE_TOKEN,
  type IInventoryMovementService,
} from '@openlinker/core/inventory';
import {
  IOperationalSettingsService,
  OPERATIONAL_SETTINGS_SERVICE_TOKEN,
} from '@openlinker/core/operational-settings';
import { SYNC_LOCK_TOKEN, type SyncLockPort } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

/** Rows deleted per DELETE statement - one "unit" of the per-run budget. */
export const INVENTORY_MOVEMENT_PRUNE_BATCH_SIZE = 1000;

/** DELETE statements per tick; bounds one tick's database work. */
export const INVENTORY_MOVEMENT_MAX_BATCHES_PER_RUN = 50;

const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const SWEEP_LOCK_TTL_MS = 20 * 60 * 1000; // covers one run, never a leadership term
export const INVENTORY_MOVEMENT_RETENTION_LOCK_KEY =
  'maintenance:inventory-movement-retention:sweep';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface InventoryMovementRetentionRunResult {
  readonly deleted: number;
  readonly budgetExhausted: boolean;
}

@Injectable()
export class InventoryMovementRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InventoryMovementRetentionService.name);
  private sweepInterval: NodeJS.Timeout | null = null;

  constructor(
    @Inject(INVENTORY_MOVEMENT_SERVICE_TOKEN)
    private readonly movements: IInventoryMovementService,
    @Inject(OPERATIONAL_SETTINGS_SERVICE_TOKEN)
    private readonly operationalSettingsService: IOperationalSettingsService,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly syncLock: SyncLockPort,
    private readonly configService: ConfigService
  ) {}

  onModuleInit(): void {
    const enabled =
      this.configService.get<string>('WORKER_MAINTENANCE_ENABLED', 'true') !== 'false';
    if (!enabled) {
      this.logger.log(
        'Inventory movement retention disabled via WORKER_MAINTENANCE_ENABLED=false'
      );
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
    this.logger.log(
      `Started inventory movement retention sweep (checking every ${interval / 1000}s)`
    );
  }

  stop(): void {
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = null;
    }
  }

  /**
   * One retention pass. Never throws: a failed tick is logged and the table is
   * pruned less aggressively until the next one, the safe direction.
   */
  async runOnce(): Promise<InventoryMovementRetentionRunResult | null> {
    const token = await this.syncLock.acquire(
      INVENTORY_MOVEMENT_RETENTION_LOCK_KEY,
      SWEEP_LOCK_TTL_MS
    );
    if (token === null) {
      this.logger.debug(
        'Inventory movement retention sweep already running elsewhere - skipping tick'
      );
      return null;
    }

    try {
      const settings = await this.operationalSettingsService.resolve();
      const days = settings.inventoryMovementRetentionDays.value;
      const cutoff = new Date(Date.now() - days * MS_PER_DAY);

      let deleted = 0;
      let budgetExhausted = true;
      for (let batch = 0; batch < INVENTORY_MOVEMENT_MAX_BATCHES_PER_RUN; batch++) {
        const deletedInBatch = await this.movements.pruneOlderThan(
          cutoff,
          INVENTORY_MOVEMENT_PRUNE_BATCH_SIZE
        );
        deleted += deletedInBatch;
        // A short batch means the end of what is eligible; a full one means
        // there MIGHT be more, so the loop continues.
        if (deletedInBatch < INVENTORY_MOVEMENT_PRUNE_BATCH_SIZE) {
          budgetExhausted = false;
          break;
        }
      }

      if (deleted > 0) {
        this.logger.log(
          `Inventory movement retention: deleted ${String(deleted)} row(s) older than ${String(days)}d`
        );
      }
      if (budgetExhausted) {
        this.logger.warn(
          "Inventory movement retention: this run's budget was exhausted with more rows still " +
            'eligible - the backlog will keep draining across future ticks.'
        );
      }
      return { deleted, budgetExhausted };
    } catch (error) {
      this.logger.error(
        'Error in inventory movement retention sweep',
        error instanceof Error ? error.stack : String(error)
      );
      return null;
    } finally {
      await this.syncLock.release(INVENTORY_MOVEMENT_RETENTION_LOCK_KEY, token);
    }
  }
}

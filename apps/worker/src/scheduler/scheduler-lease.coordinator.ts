/**
 * Scheduler Lease Coordinator
 *
 * Owns the `singleton:scheduler` lease (#2279, ADR-051): every worker booted
 * with the `scheduler` role competes for it, exactly one wins and runs
 * `SchedulerService.start()`, and losing the lease (or shutting down) stops
 * the crons — so scaling worker replicas never multiplies cron output, and
 * the scheduler fails over within one lease TTL of its holder dying.
 *
 * `OL_SCHEDULER_ENABLED=false` opts a process out of competing entirely (the
 * integration-test harness sets it so a booted worker context starts no cron
 * timers). `OL_SCHEDULER_LEASE_TTL_MS` tunes failover latency, clamped to
 * [15 s, 10 min] — below that a Redis blip streak causes flapping, above it a
 * dead holder parks the scheduler for too long.
 *
 * @module apps/worker/src/scheduler
 */
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SyncLockPort, SYNC_LOCK_TOKEN } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';
import { SingletonRoleLease } from '../roles/singleton-role-lease';
import { SchedulerService } from './scheduler.service';

const LEASE_KEY = 'singleton:scheduler';
const LEASE_TTL_DEFAULT_MS = 60_000;
const LEASE_TTL_MIN_MS = 15_000;
const LEASE_TTL_MAX_MS = 600_000;

@Injectable()
export class SchedulerLeaseCoordinator implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerLeaseCoordinator.name);
  private lease: SingletonRoleLease | null = null;

  constructor(
    private readonly schedulerService: SchedulerService,
    private readonly configService: ConfigService,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly syncLock: SyncLockPort
  ) {}

  onApplicationBootstrap(): void {
    const enabled =
      this.configService.get<string>('OL_SCHEDULER_ENABLED', 'true') !== 'false';
    if (!enabled) {
      this.logger.log('Scheduler disabled via OL_SCHEDULER_ENABLED=false — not competing');
      return;
    }

    this.lease = new SingletonRoleLease({
      lockKey: LEASE_KEY,
      ttlMs: this.resolveTtlMs(),
      syncLock: this.syncLock,
      onAcquired: async () => {
        // Snapshot the operator-settable cadences BEFORE registering the cron
        // jobs (#2651) — a CronJob's expression is fixed at construction, so
        // this is the point at which the deletion audit's cadence is decided.
        // The refresh never throws; a failed read leaves every task on its env
        // var. `onAcquired` is awaited by `SingletonRoleLease`, so the ordering
        // holds.
        await this.schedulerService.refreshOperationalSettings();
        this.schedulerService.start();
      },
      onLost: () => this.schedulerService.stop(),
    });
    this.lease.start();
  }

  async onModuleDestroy(): Promise<void> {
    // stop() releases a held lease (fast failover) and fires onLost → stop().
    await this.lease?.stop();
    this.lease = null;
  }

  private resolveTtlMs(): number {
    const raw = this.configService.get<string>('OL_SCHEDULER_LEASE_TTL_MS');
    const parsed = raw === undefined ? NaN : Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      if (raw !== undefined) {
        this.logger.warn(
          `Ignoring non-numeric OL_SCHEDULER_LEASE_TTL_MS='${raw}' — using default ${LEASE_TTL_DEFAULT_MS}ms`
        );
      }
      return LEASE_TTL_DEFAULT_MS;
    }
    const clamped = Math.min(LEASE_TTL_MAX_MS, Math.max(LEASE_TTL_MIN_MS, Math.floor(parsed)));
    if (clamped !== parsed) {
      this.logger.warn(
        `Clamped OL_SCHEDULER_LEASE_TTL_MS=${parsed} to ${clamped}ms (allowed range ${LEASE_TTL_MIN_MS}-${LEASE_TTL_MAX_MS})`
      );
    }
    return clamped;
  }
}

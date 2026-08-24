/**
 * Demo Account Cleanup Service
 *
 * Periodically deletes self-registered demo accounts once they exceed a
 * configurable retention window (#1469). Only acts when OL_DEMO_MODE is
 * enabled — a non-demo deployment (registration usually disabled anyway)
 * never has this task do anything.
 *
 * Scope: `role: 'viewer'` + `status IN ('active', 'pending_confirmation')` +
 * `createdAt` older than the retention window, per
 * `UserRepositoryPort.findStaleViewerAccounts`. `pending_confirmation` is
 * included (#1624) because demo signups now land in that status until the
 * user clicks the confirmation link — an abandoned/never-confirmed signup
 * would otherwise never match `status: 'active'` and accumulate forever on
 * a public demo deployment. Both statuses share the same retention window
 * for now; a pending_confirmation account that's still stale after the
 * window either never confirmed or the confirmation was accepted (making
 * it 'active', not swept differently) — one threshold keeps this simple.
 * The `role: 'viewer'` scoping is the exact shape
 * `RegistrationService.register` produces for a demo account — an
 * operator-created persistent viewer account is indistinguishable from a
 * demo one and would also be swept up. Acceptable for a public/unattended
 * demo; out of scope to add a distinguishing column for a single
 * supervised deployment.
 *
 * Since #2279 (ADR-051) the api no longer carries `@nestjs/schedule` — the
 * scheduler role moved to the worker — so this runs on a plain unref'd hourly
 * `setInterval`, serialized across api replicas by a per-tick
 * `singleton:demo-cleanup` lock (skip, don't queue: the sweep is a level
 * check, so the next tick covers a skipped one).
 *
 * @module apps/api/src/auth
 */
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@openlinker/shared/logging';
import { UserRepositoryPort, USER_REPOSITORY_TOKEN } from '@openlinker/core/users';
import { SyncLockPort, SYNC_LOCK_TOKEN } from '@openlinker/core/sync';
import { DEMO_MODE_SERVICE_TOKEN, type IDemoModeService } from './demo-mode.service.interface';

const MS_PER_HOUR = 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = MS_PER_HOUR;
const CLEANUP_LOCK_KEY = 'singleton:demo-cleanup';
/** Generous bound on one sweep; well under the hourly cadence. */
const CLEANUP_LOCK_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class DemoAccountCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DemoAccountCleanupService.name);
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(
    @Inject(USER_REPOSITORY_TOKEN)
    private readonly userRepository: UserRepositoryPort,
    @Inject(DEMO_MODE_SERVICE_TOKEN)
    private readonly demoModeService: IDemoModeService,
    private readonly configService: ConfigService,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly syncLock: SyncLockPort,
  ) {}

  onModuleInit(): void {
    this.cleanupInterval = setInterval(() => {
      void this.cleanup();
    }, CLEANUP_INTERVAL_MS);
    // Don't keep the process alive if only this interval is running.
    if (typeof this.cleanupInterval.unref === 'function') {
      this.cleanupInterval.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  async cleanup(): Promise<void> {
    if (!this.demoModeService.isDemoModeEnabled()) {
      return;
    }

    // Per-tick singleton lock: with N api replicas only one runs the sweep;
    // the others skip this tick. Deletion is idempotent, so the lock is a
    // duplication guard rather than a correctness requirement.
    let token: string | null = null;
    try {
      token = await this.syncLock.acquire(CLEANUP_LOCK_KEY, CLEANUP_LOCK_TTL_MS);
    } catch (error) {
      this.logger.warn(
        `Demo cleanup lock unavailable (skipping tick): ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    if (token === null) {
      return; // Another replica holds this tick.
    }

    try {
      const retentionHours = Number(
        this.configService.get<string>('OL_DEMO_ACCOUNT_RETENTION_HOURS', '24'),
      );
      const olderThan = new Date(Date.now() - retentionHours * MS_PER_HOUR);
      const staleAccounts = await this.userRepository.findStaleViewerAccounts(olderThan, [
        'active',
        'pending_confirmation',
      ]);

      for (const account of staleAccounts) {
        await this.userRepository.deleteById(account.id);
      }

      if (staleAccounts.length > 0) {
        this.logger.log(
          `Demo account cleanup: removed ${staleAccounts.length} account(s) older than ${retentionHours}h`,
        );
      }
    } catch (error) {
      // Swallow-and-log: the caller is a bare interval callback that discards
      // the promise, so a propagating rejection would be an unhandled rejection
      // and take the whole API process down over a transient DB blip during a
      // best-effort demo sweep. The next tick retries.
      this.logger.error(
        'Demo account cleanup failed (will retry next tick)',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      await this.syncLock.release(CLEANUP_LOCK_KEY, token).catch(() => {
        // Expires by TTL.
      });
    }
  }
}

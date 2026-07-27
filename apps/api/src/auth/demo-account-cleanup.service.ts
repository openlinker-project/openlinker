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
 * @module apps/api/src/auth
 */
import { Inject, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@openlinker/shared/logging';
import { UserRepositoryPort, USER_REPOSITORY_TOKEN } from '@openlinker/core/users';
import { DEMO_MODE_SERVICE_TOKEN, type IDemoModeService } from './demo-mode.service.interface';

const MS_PER_HOUR = 60 * 60 * 1000;

@Injectable()
export class DemoAccountCleanupService {
  private readonly logger = new Logger(DemoAccountCleanupService.name);

  constructor(
    @Inject(USER_REPOSITORY_TOKEN)
    private readonly userRepository: UserRepositoryPort,
    @Inject(DEMO_MODE_SERVICE_TOKEN)
    private readonly demoModeService: IDemoModeService,
    private readonly configService: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async cleanup(): Promise<void> {
    if (!this.demoModeService.isDemoModeEnabled()) {
      return;
    }

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
  }
}

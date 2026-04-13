/**
 * Bootstrap Admin Service
 *
 * Seeds a default admin user on first boot when the configured admin username
 * does not exist. Idempotent across restarts and safe under concurrent boots
 * (relies on the `users.username` unique constraint as the race tiebreaker).
 *
 * Controlled by env:
 *   - OL_BOOTSTRAP_ADMIN_ENABLED (default: true)
 *   - OL_BOOTSTRAP_ADMIN_USERNAME (default: admin)
 *   - OL_BOOTSTRAP_ADMIN_EMAIL (default: admin@openlinker.local)
 *   - OL_BOOTSTRAP_ADMIN_PASSWORD (optional; if unset, a random one is
 *     generated and printed once to the API log)
 *
 * @module apps/api/src/auth
 */
import { randomBytes } from 'crypto';
import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { Logger } from '@openlinker/shared/logging';
import { UserRepositoryPort, USER_REPOSITORY_TOKEN } from '@openlinker/core/users';

const BCRYPT_COST = 10;

@Injectable()
export class BootstrapAdminService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapAdminService.name);

  constructor(
    private readonly configService: ConfigService,
    @Inject(USER_REPOSITORY_TOKEN)
    private readonly userRepository: UserRepositoryPort,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.bootstrap();
  }

  async bootstrap(): Promise<void> {
    const enabled = this.configService.get<string>('OL_BOOTSTRAP_ADMIN_ENABLED', 'true');
    if (enabled.trim().toLowerCase() !== 'true') {
      return;
    }

    const username = this.configService.get<string>('OL_BOOTSTRAP_ADMIN_USERNAME', 'admin');
    const email = this.configService.get<string>(
      'OL_BOOTSTRAP_ADMIN_EMAIL',
      'admin@openlinker.local',
    );
    const providedPassword = this.configService.get<string>('OL_BOOTSTRAP_ADMIN_PASSWORD');

    const existing = await this.userRepository.findByUsername(username);
    if (existing) {
      return;
    }

    const passwordWasGenerated = !providedPassword;
    const password = providedPassword ?? this.generatePassword();
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

    try {
      await this.userRepository.save({
        username,
        email,
        passwordHash,
        role: 'admin',
      });
    } catch (error) {
      // Concurrent boot peer won the insert — username unique constraint fired.
      if (this.isUniqueViolation(error)) {
        this.logger.log(
          `Default admin user '${username}' already created by another instance — skipping seed`,
        );
        return;
      }
      throw error;
    }

    if (passwordWasGenerated) {
      this.logBootstrapBanner(username, password);
    } else {
      this.logger.log(`Seeded default admin user '${username}' with provided password`);
    }
  }

  private generatePassword(): string {
    return randomBytes(18).toString('base64url');
  }

  private logBootstrapBanner(username: string, password: string): void {
    const line = '='.repeat(72);
    this.logger.warn(
      [
        line,
        'OpenLinker default admin user seeded — store these credentials now:',
        `  username=${username}`,
        `  password=${password}`,
        'Set OL_BOOTSTRAP_ADMIN_PASSWORD or disable seeding via',
        'OL_BOOTSTRAP_ADMIN_ENABLED=false in production environments.',
        line,
      ].join('\n'),
    );
  }

  private isUniqueViolation(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) {
      return false;
    }
    const e = error as { code?: string; driverError?: { code?: string } };
    return e.code === '23505' || e.driverError?.code === '23505';
  }
}

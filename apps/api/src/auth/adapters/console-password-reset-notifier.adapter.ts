/**
 * Console Password Reset Notifier Adapter
 *
 * Dev-time implementation of PasswordResetNotifierPort that logs the reset
 * link instead of sending email. Real mailer adapters (SMTP, SES, etc.)
 * should replace this in production wiring.
 *
 * @module apps/api/src/auth/adapters
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PasswordResetNotifierPort, User } from '@openlinker/core/users';

@Injectable()
export class ConsolePasswordResetNotifierAdapter implements PasswordResetNotifierPort {
  private readonly logger = new Logger(ConsolePasswordResetNotifierAdapter.name);

  constructor(private readonly configService: ConfigService) {}

  async notifyResetRequested(user: User, rawToken: string): Promise<void> {
    const base = this.configService.get<string>('WEB_URL', 'http://localhost:4173');
    const link = `${base.replace(/\/$/, '')}/reset-password/${rawToken}`;
    this.logger.log(
      `[password-reset] user=${user.username} email=${user.email ?? '-'} link=${link}`,
    );
    return Promise.resolve();
  }
}

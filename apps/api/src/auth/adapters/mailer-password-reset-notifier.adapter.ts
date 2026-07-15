/**
 * Mailer Password Reset Notifier Adapter
 *
 * Implementation of PasswordResetNotifierPort that composes the reusable
 * MailerPort to deliver the reset link. The concrete transport (console for
 * dev, SMTP/SES for prod) is selected by configuration behind MailerPort, so
 * this notifier is transport-agnostic. First consumer of the mailer
 * infrastructure (#1623).
 *
 * @module apps/api/src/auth/adapters
 */
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MAILER_TOKEN,
  type MailerPort,
  type PasswordResetNotifierPort,
  type User,
} from '@openlinker/core/users';

@Injectable()
export class MailerPasswordResetNotifierAdapter implements PasswordResetNotifierPort {
  constructor(
    @Inject(MAILER_TOKEN) private readonly mailer: MailerPort,
    private readonly configService: ConfigService,
  ) {}

  async notifyResetRequested(user: User, rawToken: string): Promise<void> {
    if (!user.email) {
      return;
    }
    const base = this.configService.get<string>('WEB_URL', 'http://localhost:4173');
    const link = `${base.replace(/\/$/, '')}/reset-password/${rawToken}`;
    const text = `Hello ${user.username},\n\nA password reset was requested for your account. Use the link below to set a new password:\n\n${link}\n\nIf you did not request this, you can ignore this email.`;

    await this.mailer.sendEmail({
      to: user.email,
      subject: 'Reset your OpenLinker password',
      text,
    });
  }
}

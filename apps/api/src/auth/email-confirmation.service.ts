/**
 * Email Confirmation Service
 *
 * Implements the email-confirmation flow for self-service demo registration
 * (#1624): issuing a single-use, hashed, time-limited token on registration
 * and consuming it to activate the account. Mirrors the security pattern of
 * PasswordResetService (SHA-256 hashed token, TTL, single-use) but composes
 * MailerPort directly rather than a dedicated notifier port — sending one
 * confirmation email is already MailerPort's whole job, so a passthrough
 * notifier abstraction would add nothing.
 *
 * @module apps/api/src/auth
 */
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createHash } from 'crypto';
import { Logger } from '@openlinker/shared/logging';
import {
  EMAIL_CONFIRMATION_TOKEN_REPOSITORY_TOKEN,
  InvalidEmailConfirmationTokenException,
  MAILER_TOKEN,
  type EmailConfirmationTokenRepositoryPort,
  type MailerPort,
  type User,
} from '@openlinker/core/users';
import type { IEmailConfirmationService } from './email-confirmation.service.interface';
import {
  IUserManagementService,
  USER_MANAGEMENT_SERVICE_TOKEN,
} from '../users/user-management.service.interface';

const DEFAULT_TTL_MINUTES = 24 * 60;

@Injectable()
export class EmailConfirmationService implements IEmailConfirmationService {
  private readonly logger = new Logger(EmailConfirmationService.name);
  private readonly ttlMinutes: number;

  constructor(
    @Inject(EMAIL_CONFIRMATION_TOKEN_REPOSITORY_TOKEN)
    private readonly tokenRepository: EmailConfirmationTokenRepositoryPort,
    @Inject(MAILER_TOKEN)
    private readonly mailer: MailerPort,
    @Inject(USER_MANAGEMENT_SERVICE_TOKEN)
    private readonly userManagementService: IUserManagementService,
    private readonly configService: ConfigService
  ) {
    this.ttlMinutes = Number(
      this.configService.get<string | number>(
        'EMAIL_CONFIRMATION_TTL_MINUTES',
        DEFAULT_TTL_MINUTES
      )
    );
  }

  async sendConfirmation(user: User): Promise<void> {
    if (!user.email) {
      this.logger.warn(`Cannot send confirmation email — user has no email: ${user.id}`);
      return;
    }

    const now = new Date();
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(now.getTime() + this.ttlMinutes * 60 * 1000);

    await this.tokenRepository.save({ userId: user.id, tokenHash, expiresAt });

    const base = this.configService.get<string>('WEB_URL', 'http://localhost:4173');
    const link = `${base.replace(/\/$/, '')}/confirm-email/${rawToken}`;
    const text = `Hello ${user.username},\n\nThanks for signing up for OpenLinker. Confirm your email address to activate your account:\n\n${link}\n\nThis link expires in ${Math.round(this.ttlMinutes / 60)} hours. If you did not create this account, you can ignore this email.`;

    try {
      await this.mailer.sendEmail({
        to: user.email,
        subject: 'Confirm your OpenLinker account',
        text,
      });
    } catch (error) {
      // Never let a transport failure (e.g. SMTP down) fail registration —
      // the account is created either way; the user can be resent a link by
      // an admin. Mirrors PasswordResetService's non-blocking send.
      this.logger.error(
        'Failed to send email confirmation notification',
        (error as Error).stack
      );
    }
  }

  async confirmEmail(token: string): Promise<void> {
    if (!token) {
      throw new InvalidEmailConfirmationTokenException();
    }

    const tokenHash = this.hashToken(token);
    const now = new Date();
    const record = await this.tokenRepository.findByTokenHash(tokenHash);
    if (!record || !record.isUsable(now)) {
      throw new InvalidEmailConfirmationTokenException();
    }

    await this.userManagementService.confirmEmail(record.userId);
    await this.tokenRepository.markUsed(record.id, now);
  }

  private hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }
}

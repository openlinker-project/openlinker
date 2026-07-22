/**
 * Password Reset Service
 *
 * Implements the password reset flow: issuing single-use, short-lived tokens
 * on request, and consuming them to set a new password. Raw tokens are never
 * persisted — only SHA-256 hashes.
 *
 * @module apps/api/src/auth
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createHash } from 'crypto';
import * as bcrypt from 'bcryptjs';
import {
  InvalidPasswordResetTokenException,
  PASSWORD_RESET_NOTIFIER_TOKEN,
  PASSWORD_RESET_TOKEN_REPOSITORY_TOKEN,
  USER_REPOSITORY_TOKEN,
  WeakPasswordException,
  type PasswordResetNotifierPort,
  type PasswordResetTokenRepositoryPort,
  type UserRepositoryPort,
} from '@openlinker/core/users';
import type { IPasswordResetService } from './password-reset.service.interface';

const DEFAULT_TTL_MINUTES = 60;
const MIN_PASSWORD_LENGTH = 8;
const BCRYPT_ROUNDS = 10;

@Injectable()
export class PasswordResetService implements IPasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  private readonly ttlMinutes: number;

  constructor(
    @Inject(USER_REPOSITORY_TOKEN)
    private readonly userRepository: UserRepositoryPort,
    @Inject(PASSWORD_RESET_TOKEN_REPOSITORY_TOKEN)
    private readonly tokenRepository: PasswordResetTokenRepositoryPort,
    @Inject(PASSWORD_RESET_NOTIFIER_TOKEN)
    private readonly notifier: PasswordResetNotifierPort,
    private readonly configService: ConfigService
  ) {
    this.ttlMinutes = Number(
      this.configService.get<string | number>('PASSWORD_RESET_TTL_MINUTES', DEFAULT_TTL_MINUTES)
    );
  }

  async requestReset(email: string): Promise<void> {
    const user = await this.userRepository.findByEmail(email);
    if (!user) {
      this.logger.debug('Password reset requested for unknown email');
      return;
    }

    const now = new Date();
    await this.tokenRepository.invalidateActiveForUser(user.id, now);

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(now.getTime() + this.ttlMinutes * 60 * 1000);

    await this.tokenRepository.save({ userId: user.id, tokenHash, expiresAt });

    try {
      await this.notifier.notifyResetRequested(user, rawToken);
    } catch (error) {
      // Never let a transport failure (e.g. SMTP down) change this endpoint's
      // response shape/status — AuthController.forgotPassword always returns
      // 200 to prevent user enumeration. A thrown error here would otherwise
      // propagate as a 500, distinguishing "known email + SMTP hiccup" from
      // "unknown email", which is exactly the oracle this flow must avoid.
      this.logger.error(
        'Failed to send password reset notification',
        (error as Error).stack
      );
    }
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    if (!token || !newPassword) {
      throw new InvalidPasswordResetTokenException();
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new WeakPasswordException(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
      );
    }

    const tokenHash = this.hashToken(token);
    const now = new Date();
    const record = await this.tokenRepository.findByTokenHash(tokenHash);
    if (!record || !record.isUsable(now)) {
      throw new InvalidPasswordResetTokenException();
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.userRepository.updatePasswordHash(record.userId, passwordHash);
    await this.tokenRepository.markUsed(record.id, now);
  }

  private hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }
}

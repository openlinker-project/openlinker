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
  USER_REPOSITORY_TOKEN,
  UserNotFoundException,
  UserNotPendingConfirmationException,
  type EmailConfirmationTokenRepositoryPort,
  type MailerPort,
  type User,
  type UserRepositoryPort,
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
    // Intentional: MailerPort injected directly rather than a dedicated
    // EmailConfirmationNotifierPort. This is the lighter-weight pattern for
    // single-purpose notifications (vs. PasswordResetNotifierPort, which
    // exists for a flow with more variation) — see the class header for
    // the full rationale (#1623/#1624).
    @Inject(MAILER_TOKEN)
    private readonly mailer: MailerPort,
    @Inject(USER_MANAGEMENT_SERVICE_TOKEN)
    private readonly userManagementService: IUserManagementService,
    @Inject(USER_REPOSITORY_TOKEN)
    private readonly userRepository: UserRepositoryPort,
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

    // The entire generate-token + persist-token + send-email sequence is
    // wrapped here (not just the mailer call) — a transient failure while
    // saving the token must not surface as a failed registration request
    // when the user row is already committed. The account still exists and
    // can be resent a link by an admin either way.
    try {
      const now = new Date();
      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = this.hashToken(rawToken);
      const expiresAt = new Date(now.getTime() + this.ttlMinutes * 60 * 1000);

      await this.tokenRepository.save({ userId: user.id, tokenHash, expiresAt });

      const base = this.configService.get<string>('WEB_URL', 'http://localhost:4173');
      const link = `${base.replace(/\/$/, '')}/confirm-email/${rawToken}`;
      const text = `Hello ${user.username},\n\nThanks for signing up for OpenLinker. Confirm your email address to activate your account:\n\n${link}\n\nThis link expires in ${Math.round(this.ttlMinutes / 60)} hours. If you did not create this account, you can ignore this email.`;

      await this.mailer.sendEmail({
        to: user.email,
        subject: 'Confirm your OpenLinker account',
        text,
      });
    } catch (error) {
      // Never let a token-persistence or transport failure (e.g. DB hiccup,
      // SMTP down) fail registration — the account is created either way;
      // the user can be resent a link by an admin. Mirrors
      // PasswordResetService's non-blocking send.
      this.logger.error(
        'Failed to generate/send email confirmation notification',
        (error as Error).stack
      );
    }
  }

  /**
   * Consumes the token in a single atomic conditional UPDATE
   * (`EmailConfirmationTokenRepositoryPort.consumeToken`) so two concurrent
   * requests presenting the same raw token can't both succeed — only one
   * `consumeToken` call ever observes a non-null `userId`. This closes the
   * find -> check -> activate -> markUsed race that would otherwise let a
   * second, losing caller reach `userManagementService.confirmEmail` against
   * an already-activated user and surface a `UserNotPendingConfirmationException`
   * (which carries the internal user id in its message — never let that
   * reach the HTTP layer, hence the catch-and-remap below).
   */
  async confirmEmail(token: string): Promise<void> {
    if (!token) {
      throw new InvalidEmailConfirmationTokenException();
    }

    const tokenHash = this.hashToken(token);
    const now = new Date();
    const userId = await this.tokenRepository.consumeToken(tokenHash, now);
    if (!userId) {
      // Distinct failure mode from the catch block below: no row matched
      // the atomic consume — the token itself is unknown, expired, or
      // already used. Logged so ops can tell this apart from "token was
      // consumed fine, activation itself failed" (#1649).
      this.logger.warn('Email confirmation failed: no matching unconsumed token');
      throw new InvalidEmailConfirmationTokenException();
    }

    try {
      await this.userManagementService.confirmEmail(userId);
      this.logger.log(`Email confirmed and account activated: ${userId}`);
    } catch (error) {
      if (
        error instanceof UserNotPendingConfirmationException ||
        error instanceof UserNotFoundException
      ) {
        // Token was valid and consumed, but the user was either no longer
        // in `pending_confirmation` status (e.g. already activated through
        // another path) or no longer exists (e.g. removed by the demo
        // account cleanup job in the window between consumeToken and this
        // call). Both exceptions carry the internal user id in their
        // message — never let that reach the HTTP layer or the log, so we
        // remap to the same generic invalid-token error the public endpoint
        // already returns for every other invalid-token case. The original
        // exception's constructor name (never its message — that's the
        // part carrying the user id) is logged server-side BEFORE the
        // remap, so ops can distinguish "token fine, activation failed for
        // an unrelated reason" from a genuinely bad token (#1649) — the
        // regression this closes is that the previous remap discarded this
        // distinction before `AuthController`'s own logging ever saw it.
        this.logger.warn(
          `Email confirmation token was consumed but activation failed: ${error.constructor.name}`
        );
        throw new InvalidEmailConfirmationTokenException();
      }
      throw error;
    }
  }

  async resendConfirmation(email: string): Promise<void> {
    const user = await this.userRepository.findByEmail(email);
    if (!user || user.status !== 'pending_confirmation') {
      // No-op for an unknown email or an account not awaiting confirmation
      // (already active, deactivated, etc.) — mirrors
      // PasswordResetService.requestReset's enumeration-safe posture. The
      // caller always returns the same generic 200 regardless.
      this.logger.debug('Resend confirmation requested for a non-pending-confirmation account');
      return;
    }

    const now = new Date();
    // Invalidate any previously-issued, still-unconsumed token first so a
    // stale link from an earlier email can no longer be used once the new
    // one is sent (#1649) — mirrors
    // PasswordResetTokenRepositoryPort.invalidateActiveForUser.
    await this.tokenRepository.invalidateActiveForUser(user.id, now);
    await this.sendConfirmation(user);
  }

  private hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }
}

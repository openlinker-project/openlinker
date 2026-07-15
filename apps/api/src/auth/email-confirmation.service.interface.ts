/**
 * Email Confirmation Service Interface
 *
 * Contract for the email-confirmation flow: issuing a single-use token and
 * sending it to a newly self-registered (demo) user, and consuming that
 * token to activate the account.
 *
 * @module apps/api/src/auth
 */
import type { User } from '@openlinker/core/users';

export interface IEmailConfirmationService {
  /**
   * Issues a single-use confirmation token for `user` and emails the
   * confirmation link. Never throws on transport failure — mirrors
   * PasswordResetService's non-blocking send (log-only).
   */
  sendConfirmation(user: User): Promise<void>;

  /**
   * Validates a raw confirmation token and, if usable, activates the
   * underlying account. Throws InvalidEmailConfirmationTokenException for an
   * unknown/expired/used token.
   */
  confirmEmail(token: string): Promise<void>;
}

export const EMAIL_CONFIRMATION_SERVICE_TOKEN = Symbol('IEmailConfirmationService');

/**
 * Email Confirmation Token Repository Port
 *
 * Persistence contract for email confirmation tokens. Implemented by
 * EmailConfirmationTokenRepository in the infrastructure layer.
 *
 * @module libs/core/src/users/domain/ports
 */
import type { EmailConfirmationToken } from '../entities/email-confirmation-token.entity';

export interface EmailConfirmationTokenRepositoryPort {
  save(
    token: Pick<EmailConfirmationToken, 'userId' | 'tokenHash' | 'expiresAt'>
  ): Promise<EmailConfirmationToken>;

  /**
   * Atomically consumes an unexpired, not-yet-used token in a single
   * conditional UPDATE ... RETURNING statement — the only correct way to
   * make single-use token consumption race-safe against two concurrent
   * requests presenting the same raw token. Returns the token's `userId`
   * on success, or `null` if no row matched (unknown, expired, or already
   * consumed) — guaranteeing at most one caller ever observes a non-null
   * result for a given token.
   */
  consumeToken(tokenHash: string, now: Date): Promise<string | null>;

  /**
   * Marks every still-unconsumed token for `userId` as used as of `now`.
   * Called before issuing a fresh token (resend, #1649) so a stale link
   * from an earlier email can no longer be used once a newer one has been
   * sent — mirrors `PasswordResetTokenRepositoryPort.invalidateActiveForUser`.
   */
  invalidateActiveForUser(userId: string, now: Date): Promise<void>;
}

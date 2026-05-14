/**
 * Password Reset Token Repository Port
 *
 * Persistence contract for password reset tokens. Implemented by
 * PasswordResetTokenRepository in the infrastructure layer.
 *
 * @module libs/core/src/users/domain/ports
 */
import type { PasswordResetToken } from '../entities/password-reset-token.entity';

export interface PasswordResetTokenRepositoryPort {
  save(
    token: Pick<PasswordResetToken, 'userId' | 'tokenHash' | 'expiresAt'>
  ): Promise<PasswordResetToken>;
  findByTokenHash(tokenHash: string): Promise<PasswordResetToken | null>;
  markUsed(id: string, usedAt: Date): Promise<void>;
  invalidateActiveForUser(userId: string, now: Date): Promise<void>;
}

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
  findByTokenHash(tokenHash: string): Promise<EmailConfirmationToken | null>;
  markUsed(id: string, usedAt: Date): Promise<void>;
}

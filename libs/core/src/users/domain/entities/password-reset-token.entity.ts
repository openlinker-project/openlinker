/**
 * Password Reset Token Domain Entity
 *
 * Single-use, short-lived token allowing a user to reset their password.
 * The raw token is never stored — only its SHA-256 hash.
 *
 * @module libs/core/src/users/domain/entities
 */

export class PasswordResetToken {
  constructor(
    public readonly id: string,
    public readonly userId: string,
    public readonly tokenHash: string,
    public readonly expiresAt: Date,
    public readonly usedAt: Date | null,
    public readonly createdAt: Date,
  ) {}

  isUsable(now: Date = new Date()): boolean {
    return this.usedAt === null && this.expiresAt.getTime() > now.getTime();
  }
}

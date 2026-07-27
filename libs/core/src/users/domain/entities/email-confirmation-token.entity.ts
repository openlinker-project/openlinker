/**
 * Email Confirmation Token Domain Entity
 *
 * Single-use, time-limited token allowing a newly self-registered user to
 * confirm ownership of the email address they registered with. Mirrors
 * `PasswordResetToken` (#1624) — the raw token is never stored, only its
 * SHA-256 hash.
 *
 * @module libs/core/src/users/domain/entities
 */

export class EmailConfirmationToken {
  constructor(
    public readonly id: string,
    public readonly userId: string,
    public readonly tokenHash: string,
    public readonly expiresAt: Date,
    public readonly usedAt: Date | null,
    public readonly createdAt: Date,
  ) {}

  isUsable(now: Date): boolean {
    return this.usedAt === null && this.expiresAt.getTime() > now.getTime();
  }
}

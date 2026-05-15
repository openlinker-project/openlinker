/**
 * Refresh Token Domain Entity
 *
 * Server-side record of an issued refresh token. The raw token is
 * never persisted — only its SHA-256 hash. `rotatedFromId` links each
 * refresh to its predecessor, forming the rotation chain that
 * `RefreshTokenService.rotate` walks on reuse-detection.
 *
 * @module libs/core/src/users/domain/entities
 */
import type { RefreshTokenRevocationReason } from '../types/refresh-token.types';

export class RefreshToken {
  constructor(
    public readonly id: string,
    public readonly userId: string,
    public readonly tokenHash: string,
    public readonly issuedAt: Date,
    public readonly expiresAt: Date,
    public readonly rotatedFromId: string | null,
    public readonly revokedAt: Date | null,
    public readonly revokedReason: RefreshTokenRevocationReason | null,
  ) {}

  isRevoked(): boolean {
    return this.revokedAt !== null;
  }

  isActive(now: Date = new Date()): boolean {
    return this.revokedAt === null && this.expiresAt.getTime() > now.getTime();
  }
}

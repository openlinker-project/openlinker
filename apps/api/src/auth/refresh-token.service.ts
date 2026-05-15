/**
 * Refresh Token Service
 *
 * Implements the refresh-token rotation flow described in #710. Holds
 * three concerns:
 *
 * 1. Random token generation + SHA-256 hashing — the raw token is
 *    returned once to the caller (controller → cookie) and is never
 *    persisted; only its hash hits the DB.
 * 2. Rotation: each successful refresh revokes the presented row and
 *    inserts a successor whose `rotated_from_id` points at the
 *    predecessor.
 * 3. Reuse detection: if a presented row is already revoked, the
 *    entire rotation chain rooted at that user is wiped before the
 *    exception is thrown. This is the "stolen cookie" branch.
 *
 * @module apps/api/src/auth
 * @implements {IRefreshTokenService}
 */
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'crypto';
import {
  RefreshToken,
  RefreshTokenReuseDetectedException,
  REFRESH_TOKEN_REPOSITORY_TOKEN,
} from '@openlinker/core/users';
import { RefreshTokenRepositoryPort } from '@openlinker/core/users';
import type { IRefreshTokenService } from './refresh-token.service.interface';
import {
  REFRESH_TOKEN_TTL_MS,
  type IssuedRefreshToken,
  type RotatedRefreshToken,
} from './refresh-token.types';

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

@Injectable()
export class RefreshTokenService implements IRefreshTokenService {
  constructor(
    @Inject(REFRESH_TOKEN_REPOSITORY_TOKEN)
    private readonly repository: RefreshTokenRepositoryPort,
  ) {}

  async issue(userId: string): Promise<IssuedRefreshToken> {
    return this.persist(userId, null);
  }

  async rotate(rawToken: string): Promise<RotatedRefreshToken> {
    const presented = await this.repository.findByHash(hashToken(rawToken));
    if (!presented) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (presented.isRevoked()) {
      await this.repository.revokeChain(presented.id, 'reuse_detected');
      throw new RefreshTokenReuseDetectedException();
    }
    if (!presented.isActive()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    await this.repository.revoke(presented.id, 'rotated');
    const next = await this.persist(presented.userId, presented.id);
    return {
      userId: presented.userId,
      rawToken: next.rawToken,
      expiresAt: next.expiresAt,
    };
  }

  async revoke(rawToken: string): Promise<void> {
    const presented = await this.repository.findByHash(hashToken(rawToken));
    if (!presented) return;
    if (presented.isRevoked()) return;
    await this.repository.revoke(presented.id, 'logout');
  }

  private async persist(
    userId: string,
    rotatedFromId: string | null,
  ): Promise<IssuedRefreshToken> {
    const rawToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    const token = new RefreshToken(
      randomUUID(),
      userId,
      hashToken(rawToken),
      new Date(),
      expiresAt,
      rotatedFromId,
      null,
      null,
    );
    await this.repository.insert(token);
    return { rawToken, expiresAt };
  }
}

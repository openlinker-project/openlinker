/**
 * RefreshTokenService Unit Tests
 *
 * Covers the three flows: issue (login), rotate (happy + reuse +
 * expired), revoke (logout idempotency).
 *
 * @module apps/api/src/auth
 */
import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { RefreshTokenService } from './refresh-token.service';
import { REFRESH_TOKEN_TTL_MS } from './refresh-token.types';
import { RefreshToken, RefreshTokenReuseDetectedException } from '@openlinker/core/users';
import type { RefreshTokenRepositoryPort } from '@openlinker/core/users';

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

const makeToken = (overrides: Partial<RefreshToken> = {}): RefreshToken =>
  new RefreshToken(
    overrides.id ?? 'rt-1',
    overrides.userId ?? 'user-1',
    overrides.tokenHash ?? hashToken('raw'),
    overrides.issuedAt ?? new Date(),
    overrides.expiresAt ?? new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    overrides.rotatedFromId ?? null,
    overrides.revokedAt ?? null,
    overrides.revokedReason ?? null,
  );

describe('RefreshTokenService', () => {
  let repository: jest.Mocked<RefreshTokenRepositoryPort>;
  let service: RefreshTokenService;

  beforeEach(() => {
    repository = {
      insert: jest.fn().mockImplementation((t: RefreshToken) => Promise.resolve(t)),
      findByHash: jest.fn(),
      revoke: jest.fn().mockResolvedValue(undefined),
      revokeChain: jest.fn().mockResolvedValue(undefined),
    };
    service = new RefreshTokenService(repository);
  });

  describe('issue', () => {
    it('inserts a top-of-chain token (rotatedFromId=null) and returns the raw value', async () => {
      const result = await service.issue('user-1');

      expect(repository.insert).toHaveBeenCalledTimes(1);
      const inserted = repository.insert.mock.calls[0][0];
      expect(inserted.userId).toBe('user-1');
      expect(inserted.rotatedFromId).toBeNull();
      expect(inserted.tokenHash).toBe(hashToken(result.rawToken));
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('rotate', () => {
    it('revokes the predecessor and inserts a successor with rotated_from_id set', async () => {
      const presented = makeToken();
      repository.findByHash.mockResolvedValue(presented);

      const result = await service.rotate('raw');

      expect(repository.revoke).toHaveBeenCalledWith(presented.id, 'rotated');
      expect(repository.insert).toHaveBeenCalledTimes(1);
      const inserted = repository.insert.mock.calls[0][0];
      expect(inserted.rotatedFromId).toBe(presented.id);
      expect(inserted.userId).toBe(presented.userId);
      expect(result.userId).toBe(presented.userId);
      expect(result.rawToken).not.toBe('raw');
    });

    it('throws RefreshTokenReuseDetectedException AFTER wiping the chain on revoked token', async () => {
      const presented = makeToken({
        revokedAt: new Date(Date.now() - 60_000),
        revokedReason: 'rotated',
      });
      repository.findByHash.mockResolvedValue(presented);

      await expect(service.rotate('raw')).rejects.toBeInstanceOf(
        RefreshTokenReuseDetectedException,
      );
      expect(repository.revokeChain).toHaveBeenCalledWith(presented.id, 'reuse_detected');
      expect(repository.insert).not.toHaveBeenCalled();
    });

    it('throws 401 when token unknown', async () => {
      repository.findByHash.mockResolvedValue(null);
      await expect(service.rotate('missing')).rejects.toThrow(UnauthorizedException);
      expect(repository.revoke).not.toHaveBeenCalled();
      expect(repository.revokeChain).not.toHaveBeenCalled();
    });

    it('throws 401 when token expired (active but past expiry)', async () => {
      const expired = makeToken({
        expiresAt: new Date(Date.now() - 60_000),
      });
      repository.findByHash.mockResolvedValue(expired);
      await expect(service.rotate('raw')).rejects.toThrow(UnauthorizedException);
      expect(repository.revoke).not.toHaveBeenCalled();
    });
  });

  describe('revoke', () => {
    it('marks the token revoked with reason "logout"', async () => {
      const presented = makeToken();
      repository.findByHash.mockResolvedValue(presented);

      await service.revoke('raw');

      expect(repository.revoke).toHaveBeenCalledWith(presented.id, 'logout');
    });

    it('is a no-op when token unknown', async () => {
      repository.findByHash.mockResolvedValue(null);
      await service.revoke('missing');
      expect(repository.revoke).not.toHaveBeenCalled();
    });

    it('is a no-op when token already revoked', async () => {
      repository.findByHash.mockResolvedValue(makeToken({ revokedAt: new Date() }));
      await service.revoke('raw');
      expect(repository.revoke).not.toHaveBeenCalled();
    });
  });
});

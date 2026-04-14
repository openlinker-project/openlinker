/**
 * PasswordResetService unit tests.
 */
import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { PasswordResetService } from './password-reset.service';
import {
  InvalidPasswordResetTokenException,
  PasswordResetToken,
  User,
  type PasswordResetNotifierPort,
  type PasswordResetTokenRepositoryPort,
  type UserRepositoryPort,
} from '@openlinker/core/users';

const makeUser = (): User =>
  new User('u-1', 'admin', 'admin@example.com', 'hash', 'admin', new Date(), new Date());

const makeConfig = (ttl = 60) =>
  ({ get: jest.fn(() => ttl) }) as unknown as import('@nestjs/config').ConfigService;

function makeMocks() {
  const userRepo: jest.Mocked<UserRepositoryPort> = {
    findByUsername: jest.fn(),
    findByEmail: jest.fn(),
    findById: jest.fn(),
    save: jest.fn(),
    updatePasswordHash: jest.fn(),
  };
  const tokenRepo: jest.Mocked<PasswordResetTokenRepositoryPort> = {
    save: jest.fn(),
    findByTokenHash: jest.fn(),
    markUsed: jest.fn(),
    invalidateActiveForUser: jest.fn(),
  };
  const notifier: jest.Mocked<PasswordResetNotifierPort> = {
    notifyResetRequested: jest.fn(),
  };
  return { userRepo, tokenRepo, notifier };
}

describe('PasswordResetService', () => {
  describe('requestReset', () => {
    it('returns silently when email is unknown (no enumeration, no notify)', async () => {
      const { userRepo, tokenRepo, notifier } = makeMocks();
      userRepo.findByEmail.mockResolvedValue(null);
      const service = new PasswordResetService(userRepo, tokenRepo, notifier, makeConfig());

      await service.requestReset('missing@example.com');

      expect(tokenRepo.save).not.toHaveBeenCalled();
      expect(notifier.notifyResetRequested).not.toHaveBeenCalled();
    });

    it('invalidates prior tokens, stores hashed token, and notifies', async () => {
      const { userRepo, tokenRepo, notifier } = makeMocks();
      const user = makeUser();
      userRepo.findByEmail.mockResolvedValue(user);
      tokenRepo.save.mockImplementation((t) =>
        Promise.resolve(
          new PasswordResetToken('t-1', t.userId, t.tokenHash, t.expiresAt, null, new Date()),
        ),
      );
      const service = new PasswordResetService(userRepo, tokenRepo, notifier, makeConfig(60));

      await service.requestReset(user.email!);

      expect(tokenRepo.invalidateActiveForUser).toHaveBeenCalledWith(user.id, expect.any(Date));
      expect(tokenRepo.save).toHaveBeenCalledTimes(1);
      const saved = tokenRepo.save.mock.calls[0][0];
      expect(saved.userId).toBe(user.id);
      expect(saved.tokenHash).toHaveLength(64);
      expect(notifier.notifyResetRequested).toHaveBeenCalledWith(user, expect.any(String));
      const rawToken = notifier.notifyResetRequested.mock.calls[0][1];
      // Notifier receives the raw token; storage keeps only its sha256 hash
      expect(saved.tokenHash).toBe(createHash('sha256').update(rawToken).digest('hex'));
    });
  });

  describe('resetPassword', () => {
    it('throws Invalid... when token is unknown', async () => {
      const { userRepo, tokenRepo, notifier } = makeMocks();
      tokenRepo.findByTokenHash.mockResolvedValue(null);
      const service = new PasswordResetService(userRepo, tokenRepo, notifier, makeConfig());
      await expect(service.resetPassword('nope', 'longenough')).rejects.toThrow(
        InvalidPasswordResetTokenException,
      );
    });

    it('throws Invalid... when token is expired', async () => {
      const { userRepo, tokenRepo, notifier } = makeMocks();
      const past = new Date(Date.now() - 1000);
      tokenRepo.findByTokenHash.mockResolvedValue(
        new PasswordResetToken('t-1', 'u-1', 'h', past, null, new Date()),
      );
      const service = new PasswordResetService(userRepo, tokenRepo, notifier, makeConfig());
      await expect(service.resetPassword('raw', 'longenough')).rejects.toThrow(
        InvalidPasswordResetTokenException,
      );
    });

    it('throws Invalid... when token is already used', async () => {
      const { userRepo, tokenRepo, notifier } = makeMocks();
      const future = new Date(Date.now() + 60_000);
      tokenRepo.findByTokenHash.mockResolvedValue(
        new PasswordResetToken('t-1', 'u-1', 'h', future, new Date(), new Date()),
      );
      const service = new PasswordResetService(userRepo, tokenRepo, notifier, makeConfig());
      await expect(service.resetPassword('raw', 'longenough')).rejects.toThrow(
        InvalidPasswordResetTokenException,
      );
    });

    it('throws BadRequest when password is too short', async () => {
      const { userRepo, tokenRepo, notifier } = makeMocks();
      const service = new PasswordResetService(userRepo, tokenRepo, notifier, makeConfig());
      await expect(service.resetPassword('raw', 'short')).rejects.toThrow(BadRequestException);
    });

    it('hashes new password, updates user, marks token used', async () => {
      const { userRepo, tokenRepo, notifier } = makeMocks();
      const future = new Date(Date.now() + 60_000);
      tokenRepo.findByTokenHash.mockResolvedValue(
        new PasswordResetToken('t-1', 'u-1', 'h', future, null, new Date()),
      );
      const service = new PasswordResetService(userRepo, tokenRepo, notifier, makeConfig());

      await service.resetPassword('raw', 'longenough');

      expect(userRepo.updatePasswordHash).toHaveBeenCalledTimes(1);
      const [userId, hash] = userRepo.updatePasswordHash.mock.calls[0];
      expect(userId).toBe('u-1');
      expect(await bcrypt.compare('longenough', hash)).toBe(true);
      expect(tokenRepo.markUsed).toHaveBeenCalledWith('t-1', expect.any(Date));
    });
  });
});

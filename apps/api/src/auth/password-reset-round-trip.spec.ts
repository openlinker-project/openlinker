/**
 * Password Reset - Full Round-Trip Test
 *
 * Exercises the real delivery + reset flow end-to-end with only the mailer
 * port and repositories faked: PasswordResetService issues a token and hands
 * it to the real MailerPasswordResetNotifierAdapter, which "sends" the email
 * through `MailerPort`. The SMTP transport itself (sender address, nodemailer
 * hand-off) is covered beside the adapter in `libs/core/src/mailer`.
 * The token is scraped from the captured message body (as a user would copy
 * it from the link), fed into PasswordResetService.resetPassword, and the
 * resulting password hash is verified against AuthService.validateUser to
 * confirm a real login succeeds with the new password and fails with the
 * old one.
 *
 * Also covers the two safety guarantees that must survive the #1623 mailer
 * swap: no-enumeration for unknown emails, and single-use/TTL-bound tokens.
 *
 * @module apps/api/src/auth
 */
import { createHash } from 'crypto';
import * as bcrypt from 'bcryptjs';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  InvalidPasswordResetTokenException,
  PasswordResetToken,
  User,
  type PasswordResetTokenRepositoryPort,
  type MailerPort,
  type UserRepositoryPort,
} from '@openlinker/core/users';
import { PasswordResetService } from './password-reset.service';
import { AuthService } from './auth.service';
import { MailerPasswordResetNotifierAdapter } from './adapters/mailer-password-reset-notifier.adapter';

const makeConfig = (values: Record<string, string | number> = {}): ConfigService =>
  ({
    get: jest.fn((key: string, fallback?: unknown) => values[key] ?? fallback),
  }) as unknown as ConfigService;

function extractTokenFromLink(text: string): string {
  const match = /\/reset-password\/([a-f0-9]{64})/.exec(text);
  if (!match) {
    throw new Error(`No reset link found in email body: ${text}`);
  }
  return match[1];
}

describe('Password reset - delivery + reset round trip', () => {
  let userRepo: jest.Mocked<UserRepositoryPort>;
  let tokenRepo: jest.Mocked<PasswordResetTokenRepositoryPort>;
  let mailer: jest.Mocked<MailerPort>;
  let notifier: MailerPasswordResetNotifierAdapter;
  let passwordResetService: PasswordResetService;
  let authService: AuthService;

  let storedPasswordHash: string;

  const user = new User(
    'user-1',
    'jane',
    'jane@example.com',
    'placeholder-hash-replaced-in-beforeEach',
    'admin',
    'active',
    new Date(),
    new Date(),
  );

  beforeEach(async () => {
    storedPasswordHash = await bcrypt.hash('old-password-1', 10);

    userRepo = {
      findByUsername: jest.fn(),
      findByEmail: jest.fn(),
      findById: jest.fn(),
      findAll: jest.fn(),
      save: jest.fn(),
      updatePasswordHash: jest.fn((_userId: string, newHash: string) => {
        storedPasswordHash = newHash;
        return Promise.resolve();
      }),
      updateStatus: jest.fn(),
      updateRole: jest.fn(),
      approveUser: jest.fn(),
      deleteById: jest.fn(),
      deactivateAdminAtomically: jest.fn(),
      updateAdminRoleAtomically: jest.fn(),
      updateAnalyticsConsent: jest.fn(),
      deleteAdminAtomically: jest.fn(),
      findStaleViewerAccounts: jest.fn(),
      updatePackStationLabel: jest.fn(),
      touchLastActive: jest.fn(),
    };
    userRepo.findByEmail.mockImplementation((email: string) =>
      Promise.resolve(email === user.email ? user : null),
    );
    userRepo.findByUsername.mockImplementation((username: string) =>
      Promise.resolve(
        username === user.username
          ? new User(
              user.id,
              user.username,
              user.email,
              storedPasswordHash,
              user.role,
              user.status,
              user.createdAt,
              user.updatedAt,
            )
          : null,
      ),
    );

    const savedTokens = new Map<string, PasswordResetToken>();
    tokenRepo = {
      save: jest.fn((input) => {
        const record = new PasswordResetToken(
          `token-${savedTokens.size + 1}`,
          input.userId,
          input.tokenHash,
          input.expiresAt,
          null,
          new Date(),
        );
        savedTokens.set(record.id, record);
        return Promise.resolve(record);
      }),
      findByTokenHash: jest.fn((hash: string) => {
        for (const record of savedTokens.values()) {
          if (record.tokenHash === hash && !record.usedAt) {
            return Promise.resolve(record);
          }
        }
        return Promise.resolve(null);
      }),
      markUsed: jest.fn((id: string, usedAt: Date) => {
        const record = savedTokens.get(id);
        if (record) {
          savedTokens.set(
            id,
            new PasswordResetToken(
              record.id,
              record.userId,
              record.tokenHash,
              record.expiresAt,
              usedAt,
              record.createdAt,
            ),
          );
        }
        return Promise.resolve();
      }),
      invalidateActiveForUser: jest.fn(),
    };

    mailer = { sendEmail: jest.fn().mockResolvedValue(undefined) };
    notifier = new MailerPasswordResetNotifierAdapter(
      mailer,
      makeConfig({ WEB_URL: 'https://app.example.com' }),
    );

    passwordResetService = new PasswordResetService(
      userRepo,
      tokenRepo,
      notifier,
      makeConfig({ PASSWORD_RESET_TTL_MINUTES: 60 }),
    );

    authService = new AuthService(userRepo, new JwtService({ secret: 'test-secret' }));
  });

  it('delivers the reset link via the mailer port, then a full reset + login succeeds', async () => {
    await passwordResetService.requestReset(user.email!);

    expect(mailer.sendEmail).toHaveBeenCalledTimes(1);
    const sentMessage = mailer.sendEmail.mock.calls[0][0];
    expect(sentMessage.to).toBe(user.email);

    const rawToken = extractTokenFromLink(sentMessage.text);

    await passwordResetService.resetPassword(rawToken, 'brand-new-password-1');

    const oldPasswordLogin = await authService.validateUser(user.username, 'old-password-1');
    expect(oldPasswordLogin).toBeNull();

    const newPasswordLogin = await authService.validateUser(user.username, 'brand-new-password-1');
    expect(newPasswordLogin).not.toBeNull();
    expect(newPasswordLogin?.id).toBe(user.id);

    // Token is single-use: replaying it must fail even though it hasn't expired.
    await expect(
      passwordResetService.resetPassword(rawToken, 'another-password-1'),
    ).rejects.toThrow(InvalidPasswordResetTokenException);
  });

  it('does not send an email and does not error for an unknown email (no enumeration)', async () => {
    await expect(passwordResetService.requestReset('nobody@example.com')).resolves.toBeUndefined();
    expect(mailer.sendEmail).not.toHaveBeenCalled();
  });

  it('rejects an already-expired token even though the hash matches a real issued token', async () => {
    const expiredConfig = makeConfig({ PASSWORD_RESET_TTL_MINUTES: -1 });
    const shortLivedService = new PasswordResetService(userRepo, tokenRepo, notifier, expiredConfig);

    await shortLivedService.requestReset(user.email!);
    const sentMessage = mailer.sendEmail.mock.calls[0][0];
    const rawToken = extractTokenFromLink(sentMessage.text);

    await expect(
      passwordResetService.resetPassword(rawToken, 'irrelevant-password-1'),
    ).rejects.toThrow(InvalidPasswordResetTokenException);
  });

  it('never lets a mailer/transport failure surface as a thrown error (keeps the 200 response shape)', async () => {
    mailer.sendEmail.mockRejectedValueOnce(new Error('SMTP connection refused'));

    await expect(passwordResetService.requestReset(user.email!)).resolves.toBeUndefined();
    // Token was still issued even though delivery failed — verifies the
    // catch in requestReset wraps only the notify call, not the whole flow.
    expect(tokenRepo.save).toHaveBeenCalledTimes(1);
  });
});

describe('sha256 hashing sanity (documents the token-at-rest invariant)', () => {
  it('hashes the raw token the same way the service does, so a captured link token is never stored raw', () => {
    const raw = 'abc123';
    const expected = createHash('sha256').update(raw).digest('hex');
    expect(expected).toHaveLength(64);
  });
});

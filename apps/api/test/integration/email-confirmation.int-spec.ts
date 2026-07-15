/**
 * Email Confirmation Integration Test
 *
 * Regression coverage for #1649: a freshly self-registered `pending_confirmation`
 * account got permanently stuck because `EmailConfirmationTokenRepository.consumeToken`
 * passed the raw DB column name (`user_id`) to TypeORM's QueryBuilder#returning
 * instead of the entity property name (`userId`). TypeORM resolves `.returning()`
 * entries against column metadata keyed by property name, so it silently emitted
 * no RETURNING output for the unrecognized name — the UPDATE still ran
 * (`affected: 1`, `used_at` correctly set) but `result.raw` came back empty,
 * so `consumeToken` always returned `null` even for a perfectly valid,
 * unexpired, first-and-only-use token. `EmailConfirmationService.confirmEmail`
 * then always threw `InvalidEmailConfirmationTokenException` on the very
 * first, uncontended call — no race or double-fire needed to reproduce.
 *
 * Only a mock-based unit test existed for `EmailConfirmationService` before
 * this — the token repository itself had no real-Postgres coverage, which is
 * why a `.returning()` argument that TypeORM resolves silently (no runtime
 * error, no type error) went unnoticed.
 *
 * @module apps/api/test/integration
 */
import { createHash } from 'crypto';
import {
  USER_REPOSITORY_TOKEN,
  EMAIL_CONFIRMATION_TOKEN_REPOSITORY_TOKEN,
  InvalidEmailConfirmationTokenException,
  type UserRepositoryPort,
  type EmailConfirmationTokenRepositoryPort,
} from '@openlinker/core/users';
import {
  EMAIL_CONFIRMATION_SERVICE_TOKEN,
  type IEmailConfirmationService,
} from '../../src/auth/email-confirmation.service.interface';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { IntegrationTestHarness } from './setup';

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

describe('Email Confirmation Integration (real Postgres)', () => {
  let harness: IntegrationTestHarness;
  let userRepository: UserRepositoryPort;
  let tokenRepository: EmailConfirmationTokenRepositoryPort;
  let emailConfirmationService: IEmailConfirmationService;

  beforeAll(async () => {
    harness = await getTestHarness();
    userRepository = harness.getApp().get<UserRepositoryPort>(USER_REPOSITORY_TOKEN);
    tokenRepository = harness
      .getApp()
      .get<EmailConfirmationTokenRepositoryPort>(EMAIL_CONFIRMATION_TOKEN_REPOSITORY_TOKEN);
    emailConfirmationService = harness
      .getApp()
      .get<IEmailConfirmationService>(EMAIL_CONFIRMATION_SERVICE_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('activates a freshly registered pending_confirmation user on a single, uncontended confirmEmail call', async () => {
    const user = await userRepository.save({
      username: 'demo_user_1649',
      email: 'demo1649@test.com',
      passwordHash: 'hash',
      role: 'viewer',
      status: 'pending_confirmation',
    });

    const rawToken = 'a'.repeat(64);
    await tokenRepository.save({
      userId: user.id,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    await emailConfirmationService.confirmEmail(rawToken);

    const reloaded = await userRepository.findById(user.id);
    expect(reloaded?.status).toBe('active');
  });

  it('still rejects an unknown/already-used token (guards against an always-succeeds regression)', async () => {
    await expect(emailConfirmationService.confirmEmail('never-issued-token')).rejects.toThrow(
      InvalidEmailConfirmationTokenException,
    );
  });

  it('rejects a token that has already been consumed once', async () => {
    const user = await userRepository.save({
      username: 'demo_user_1649b',
      email: 'demo1649b@test.com',
      passwordHash: 'hash',
      role: 'viewer',
      status: 'pending_confirmation',
    });
    const rawToken = 'b'.repeat(64);
    await tokenRepository.save({
      userId: user.id,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    await emailConfirmationService.confirmEmail(rawToken);

    await expect(emailConfirmationService.confirmEmail(rawToken)).rejects.toThrow(
      InvalidEmailConfirmationTokenException,
    );
  });

  describe('resendConfirmation', () => {
    it('invalidates the previous unconsumed token so only the newest link works', async () => {
      const user = await userRepository.save({
        username: 'demo_user_1649c',
        email: 'demo1649c@test.com',
        passwordHash: 'hash',
        role: 'viewer',
        status: 'pending_confirmation',
      });
      const staleRawToken = 'c'.repeat(64);
      await tokenRepository.save({
        userId: user.id,
        tokenHash: hashToken(staleRawToken),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });

      await emailConfirmationService.resendConfirmation('demo1649c@test.com');

      // The stale link from before the resend must no longer work.
      await expect(emailConfirmationService.confirmEmail(staleRawToken)).rejects.toThrow(
        InvalidEmailConfirmationTokenException,
      );

      const reloaded = await userRepository.findById(user.id);
      expect(reloaded?.status).toBe('pending_confirmation');
    });

    it('does not throw for an unknown email (enumeration-safe)', async () => {
      await expect(
        emailConfirmationService.resendConfirmation('no-such-account@test.com'),
      ).resolves.toBeUndefined();
    });

    it('does not throw and does not affect an already-active account', async () => {
      const user = await userRepository.save({
        username: 'demo_user_1649d',
        email: 'demo1649d@test.com',
        passwordHash: 'hash',
        role: 'viewer',
        status: 'active',
      });

      await expect(
        emailConfirmationService.resendConfirmation('demo1649d@test.com'),
      ).resolves.toBeUndefined();

      const reloaded = await userRepository.findById(user.id);
      expect(reloaded?.status).toBe('active');
    });
  });
});

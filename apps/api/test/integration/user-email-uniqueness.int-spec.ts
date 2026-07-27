/**
 * User Email Uniqueness Integration Test
 *
 * Proves the case-insensitive unique-email guarantee (#1625) against a REAL
 * Postgres instance, not a mocked `QueryFailedError`. `UserRepository.save`
 * normalizes email to trimmed-lowercase before INSERT and converts a `23505`
 * unique-violation on `UQ_users_email` into `UserAlreadyExistsException`; the
 * unit test in `user.repository.spec.ts` proves that catch-logic against a
 * hand-constructed error on a mocked ORM repository, but never exercises the
 * actual DB constraint. This test resolves the real `UserRepositoryPort`
 * from the app's DI container and calls `save()` directly twice — bypassing
 * `RegistrationService`'s `findByEmail` pre-check entirely — so the second
 * call is the only thing standing between two case-variant emails and a
 * silent duplicate row.
 *
 * @module apps/api/test/integration
 */
import { UserAlreadyExistsException, USER_REPOSITORY_TOKEN, type UserRepositoryPort } from '@openlinker/core/users';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { IntegrationTestHarness } from './setup';

describe('User Email Uniqueness (real Postgres)', () => {
  let harness: IntegrationTestHarness;
  let userRepository: UserRepositoryPort;

  beforeAll(async () => {
    harness = await getTestHarness();
    userRepository = harness.getApp().get<UserRepositoryPort>(USER_REPOSITORY_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('should genuinely violate the DB unique constraint for a case-variant duplicate email', async () => {
    await userRepository.save({
      username: 'alice',
      email: 'user@test.com',
      passwordHash: 'hash-1',
      role: 'viewer',
      status: 'pending',
    });

    // Different username and different email casing — RegistrationService's
    // findByEmail pre-check would already catch this via case-insensitive
    // lookup, so calling save() directly is the only way to reach the real
    // constraint on the normalized (lowercased) column value.
    await expect(
      userRepository.save({
        username: 'bob',
        email: 'User@Test.com',
        passwordHash: 'hash-2',
        role: 'viewer',
        status: 'pending',
      })
    ).rejects.toThrow(UserAlreadyExistsException);

    // Confirm no duplicate row was actually persisted.
    const dataSource = harness.getDataSource();
    const rows = await dataSource.query<{ count: string }[]>(
      `SELECT count(*)::text as count FROM users WHERE email = $1`,
      ['user@test.com']
    );
    expect(rows[0].count).toBe('1');
  });

  it('should allow two users with genuinely distinct emails', async () => {
    await userRepository.save({
      username: 'carol',
      email: 'carol@test.com',
      passwordHash: 'hash-1',
      role: 'viewer',
      status: 'pending',
    });

    await expect(
      userRepository.save({
        username: 'dave',
        email: 'dave@test.com',
        passwordHash: 'hash-2',
        role: 'viewer',
        status: 'pending',
      })
    ).resolves.toBeDefined();
  });
});

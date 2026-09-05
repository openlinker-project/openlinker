/**
 * Auth Test Helpers
 *
 * Utilities for obtaining authenticated sessions in integration tests.
 *
 * @module apps/api/test/integration/helpers
 */
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { UserRole } from '@openlinker/core/users';

/**
 * Seed a user with a given role and return a valid Bearer token.
 *
 * Low-level helper used by `loginAsAdmin` and `loginAsViewer`. Callers that
 * need a specific role outside the two convenience wrappers can call this
 * directly.
 *
 * Note: username must be unique per test. Because resetTestHarness() truncates
 * the users table between tests, calling this once per test with the default
 * username is safe. If called multiple times in a single test, use distinct
 * usernames to avoid a unique-constraint violation.
 */
export async function loginAs(
  http: ReturnType<typeof request>,
  dataSource: DataSource,
  // `UserRole`, not a hand-listed tuple: the literals had to be extended by
  // hand for `packer` (#2413) and would silently exclude role five from every
  // integration test that needs to seed one.
  role: UserRole,
  username: string,
  password = 'test-password',
): Promise<string> {
  const passwordHash = await bcrypt.hash(password, 4);
  await dataSource.query(
    `INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, $4)`,
    [username, `${username}@example.com`, passwordHash, role],
  );

  const response = await http
    .post('/v1/auth/login')
    .send({ username, password })
    .expect(200);

  return response.body.access_token as string;
}

/**
 * Seed an admin user and return a valid Bearer token.
 */
export async function loginAsAdmin(
  http: ReturnType<typeof request>,
  dataSource: DataSource,
  username = 'admin',
  password = 'test-password',
): Promise<string> {
  return loginAs(http, dataSource, 'admin', username, password);
}

/**
 * Seed an operator user and return a valid Bearer token.
 */
export async function loginAsOperator(
  http: ReturnType<typeof request>,
  dataSource: DataSource,
  username = 'operator',
  password = 'test-password',
): Promise<string> {
  return loginAs(http, dataSource, 'operator', username, password);
}

/**
 * Seed a viewer user and return a valid Bearer token.
 */
export async function loginAsViewer(
  http: ReturnType<typeof request>,
  dataSource: DataSource,
  username = 'viewer',
  password = 'test-password',
): Promise<string> {
  return loginAs(http, dataSource, 'viewer', username, password);
}

/**
 * Seed a pack-bench packer and return a valid Bearer token (#2413, ADR-071).
 *
 * The bench has no principal of its own — a packer is an ordinary user on a
 * narrower role — so this is the same seeding path as every other role.
 */
export async function loginAsPacker(
  http: ReturnType<typeof request>,
  dataSource: DataSource,
  username = 'packer',
  password = 'test-password',
): Promise<string> {
  return loginAs(http, dataSource, 'packer', username, password);
}

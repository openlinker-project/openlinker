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
  role: 'admin' | 'viewer',
  username: string,
  password = 'test-password',
): Promise<string> {
  const passwordHash = await bcrypt.hash(password, 4);
  await dataSource.query(
    `INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, $4)`,
    [username, `${username}@example.com`, passwordHash, role],
  );

  const response = await http
    .post('/auth/login')
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

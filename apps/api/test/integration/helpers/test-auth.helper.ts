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
 * Seed a user and return a valid Bearer token
 *
 * Creates a user in the database and logs in to obtain a JWT.
 */
export async function loginAsAdmin(
  http: ReturnType<typeof request>,
  dataSource: DataSource,
  username = 'admin',
  password = 'test-password',
): Promise<string> {
  const passwordHash = await bcrypt.hash(password, 4);
  await dataSource.query(
    `INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3)`,
    [username, `${username}@example.com`, passwordHash],
  );

  const response = await http
    .post('/auth/login')
    .send({ username, password })
    .expect(200);

  return response.body.access_token as string;
}

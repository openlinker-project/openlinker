/**
 * Authentication Integration Test
 *
 * Vertical slice test for the full auth flow:
 * POST /auth/login → GET /auth/me → 401 scenarios.
 * Uses real Postgres via Testcontainers.
 *
 * @module apps/api/test/integration
 */
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { getTestHarness, IntegrationTestHarness, resetTestHarness, teardownTestHarness } from './setup';

async function seedUser(
  dataSource: DataSource,
  username: string,
  password: string,
  email: string | null = null,
): Promise<string> {
  // Use low cost factor (4) for test speed; real cost is set by the application layer
  const passwordHash = await bcrypt.hash(password, 4);
  const result = await dataSource.query<{ id: string }[]>(
    `INSERT INTO users (username, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [username, email, passwordHash],
  );
  return result[0].id;
}

describe('Auth Integration', () => {
  let harness: IntegrationTestHarness;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  describe('POST /auth/login', () => {
    it('should return access_token when credentials are valid', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();

      await seedUser(dataSource, 'testuser', 'correct-password');

      const response = await http
        .post('/auth/login')
        .send({ username: 'testuser', password: 'correct-password' })
        .expect(200);

      expect(response.body.access_token).toBeDefined();
      expect(typeof response.body.access_token).toBe('string');
      expect(response.body.access_token.length).toBeGreaterThan(20);
    });

    it('should return 401 when password is wrong', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();

      await seedUser(dataSource, 'testuser', 'correct-password');

      await http
        .post('/auth/login')
        .send({ username: 'testuser', password: 'wrong-password' })
        .expect(401);
    });

    it('should return 401 when user does not exist', async () => {
      const http = harness.getHttp();

      await http
        .post('/auth/login')
        .send({ username: 'ghost', password: 'any' })
        .expect(401);
    });
  });

  describe('GET /auth/me', () => {
    it('should return current user data when token is valid', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();

      await seedUser(dataSource, 'meuser', 'password123', 'me@example.com');

      // Login to get token
      const loginResponse = await http
        .post('/auth/login')
        .send({ username: 'meuser', password: 'password123' })
        .expect(200);

      const token: string = loginResponse.body.access_token as string;

      // Use token to fetch current user
      const meResponse = await http
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(meResponse.body.username).toBe('meuser');
      expect(meResponse.body.email).toBe('me@example.com');
      expect(meResponse.body.id).toBeDefined();
      // passwordHash must never be returned
      expect(meResponse.body.passwordHash).toBeUndefined();
    });

    it('should return 401 when no token is provided', async () => {
      const http = harness.getHttp();

      await http.get('/auth/me').expect(401);
    });

    it('should return 401 when token is invalid', async () => {
      const http = harness.getHttp();

      await http
        .get('/auth/me')
        .set('Authorization', 'Bearer this.is.not.valid')
        .expect(401);
    });
  });
});

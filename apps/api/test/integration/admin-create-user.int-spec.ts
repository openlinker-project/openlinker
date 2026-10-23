/**
 * Admin Create User Integration Test (#3456)
 *
 * Vertical slice for an admin creating an account with a one-time password:
 * POST /users → users row → the person signs in with the one-time password →
 * every route but /auth/me and the change route answers 403
 * PASSWORD_CHANGE_REQUIRED → POST /auth/me/password → a fresh sign-in has
 * full access for its role.
 *
 * Runs against the real global guard chain (JwtAuthGuard, RolesGuard,
 * AnalyticsConsentGuard, PasswordChangeRequiredGuard), which a unit test of
 * any one of them cannot show.
 *
 * @module apps/api/test/integration
 */
import type { DataSource } from 'typeorm';
import type request from 'supertest';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';
import { loginAsAdmin, loginAsOperator } from './helpers/test-auth.helper';

async function readUserRow(
  dataSource: DataSource,
  username: string
): Promise<{
  password_hash: string;
  must_change_password: boolean;
  display_name: string | null;
  status: string;
  role: string;
}> {
  const rows = await dataSource.query<
    {
      password_hash: string;
      must_change_password: boolean;
      display_name: string | null;
      status: string;
      role: string;
    }[]
  >(
    `SELECT password_hash, must_change_password, display_name, status, role FROM users WHERE username = $1`,
    [username]
  );
  return rows[0];
}

describe('Admin creates a user account (#3456)', () => {
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

  // Not `async`: it must hand back supertest's chainable `Test`, whose
  // `.expect(status)` the cases call — an `async` wrapper would return a bare
  // Promise and lose it.
  function createAs(adminToken: string, body: Record<string, unknown>): request.Test {
    return harness
      .getHttp()
      .post('/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
  }

  async function signIn(username: string, password: string): Promise<string> {
    const response = await harness
      .getHttp()
      .post('/v1/auth/login')
      .send({ username, password })
      .expect(200);
    return response.body.access_token as string;
  }

  it('should create an active account that must change its one-time password', async () => {
    const dataSource = harness.getDataSource();
    const adminToken = await loginAsAdmin(harness.getHttp(), dataSource, 'creating_admin');

    const response = await createAs(adminToken, {
      displayName: 'Anna Kowalska',
      username: 'anna',
      role: 'operator',
    }).expect(201);

    expect(response.body).toEqual({
      id: expect.any(String),
      temporaryPassword: expect.any(String),
    });

    const row = await readUserRow(dataSource, 'anna');
    expect(row).toEqual(
      expect.objectContaining({
        status: 'active',
        role: 'operator',
        display_name: 'Anna Kowalska',
        must_change_password: true,
      })
    );
    // Stored only as a hash.
    expect(row.password_hash).not.toBe(response.body.temporaryPassword);
  });

  it('should gate every route until the password is changed, then lift the gate', async () => {
    const http = harness.getHttp();
    const adminToken = await loginAsAdmin(http, harness.getDataSource(), 'creating_admin');
    const created = await createAs(adminToken, {
      displayName: 'Anna Kowalska',
      username: 'anna',
      role: 'operator',
    }).expect(201);
    const temporaryPassword = created.body.temporaryPassword as string;

    const firstToken = await signIn('anna', temporaryPassword);

    // An operator route: refused with the code, not by the role check.
    const blocked = await http
      .get('/v1/users/packers')
      .set('Authorization', `Bearer ${firstToken}`)
      .expect(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

    // The session read stays open and says why.
    const me = await http
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${firstToken}`)
      .expect(200);
    expect(me.body.mustChangePassword).toBe(true);
    expect(me.body.displayName).toBe('Anna Kowalska');

    await http
      .post('/v1/auth/me/password')
      .set('Authorization', `Bearer ${firstToken}`)
      .send({ currentPassword: temporaryPassword, newPassword: 'anna-chose-this' })
      .expect(200);

    expect((await readUserRow(harness.getDataSource(), 'anna')).must_change_password).toBe(false);

    // The one-time password no longer works; the new one does, without the gate.
    await http
      .post('/v1/auth/login')
      .send({ username: 'anna', password: temporaryPassword })
      .expect(401);
    const secondToken = await signIn('anna', 'anna-chose-this');
    await http.get('/v1/users/packers').set('Authorization', `Bearer ${secondToken}`).expect(200);
  });

  it('should refuse to keep the one-time password as the new one', async () => {
    const http = harness.getHttp();
    const adminToken = await loginAsAdmin(http, harness.getDataSource(), 'creating_admin');
    const created = await createAs(adminToken, {
      displayName: 'Anna Kowalska',
      username: 'anna',
      role: 'packer',
    }).expect(201);
    const temporaryPassword = created.body.temporaryPassword as string;
    const token = await signIn('anna', temporaryPassword);

    const response = await http
      .post('/v1/auth/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: temporaryPassword, newPassword: temporaryPassword })
      .expect(400);

    expect(response.body.code).toBe('PASSWORD_UNCHANGED');
  });

  it('should refuse a non-admin with 403', async () => {
    const operatorToken = await loginAsOperator(
      harness.getHttp(),
      harness.getDataSource(),
      'an_operator'
    );

    await createAs(operatorToken, { displayName: 'X', username: 'x', role: 'packer' }).expect(403);
  });

  it.each([
    ['username', { username: 'taken_login' }],
    ['email', { email: 'taken_login@example.com' }],
  ] as const)('should answer 409 naming the taken %s', async (field, collision) => {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    // `loginAs` seeds `{username}@example.com`, so this account holds both.
    await loginAsOperator(http, dataSource, 'taken_login');
    const adminToken = await loginAsAdmin(http, dataSource, 'creating_admin');

    const response = await createAs(adminToken, {
      displayName: 'Someone',
      username: 'someone_new',
      role: 'packer',
      ...collision,
    }).expect(409);

    expect(response.body.field).toBe(field);
  });

  // The one-time password exists only in the create response.
  it('should never return the one-time password again', async () => {
    const http = harness.getHttp();
    const adminToken = await loginAsAdmin(http, harness.getDataSource(), 'creating_admin');
    const created = await createAs(adminToken, {
      displayName: 'Anna Kowalska',
      username: 'anna',
      role: 'packer',
    }).expect(201);

    const list = await http
      .get('/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(JSON.stringify(list.body)).not.toContain(created.body.temporaryPassword as string);
  });
});

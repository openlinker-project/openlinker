/**
 * Analytics Consent Integration Test
 *
 * Vertical slice for the self-service consent toggle (#1882):
 * PATCH /auth/me/analytics-consent → users.analytics_consent → GET /auth/me.
 *
 * The role dimension is the point of this suite: a demo signup is a `viewer`,
 * and viewers are denied every other write in the API. This endpoint must be
 * the documented exception, so a viewer path is asserted explicitly.
 *
 * @module apps/api/test/integration
 */
import { DataSource } from 'typeorm';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';
import { loginAsAdmin, loginAsViewer } from './helpers/test-auth.helper';

async function readConsent(dataSource: DataSource, username: string): Promise<boolean> {
  const rows = await dataSource.query<{ analytics_consent: boolean }[]>(
    `SELECT analytics_consent FROM users WHERE username = $1`,
    [username],
  );
  return rows[0].analytics_consent;
}

describe('Analytics Consent Integration (#1882)', () => {
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

  it('should let a viewer grant consent on their own account', async () => {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const token = await loginAsViewer(http, dataSource, 'demo_viewer');

    const response = await http
      .patch('/v1/auth/me/analytics-consent')
      .set('Authorization', `Bearer ${token}`)
      .send({ analyticsConsent: true })
      .expect(200);

    expect(response.body.analyticsConsent).toBe(true);
    expect(response.body.username).toBe('demo_viewer');
    expect(response.body.passwordHash).toBeUndefined();
    expect(await readConsent(dataSource, 'demo_viewer')).toBe(true);
  });

  it('should let a viewer withdraw consent again', async () => {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const token = await loginAsViewer(http, dataSource, 'demo_viewer');

    await http
      .patch('/v1/auth/me/analytics-consent')
      .set('Authorization', `Bearer ${token}`)
      .send({ analyticsConsent: true })
      .expect(200);

    await http
      .patch('/v1/auth/me/analytics-consent')
      .set('Authorization', `Bearer ${token}`)
      .send({ analyticsConsent: false })
      .expect(200);

    expect(await readConsent(dataSource, 'demo_viewer')).toBe(false);
  });

  it('should surface the new value on a subsequent GET /auth/me', async () => {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const token = await loginAsViewer(http, dataSource, 'demo_viewer');

    await http
      .patch('/v1/auth/me/analytics-consent')
      .set('Authorization', `Bearer ${token}`)
      .send({ analyticsConsent: true })
      .expect(200);

    const me = await http
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(me.body.analyticsConsent).toBe(true);
  });

  it('should work for an admin as well — the preference is not role-scoped', async () => {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const token = await loginAsAdmin(http, dataSource, 'consent_admin');

    await http
      .patch('/v1/auth/me/analytics-consent')
      .set('Authorization', `Bearer ${token}`)
      .send({ analyticsConsent: true })
      .expect(200);

    expect(await readConsent(dataSource, 'consent_admin')).toBe(true);
  });

  it('should only touch the caller — another account keeps its own value', async () => {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const token = await loginAsViewer(http, dataSource, 'demo_viewer');
    await loginAsViewer(http, dataSource, 'other_viewer');

    await http
      .patch('/v1/auth/me/analytics-consent')
      .set('Authorization', `Bearer ${token}`)
      .send({ analyticsConsent: true })
      .expect(200);

    expect(await readConsent(dataSource, 'other_viewer')).toBe(false);
  });

  it('should return 400 when analyticsConsent is not a boolean', async () => {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const token = await loginAsViewer(http, dataSource, 'demo_viewer');

    await http
      .patch('/v1/auth/me/analytics-consent')
      .set('Authorization', `Bearer ${token}`)
      .send({ analyticsConsent: 'yes' })
      .expect(400);

    expect(await readConsent(dataSource, 'demo_viewer')).toBe(false);
  });

  it('should return 401 when no token is provided', async () => {
    const http = harness.getHttp();

    await http
      .patch('/v1/auth/me/analytics-consent')
      .send({ analyticsConsent: true })
      .expect(401);
  });
});

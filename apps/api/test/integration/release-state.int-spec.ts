/**
 * Release State Integration Test (#4142)
 *
 * Happy and refusal paths of `/release-state`: roles, IDOR, regression,
 * unknown connection and the disabled answer.
 *
 * @module apps/api/test/integration
 */
import * as bcrypt from 'bcryptjs';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { IntegrationTestHarness } from './setup';
import { loginAsAdmin } from './helpers/test-auth.helper';

async function loginAs(
  harness: IntegrationTestHarness,
  role: 'viewer' | 'packer',
): Promise<string> {
  const passwordHash = await bcrypt.hash('pass', 4);
  await harness.getDataSource().query(
    `INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, $4)`,
    [role, `${role}@example.com`, passwordHash, role],
  );
  const res = await harness.getHttp()
    .post('/v1/auth/login')
    .send({ username: role, password: 'pass' })
    .expect(200);
  return res.body.access_token as string;
}

describe('Release state integration', () => {
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

  it('should return state for a viewer and omit actedByUserId', async () => {
    const http = harness.getHttp();
    const admin = await loginAsAdmin(http, harness.getDataSource());
    const viewer = await loginAs(harness, 'viewer');
    await http
      .put('/v1/release-state/steps')
      .set('Authorization', `Bearer ${admin}`)
      .send({ changes: [{ itemKey: 'welcome', status: 'done' }] })
      .expect(200);

    const asViewer = await http
      .get('/v1/release-state')
      .set('Authorization', `Bearer ${viewer}`)
      .expect(200);
    expect(asViewer.body.enabled).toBe(true);
    expect(asViewer.body.installation[0]).not.toHaveProperty('actedByUserId');

    const asAdmin = await http
      .get('/v1/release-state')
      .set('Authorization', `Bearer ${admin}`)
      .expect(200);
    expect(asAdmin.body.installation[0].actedByUserId).toEqual(expect.any(String));
  });

  it('should forbid a viewer from writing steps and a packer from everything', async () => {
    const http = harness.getHttp();
    const viewer = await loginAs(harness, 'viewer');
    await http
      .put('/v1/release-state/steps')
      .set('Authorization', `Bearer ${viewer}`)
      .send({ changes: [{ itemKey: 'welcome', status: 'done' }] })
      .expect(403);

    const packer = await loginAs(harness, 'packer');
    await http.get('/v1/release-state').set('Authorization', `Bearer ${packer}`).expect(403);
    await http
      .put('/v1/release-state/items')
      .set('Authorization', `Bearer ${packer}`)
      .send({ changes: [{ itemKey: 'a', status: 'archived' }] })
      .expect(403);
  });

  it('should refuse a body userId on user writes with 400', async () => {
    const http = harness.getHttp();
    const viewer = await loginAs(harness, 'viewer');
    await http
      .put('/v1/release-state/items')
      .set('Authorization', `Bearer ${viewer}`)
      .send({ userId: 'someone-else', changes: [{ itemKey: 'a', status: 'archived' }] })
      .expect(400);
    const rows = await harness
      .getDataSource()
      .query(`SELECT "userId" FROM release_item_states WHERE "itemKey" = 'a'`);
    expect(rows).toHaveLength(0);
  });

  it('should refuse an unknown connection id with 422', async () => {
    const http = harness.getHttp();
    const admin = await loginAsAdmin(http, harness.getDataSource());
    await http
      .put('/v1/release-state/steps')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        changes: [
          { itemKey: 'carrier-mapping:3f2a1c9e-0000-4000-8000-000000000000', status: 'done' },
        ],
      })
      .expect(422);
  });

  it('should not regress the cursor and should report applied false', async () => {
    const http = harness.getHttp();
    const viewer = await loginAs(harness, 'viewer');
    await http
      .put('/v1/release-state/cursor')
      .set('Authorization', `Bearer ${viewer}`)
      .send({ version: '0.20.0' })
      .expect(200);
    const res = await http
      .put('/v1/release-state/cursor')
      .set('Authorization', `Bearer ${viewer}`)
      .send({ version: '0.19.0' })
      .expect(200);
    expect(res.body.applied).toBe(false);
    expect(res.body.cursor.lastSeenVersion).toBe('0.20.0');
  });

  it('should answer enabled false without table reads when disabled', async () => {
    const http = harness.getHttp();
    const admin = await loginAsAdmin(http, harness.getDataSource());
    await http
      .put('/v1/operational-settings')
      .set('Authorization', `Bearer ${admin}`)
      .send({ releaseCenterEnabled: false })
      .expect(204);
    const res = await http
      .get('/v1/release-state')
      .set('Authorization', `Bearer ${admin}`)
      .expect(200);
    expect(res.body).toEqual({ enabled: false, cursor: null, user: [], installation: [] });
  });
});

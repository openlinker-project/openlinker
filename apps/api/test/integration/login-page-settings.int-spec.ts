/**
 * Login Page Settings Integration
 *
 * Round-trips the singleton login-page copy row through real Postgres (#4028):
 *   - GET /login-page-settings  -> every field with its rung
 *   - PUT /login-page-settings  -> per-language partial update (204), 400 on
 *     an over-length value, empty string clears
 *   - GET /system/config        -> `registrationEnabled` + overrides only
 *
 * @module apps/api/test/integration
 */
import * as bcrypt from 'bcryptjs';
import { LOGIN_PAGE_COPY_MAX_LENGTH } from '@openlinker/core/login-page-settings';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { IntegrationTestHarness } from './setup';
import { loginAsAdmin } from './helpers/test-auth.helper';

async function loginAsViewer(harness: IntegrationTestHarness): Promise<string> {
  const passwordHash = await bcrypt.hash('viewer-pass', 4);
  await harness
    .getDataSource()
    .query(
      `INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, 'viewer')`,
      ['login-viewer', 'login-viewer@example.com', passwordHash]
    );
  const response = await harness
    .getHttp()
    .post('/v1/auth/login')
    .send({ username: 'login-viewer', password: 'viewer-pass' })
    .expect(200);
  return response.body.access_token as string;
}

describe('Login Page Settings Integration', () => {
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

  it('should report every field as default when no row exists', async () => {
    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());

    const res = await http
      .get('/v1/login-page-settings')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.copy.pl.headline).toEqual({ value: null, source: 'default' });
    expect(res.body.maxLength.lead).toBe(LOGIN_PAGE_COPY_MAX_LENGTH.lead);
    expect(res.body.updatedAt).toBeNull();
  });

  it('should round-trip a saved value and clear it with an empty string', async () => {
    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());

    await http
      .put('/v1/login-page-settings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        pl: { headline: '  Panel sprzedaży  ', support: 'it@sklep.pl' },
        en: { headline: 'Sales panel' },
      })
      .expect(204);

    const saved = await http
      .get('/v1/login-page-settings')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(saved.body.copy.pl.headline).toEqual({ value: 'Panel sprzedaży', source: 'setting' });
    expect(saved.body.copy.en.headline).toEqual({ value: 'Sales panel', source: 'setting' });

    const config = await http.get('/v1/system/config').expect(200);
    expect(config.body.loginPage).toEqual({
      pl: { headline: 'Panel sprzedaży', support: 'it@sklep.pl' },
      en: { headline: 'Sales panel' },
    });
    expect(typeof config.body.registrationEnabled).toBe('boolean');

    await http
      .put('/v1/login-page-settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ pl: { support: '' } })
      .expect(204);
    const cleared = await http
      .get('/v1/login-page-settings')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(cleared.body.copy.pl.support).toEqual({ value: null, source: 'default' });
    expect(cleared.body.copy.pl.headline.value).toBe('Panel sprzedaży');
  });

  it('should switch registration on and off from the settings, over the env default', async () => {
    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());

    await http
      .put('/v1/login-page-settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ registrationEnabled: true })
      .expect(204);
    const on = await http.get('/v1/system/config').expect(200);
    expect(on.body.registrationEnabled).toBe(true);
    const settings = await http
      .get('/v1/login-page-settings')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(settings.body.registration).toEqual({ value: true, source: 'setting' });

    await http
      .put('/v1/login-page-settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ registrationEnabled: false })
      .expect(204);
    const off = await http.get('/v1/system/config').expect(200);
    expect(off.body.registrationEnabled).toBe(false);
  });

  it('should answer 400 naming the field when a value is too long', async () => {
    const http = harness.getHttp();
    const token = await loginAsAdmin(http, harness.getDataSource());

    const res = await http
      .put('/v1/login-page-settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ en: { formTitle: 'x'.repeat(LOGIN_PAGE_COPY_MAX_LENGTH.formTitle + 1) } })
      .expect(400);
    expect(JSON.stringify(res.body)).toContain('en.formTitle');
  });

  it('should answer 403 to a non-admin on both routes', async () => {
    const http = harness.getHttp();
    const viewerToken = await loginAsViewer(harness);

    await http
      .get('/v1/login-page-settings')
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(403);
    await http
      .put('/v1/login-page-settings')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ pl: { headline: 'x' } })
      .expect(403);
  });
});

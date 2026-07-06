/**
 * Auth refresh-token rotation integration spec (#710).
 *
 * Vertical slice covering the dual-token flow:
 *   - POST /auth/login    → access_token in body + ol_refresh + ol_csrf cookies
 *   - POST /auth/refresh  → CSRF-guarded rotation, returns new access_token + new cookies
 *   - POST /auth/logout   → CSRF-guarded revoke, clears cookies
 *
 * Reuse-detection: presenting an already-rotated cookie revokes the full chain
 * for that user and returns 401.
 *
 * @module apps/api/test/integration
 */
import * as bcrypt from 'bcryptjs';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { IntegrationTestHarness } from './setup';

const COOKIE_REFRESH = 'ol_refresh';
const COOKIE_CSRF = 'ol_csrf';

function parseSetCookie(headers: Record<string, unknown>): Record<string, string> {
  const raw = headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  const map: Record<string, string> = {};
  for (const cookie of cookies) {
    const [pair] = cookie.split(';');
    const [name, value] = pair.split('=');
    if (name && value !== undefined) {
      map[name.trim()] = value.trim();
    }
  }
  return map;
}

async function seedAdminAndLogin(harness: IntegrationTestHarness, username = 'admin'): Promise<{
  accessToken: string;
  refreshCookie: string;
  csrfValue: string;
  cookieHeader: string;
}> {
  const passwordHash = await bcrypt.hash('test-password', 4);
  await harness
    .getDataSource()
    .query(
      `INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, 'admin')`,
      [username, `${username}@example.com`, passwordHash],
    );

  const response = await harness
    .getHttp()
    .post('/v1/auth/login')
    .send({ username, password: 'test-password' })
    .expect(200);

  const cookies = parseSetCookie(response.headers as Record<string, unknown>);
  expect(cookies[COOKIE_REFRESH]).toBeDefined();
  expect(cookies[COOKIE_CSRF]).toBeDefined();

  // Build a Cookie header to replay on subsequent requests.
  const cookieHeader = `${COOKIE_REFRESH}=${cookies[COOKIE_REFRESH]}; ${COOKIE_CSRF}=${cookies[COOKIE_CSRF]}`;

  return {
    accessToken: response.body.access_token as string,
    refreshCookie: cookies[COOKIE_REFRESH],
    csrfValue: cookies[COOKIE_CSRF],
    cookieHeader,
  };
}

describe('Auth Refresh Integration (#710)', () => {
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
    it('returns access_token + sets ol_refresh (HttpOnly) and ol_csrf (non-HttpOnly) cookies', async () => {
      const passwordHash = await bcrypt.hash('test-password', 4);
      await harness
        .getDataSource()
        .query(
          `INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, 'admin')`,
          ['admin', 'admin@example.com', passwordHash],
        );

      const response = await harness
        .getHttp()
        .post('/v1/auth/login')
        .send({ username: 'admin', password: 'test-password' })
        .expect(200);

      expect(response.body.access_token).toEqual(expect.any(String));

      const rawHeader = response.headers['set-cookie'];
      const rawCookies: string[] = Array.isArray(rawHeader)
        ? rawHeader
        : rawHeader
          ? [String(rawHeader)]
          : [];
      expect(rawCookies.length).toBeGreaterThan(0);
      // Skip the migration-cleanup Set-Cookie lines that precede the real
      // issuance: `setCsrfCookie` clears the pre-#748 ol_csrf at `Path=/auth`,
      // `setRefreshCookie` clears the pre-#1327 ol_refresh at `Path=/auth`.
      // Those headers look like `ol_…=; Path=/auth; Expires=Thu, 01 Jan 1970 …`
      // — a plain `.find()` would match the clearing line first and the Path
      // assertions below would all fail.
      const refreshLine = rawCookies.find(
        (c) => c.startsWith(`${COOKIE_REFRESH}=`) && !/Expires=Thu, 01 Jan 1970/.test(c),
      );
      const csrfLine = rawCookies.find(
        (c) => c.startsWith(`${COOKIE_CSRF}=`) && !/Expires=Thu, 01 Jan 1970/.test(c),
      );

      expect(refreshLine).toMatch(/HttpOnly/i);
      expect(refreshLine).toMatch(/SameSite=Lax/i); // dev/test mode
      // ol_refresh MUST be scoped to the versioned mount point. The literal
      // /v1/auth here is deliberate — it pairs with the literal request path
      // `.post('/v1/auth/login')` above, witnessing the RFC 6265 §5.1.4
      // prefix-match the browser performs. Deriving it from API_VERSION_LABEL
      // would make the assertion true by construction and blind to
      // mount-vs-cookie drift (#1327).
      expect(refreshLine).toMatch(/Path=\/v1\/auth(;|$)/);
      expect(csrfLine).toBeDefined();
      expect(csrfLine).not.toMatch(/HttpOnly/i); // SPA must read this
      // ol_csrf MUST be at Path=/ — document.cookie only exposes cookies whose
      // Path prefixes the current document URL, so scoping ol_csrf to /auth
      // would make readCsrfCookie() return null on every SPA route outside
      // /auth/* and break silent refresh on full-page reload. See #748.
      expect(csrfLine).toMatch(/Path=\/(;|$)/);
      expect(csrfLine).not.toMatch(/Path=\/auth/);
    });
  });

  describe('POST /auth/refresh', () => {
    it('rotates the refresh cookie and returns a new access token', async () => {
      const initial = await seedAdminAndLogin(harness);

      const refreshResponse = await harness
        .getHttp()
        .post('/v1/auth/refresh')
        .set('Cookie', initial.cookieHeader)
        .set('X-CSRF-Token', initial.csrfValue)
        .expect(200);

      expect(refreshResponse.body.access_token).toEqual(expect.any(String));
      // We do NOT assert access_token differs from initial.accessToken: JWT
      // `iat` claim is in whole seconds, so a refresh issued within the same
      // wall-clock second as login produces a byte-identical signed JWT. The
      // meaningful rotation guarantee is the refresh cookie below — verified
      // both by the value change here and by the reuse-detection test
      // further down (presenting the OLD cookie returns 401).

      const newCookies = parseSetCookie(refreshResponse.headers as Record<string, unknown>);
      expect(newCookies[COOKIE_REFRESH]).toBeDefined();
      expect(newCookies[COOKIE_REFRESH]).not.toBe(initial.refreshCookie);
    });

    it('returns 403 when the CSRF header is missing', async () => {
      const initial = await seedAdminAndLogin(harness);

      await harness
        .getHttp()
        .post('/v1/auth/refresh')
        .set('Cookie', initial.cookieHeader)
        // no X-CSRF-Token header
        .expect(403);
    });

    it('returns 403 when the CSRF header disagrees with the cookie', async () => {
      const initial = await seedAdminAndLogin(harness);

      await harness
        .getHttp()
        .post('/v1/auth/refresh')
        .set('Cookie', initial.cookieHeader)
        .set('X-CSRF-Token', 'tampered-value')
        .expect(403);
    });

    it('returns 401 + revokes the entire chain when an already-rotated cookie is presented', async () => {
      const initial = await seedAdminAndLogin(harness);

      // Rotate once — this revokes `initial.refreshCookie` with reason `rotated`.
      await harness
        .getHttp()
        .post('/v1/auth/refresh')
        .set('Cookie', initial.cookieHeader)
        .set('X-CSRF-Token', initial.csrfValue)
        .expect(200);

      // Now replay the OLD cookie — should trip reuse-detection.
      await harness
        .getHttp()
        .post('/v1/auth/refresh')
        .set('Cookie', initial.cookieHeader)
        .set('X-CSRF-Token', initial.csrfValue)
        .expect(401);

      // Every refresh-token row for this user must now be revoked.
      const rows = await harness
        .getDataSource()
        .query<Array<{ revoked_at: Date | null; revoked_reason: string | null }>>(
          `SELECT revoked_at, revoked_reason FROM refresh_tokens`,
        );
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.revoked_at).not.toBeNull();
      }
      // At least one row should carry the reuse-detection marker.
      expect(rows.some((r) => r.revoked_reason === 'reuse_detected')).toBe(true);
    });

    it('returns 401 when no refresh cookie is present (CSRF guard still passes)', async () => {
      const initial = await seedAdminAndLogin(harness);

      // Send only the CSRF cookie/header, no ol_refresh.
      await harness
        .getHttp()
        .post('/v1/auth/refresh')
        .set('Cookie', `${COOKIE_CSRF}=${initial.csrfValue}`)
        .set('X-CSRF-Token', initial.csrfValue)
        .expect(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes the refresh token and subsequent refresh attempts return 401', async () => {
      const initial = await seedAdminAndLogin(harness);

      await harness
        .getHttp()
        .post('/v1/auth/logout')
        .set('Cookie', initial.cookieHeader)
        .set('X-CSRF-Token', initial.csrfValue)
        .expect(204);

      // The presented cookie is now revoked; refresh trips reuse-detection
      // (or returns 401 directly because it's revoked).
      await harness
        .getHttp()
        .post('/v1/auth/refresh')
        .set('Cookie', initial.cookieHeader)
        .set('X-CSRF-Token', initial.csrfValue)
        .expect(401);

      const rows = await harness
        .getDataSource()
        .query<Array<{ revoked_reason: string | null }>>(
          `SELECT revoked_reason FROM refresh_tokens`,
        );
      expect(rows.some((r) => r.revoked_reason === 'logout')).toBe(true);
    });

    it('returns 403 when CSRF header is missing', async () => {
      const initial = await seedAdminAndLogin(harness);
      await harness
        .getHttp()
        .post('/v1/auth/logout')
        .set('Cookie', initial.cookieHeader)
        .expect(403);
    });
  });
});

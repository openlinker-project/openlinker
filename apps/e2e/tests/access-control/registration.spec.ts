/**
 * Access control: registration
 *
 * Self-service registration is gated by `OL_REGISTRATION_ENABLED`. When enabled,
 * a new account is role `viewer`; its status depends on the mode — `active` in
 * demo (immediate login), `pending` in normal (login 401 until an admin
 * approves). Duplicate username/email → 409. A demo-only per-IP rate limit
 * returns 429.
 *
 * Self-configuring: the spec probes the registration state at runtime and
 * asserts whichever behaviour the stack exhibits. The destructive 429 path is
 * opt-in (E2E_TEST_RATE_LIMIT=true) because hammering register burns the per-IP
 * demo budget the other access-control specs share.
 *
 * @module tests/access-control
 */
import { test, expect } from '../../src/fixtures/test';
import { ApiClient } from '../../src/api/api-client';
import { ApiError } from '../../src/api/api-error';
import { uniqueCreds } from '../../src/support/access-control';

test.describe('access-control: registration', () => {
  test('registration is disabled (403) or drives the viewer lifecycle', async ({
    api,
    env,
  }, testInfo) => {
    const config = await api.system.config();
    const creds = uniqueCreds('e2e-register');

    // Probe by attempting one registration; a 403 means registration is off.
    let disabled = false;
    try {
      await api.auth.register(creds);
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        disabled = true;
      } else {
        throw error;
      }
    }

    if (disabled) {
      testInfo.annotations.push({
        type: 'access-control',
        description: 'registration disabled — 403 is the enforced behaviour',
      });
      // 403 IS the disabled behaviour — confirm it's deterministic.
      const err = await api.auth
        .register(uniqueCreds('e2e-register'))
        .then(() => null)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(403);
      return;
    }

    // Enabled: a duplicate registration of the same credentials conflicts.
    const dupErr = await api.auth
      .register(creds)
      .then(() => null)
      .catch((e: unknown) => e);
    expect(dupErr).toBeInstanceOf(ApiError);
    expect((dupErr as ApiError).status).toBe(409);

    // Immediate login reflects the account status for the mode.
    const client = new ApiClient({ baseUrl: env.apiUrl });
    if (config.demoMode) {
      // Demo: created ACTIVE — login succeeds immediately.
      await client.login(creds.username, creds.password);
      expect(client.isAuthenticated).toBe(true);
    } else {
      // Normal: created PENDING — login is rejected with 401 until approved.
      const pendingErr = await client
        .login(creds.username, creds.password)
        .then(() => null)
        .catch((e: unknown) => e);
      expect(pendingErr).toBeInstanceOf(ApiError);
      expect((pendingErr as ApiError).status).toBe(401);

      const list = await api.users.list({ status: 'pending', pageSize: 100 });
      const user = list.users.find((u) => u.username === creds.username);
      expect(user, 'registered pending user should appear in the admin list').toBeDefined();

      await api.users.approve(user!.id, { role: 'viewer' });
      await client.login(creds.username, creds.password);
      expect(client.isAuthenticated).toBe(true);
    }
  });

  test('demo per-IP rate limit returns 429', async ({ api, env }) => {
    const config = await api.system.config();
    test.skip(!config.demoMode, 'the register rate limit only applies in demo mode');
    test.skip(
      !env.testRateLimit,
      'set E2E_TEST_RATE_LIMIT=true to exercise the register rate limit (it burns the ' +
        'per-IP demo budget shared with the other access-control specs)',
    );

    let sawRateLimit = false;
    for (let attempt = 0; attempt < 15 && !sawRateLimit; attempt++) {
      try {
        await api.auth.register(uniqueCreds('e2e-ratelimit'));
      } catch (error) {
        if (error instanceof ApiError && error.status === 429) {
          sawRateLimit = true;
        } else if (error instanceof ApiError && error.status === 403) {
          test.skip(true, 'registration disabled — cannot exercise the rate limit');
        } else {
          throw error;
        }
      }
    }
    expect(sawRateLimit, 'expected a 429 within 15 rapid registrations').toBe(true);
  });
});

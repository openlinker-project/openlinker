/**
 * Access control: RBAC
 *
 * Proves permissions actually block what should be blocked, at the API boundary:
 * unauthenticated → 401; a `viewer` on an admin-only endpoint → 403; a `viewer`
 * on a read-open endpoint → 200; `admin` → 200. `GET /auth/me` returns the
 * caller's role + derived permissions.
 *
 * Admin-only cases run against the shared admin `api` fixture and are always
 * asserted. Viewer cases provision a throwaway viewer and skip-with-annotation
 * when registration is disabled/rate-limited.
 *
 * @module tests/access-control
 */
import { test, expect } from '../../src/fixtures/test';
import { ApiClient } from '../../src/api/api-client';
import { ApiError } from '../../src/api/api-error';
import { provisionViewer } from '../../src/support/access-control';

test.describe('access-control: RBAC', () => {
  test('unauthenticated request to a protected endpoint returns 401', async ({ env }) => {
    // A client that never calls login() sends no auth header and does NOT
    // auto-relogin on 401 (no captured credentials).
    const anon = new ApiClient({ baseUrl: env.apiUrl });
    const err = await anon.users
      .list()
      .then(() => null)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
  });

  test('admin can read admin-only endpoints', async ({ api }) => {
    await expect(api.aiProviderSettings.get()).resolves.toBeDefined();
    const users = await api.users.list();
    expect(Array.isArray(users.users)).toBe(true);
  });

  test('GET /auth/me returns the admin role with a non-empty permission set', async ({ api }) => {
    const me = await api.me();
    expect(me.role).toBe('admin');
    expect(me.permissions.length).toBeGreaterThan(0);
  });

  test('viewer is blocked from admin-only endpoints but allowed on read-open ones', async ({
    api,
    env,
  }, testInfo) => {
    const viewer = await provisionViewer(env, api);
    test.skip(!viewer, 'registration disabled or rate-limited — cannot provision a viewer');
    testInfo.annotations.push({
      type: 'access-control',
      description: `provisioned viewer ${viewer!.creds.username}`,
    });
    const client = viewer!.client;

    // Admin-only endpoints → 403.
    for (const call of [
      () => client.aiProviderSettings.get(),
      () => client.users.list(),
    ]) {
      const err = await call()
        .then(() => null)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(403);
    }

    // Read-open endpoint → 200.
    const orders = await client.orders.list({ limit: 1 });
    expect(Array.isArray(orders.items)).toBe(true);

    // GET /auth/me → viewer role, read-only permission subset.
    const me = await client.me();
    const admin = await api.me();
    expect(me.role).toBe('viewer');
    expect(me.permissions.length).toBeGreaterThan(0);
    expect(me.permissions.length).toBeLessThan(admin.permissions.length);
    expect(me.permissions.some((p) => p.endsWith(':write'))).toBe(false);
    expect(me.permissions).not.toContain('ai:suggest');
  });
});

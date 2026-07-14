/**
 * Access-control test helpers
 *
 * Shared support for the `access-control` project: minting unique credentials,
 * reading the public `GET /system/config` flag, provisioning a throwaway
 * `viewer` account through the real registration(+approve) flow, and seeding a
 * browser context with a non-admin session.
 *
 * The suite is *self-configuring*: `provisionViewer` returns `null` (rather than
 * throwing) when the stack can't hand out a viewer right now — registration
 * disabled (403) or the demo per-IP rate limit hit (429) — so callers
 * `test.skip` the viewer-dependent cases instead of hard-failing on stack
 * configuration (issue #1481).
 *
 * @module support
 */
import type { BrowserContext } from '@playwright/test';
import { ApiClient } from '../api/api-client';
import { ApiError } from '../api/api-error';
import type { SystemConfig } from '../api/api.types';
import type { E2eEnv } from '../config/env';

/** A freshly-minted registration triple. */
export interface Credentials {
  username: string;
  email: string;
  password: string;
}

/** A provisioned viewer: an authenticated node client plus its credentials. */
export interface ProvisionedViewer {
  client: ApiClient;
  creds: Credentials;
}

/**
 * Mint a collision-free registration triple. The password satisfies the
 * backend's 8–72 character rule.
 */
export function uniqueCreds(prefix = 'e2e-viewer'): Credentials {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const username = `${prefix}-${suffix}`;
  return {
    username,
    email: `${username}@e2e.openlinker.test`,
    password: 'e2e-Password-123',
  };
}

/** Read the public system config through a throwaway (unauthenticated) client. */
export async function readSystemConfig(env: E2eEnv): Promise<SystemConfig> {
  const client = new ApiClient({ baseUrl: env.apiUrl });
  return client.system.config();
}

/**
 * Provision a throwaway `viewer` through the real registration flow.
 *
 * - Registers a unique account. On 403 (registration disabled) or 429 (demo
 *   per-IP rate limit) returns `null` so the caller can skip gracefully.
 * - Demo mode: the account is created ACTIVE — log straight in.
 * - Normal mode: the account is PENDING — an admin approves it as `viewer`
 *   (already-active accounts skip approval) before logging in.
 */
export async function provisionViewer(
  env: E2eEnv,
  adminClient: ApiClient,
): Promise<ProvisionedViewer | null> {
  const creds = uniqueCreds();

  try {
    await adminClient.auth.register(creds);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 429)) {
      return null;
    }
    throw error;
  }

  const config = await readSystemConfig(env);
  const client = new ApiClient({ baseUrl: env.apiUrl });

  if (config.demoMode) {
    await client.login(creds.username, creds.password);
    return { client, creds };
  }

  // Normal mode: locate the just-registered account and approve it. Look in the
  // pending queue first, then fall back to the full list (handles already-active).
  const found =
    (await adminClient.users.list({ status: 'pending', pageSize: 100 })).users.find(
      (u) => u.username === creds.username || u.email === creds.email,
    ) ??
    (await adminClient.users.list({ pageSize: 100 })).users.find(
      (u) => u.username === creds.username || u.email === creds.email,
    );

  if (!found) {
    throw new Error(`Provisioned viewer not found in the admin user list: ${creds.username}`);
  }
  if (found.status === 'pending') {
    await adminClient.users.approve(found.id, { role: 'viewer' });
  }

  await client.login(creds.username, creds.password);
  return { client, creds };
}

/**
 * Seed a browser context with a session for `creds` by logging in through
 * `context.request` (which shares the context's cookie jar). Mirrors the
 * `browserAuth` fixture so a non-admin session can be established without the
 * admin storageState seed leaking in.
 */
export async function seedBrowserSession(
  context: BrowserContext,
  env: E2eEnv,
  creds: Pick<Credentials, 'username' | 'password'>,
): Promise<void> {
  const response = await context.request.post(`${env.apiUrl}/v1/auth/login`, {
    data: { username: creds.username, password: creds.password },
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok()) {
    throw new Error(
      `Browser session login failed for ${creds.username}: HTTP ${response.status()} ${await response.text()}`,
    );
  }
}

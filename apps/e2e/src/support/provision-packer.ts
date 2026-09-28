/**
 * Provision a throwaway `packer` account (#3342/#3343)
 *
 * The `access-control.ts` `provisionViewer` helper is hardcoded to
 * `role: 'viewer'`. The pack bench and Assign Packing Work specs need a real
 * `packer` — a role `GET /bench/work` and `GET /connections/:id/sourcing-rules`
 * etc. are gated on — so this mirrors that helper's register-then-approve
 * shape for the one other role these suites need, rather than widening the
 * viewer helper's signature for every caller that doesn't need the choice.
 *
 * Demo mode is not handled here (unlike `provisionViewer`): demo-mode signups
 * land in `pending_confirmation` with no admin-reachable activation path, and
 * the bench/Assign-Packing-Work suites need a real session to run at all, so a
 * demo stack degrades to a `test.skip` at the call site rather than a silent
 * no-op account.
 *
 * Two further divergences from `provisionViewer` are why this stays a
 * separate file rather than a `provisionUser(role)` fold (#3384 review): the
 * return shape carries the provisioned user's own `id` (`ProvisionedPacker`),
 * which the Assign-Packing-Work round-trip (#3343) needs to assert the
 * seeded `assignedToUserId` against the acting session's own identity — a
 * fact `ProvisionedViewer` has no caller for and therefore doesn't carry; and
 * the seeded-credentials branch (`E2E_PACKER_USER`/`E2E_PACKER_PASS`) omits
 * `provisionViewer`'s narrow 401/403-only login-error handling, because that
 * branch exists to let an operator pre-provision a packer once rather than
 * register one per run, so a login failure there is a misconfiguration the
 * run should fail loudly on rather than silently skip.
 *
 * @module support
 */
import type { BrowserContext } from '@playwright/test';
import { ApiClient } from '../api/api-client';
import { ApiError } from '../api/api-error';
import type { E2eEnv } from '../config/env';
import { findUserByUsername, uniqueCreds, type Credentials } from './access-control';

export interface ProvisionedPacker {
  readonly client: ApiClient;
  readonly creds: Credentials;
  readonly id: string;
}

/**
 * Registers + approves a fresh `packer` account. Returns `null` when
 * registration is disabled/rate-limited (403/429) — the same degrade-to-skip
 * contract `provisionViewer` uses.
 */
export async function provisionPacker(
  env: E2eEnv,
  adminClient: ApiClient,
): Promise<ProvisionedPacker | null> {
  if (env.packerUser && env.packerPass) {
    const seeded = new ApiClient({ baseUrl: env.apiUrl });
    await seeded.login(env.packerUser, env.packerPass);
    const found = await findUserByUsername(adminClient, env.packerUser);
    if (!found) {
      throw new Error(`E2E_PACKER_USER "${env.packerUser}" logged in but is not visible to the admin user list`);
    }
    return {
      client: seeded,
      creds: { username: env.packerUser, email: '', password: env.packerPass },
      id: found.id,
    };
  }

  const creds = uniqueCreds('e2e-packer');

  try {
    await adminClient.auth.register(creds);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 429)) {
      return null;
    }
    throw error;
  }

  const found =
    (await findUserByUsername(adminClient, creds.username, 'pending')) ??
    (await findUserByUsername(adminClient, creds.username));

  if (!found) {
    throw new Error(`Provisioned packer not found in the admin user list: ${creds.username}`);
  }
  if (found.status === 'pending') {
    await adminClient.users.approve(found.id, { role: 'packer' });
  }

  const client = new ApiClient({ baseUrl: env.apiUrl });
  await client.login(creds.username, creds.password);
  return { client, creds, id: found.id };
}

/** Log a browser context into a provisioned packer's session (#3342/#3343). */
export async function seedPackerBrowserSession(
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
      `Packer browser session login failed for ${creds.username}: HTTP ${response.status()} ${await response.text()}`,
    );
  }
}

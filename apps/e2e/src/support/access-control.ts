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
 * disabled (403), the demo per-IP rate limit hit (429), or the account left
 * awaiting email confirmation (403, see below) — so callers `test.skip` the
 * viewer-dependent cases instead of hard-failing on stack configuration
 * (issue #1481).
 *
 * Email confirmation (#1624): a demo-mode registration now lands in
 * `pending_confirmation` and login is refused until the emailed single-use link
 * is followed. No admin endpoint can activate such an account (`approveUser`
 * accepts only `pending`), and the token exists solely in the e-mail — so an
 * API-only client cannot self-serve a viewer on a demo stack any more. Set
 * `E2E_VIEWER_USER` / `E2E_VIEWER_PASS` to a pre-seeded active viewer to keep
 * those cases running; otherwise they skip with an explicit annotation.
 *
 * Account hygiene: every triple `uniqueCreds` mints carries a per-PROCESS random
 * password (never a committed constant) and is recorded for
 * `sweepProvisionedAccounts`, which each access-control spec calls from a
 * `test.afterAll`. Without both halves a shared demo stack accumulated
 * predictably-named accounts sharing a password published in this repository.
 *
 * @module support
 */
import { randomBytes } from 'node:crypto';
import type { BrowserContext } from '@playwright/test';
import { ApiClient } from '../api/api-client';
import { ApiError } from '../api/api-error';
import type { SystemConfig, UserSummary } from '../api/api.types';
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
 * Password shared by every account this PROCESS mints, and by nothing else.
 *
 * It used to be the literal `'e2e-Password-123'`, committed in this repository.
 * Combined with predictably-named `e2e-viewer-*` accounts that nothing ever
 * deleted, a demo stack reachable from the internet accumulated dozens of
 * logins - at least one an ACTIVE `viewer` - whose credentials were public.
 * Regenerating it per process keeps the accounts usable inside a run (several
 * helpers re-login with the same triple) while making a leaked account useless
 * the moment the run ends. 24 random bytes of base64url comfortably satisfies
 * the backend's 8-72 character rule and never lands in a commit.
 */
const RUN_PASSWORD = `e2e-${randomBytes(18).toString('base64url')}`;

/**
 * Usernames minted by `uniqueCreds` in this process, so `sweepProvisionedAccounts`
 * can delete exactly what the run created and nothing else. Module-scoped state
 * is safe: the access-control project runs `workers: 1`.
 */
const mintedUsernames = new Set<string>();

/**
 * Mint a collision-free registration triple. The password satisfies the
 * backend's 8–72 character rule and is per-process (see `RUN_PASSWORD`).
 *
 * Every minted username is recorded for the teardown sweep, so a caller that
 * registers through this helper never has to remember to clean up.
 */
export function uniqueCreds(prefix = 'e2e-viewer'): Credentials {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const username = `${prefix}-${suffix}`;
  mintedUsernames.add(username);
  return {
    username,
    email: `${username}@e2e.openlinker.test`,
    password: RUN_PASSWORD,
  };
}

/**
 * Find a user by username across the WHOLE admin list, not just its first page.
 *
 * `GET /users` pages, so a single `pageSize: 100` read silently stops finding
 * the just-registered account once the stack carries more than 100 users - the
 * exact condition an un-swept suite creates for itself. Bounded at
 * `MAX_USER_SCAN_PAGES` so a runaway stack cannot turn this into an unbounded
 * scan; `total` short-circuits it in the common case.
 */
const USER_PAGE_SIZE = 100;
const MAX_USER_SCAN_PAGES = 20;

export async function findUserByUsername(
  adminClient: ApiClient,
  username: string,
  status?: string,
): Promise<UserSummary | null> {
  for (let page = 1; page <= MAX_USER_SCAN_PAGES; page += 1) {
    const response = await adminClient.users.list({ status, page, pageSize: USER_PAGE_SIZE });
    const hit = response.users.find((u) => u.username === username);
    if (hit) return hit;
    if (response.users.length < USER_PAGE_SIZE || page * USER_PAGE_SIZE >= response.total) {
      return null;
    }
  }
  return null;
}

/**
 * Delete every account this process registered.
 *
 * Call from a `test.afterAll`, never at the end of a test body: a spec that
 * fails after registering has still created the account, and that is exactly
 * the run whose residue must not be left behind. Best-effort and never throws -
 * a teardown hook must not turn a passing run red, nor bury a real failure
 * behind a cleanup error - but it does warn to stdout naming what it could not
 * remove, because silent accumulation is the defect being fixed.
 */
export async function sweepProvisionedAccounts(adminClient: ApiClient): Promise<void> {
  const usernames = [...mintedUsernames];
  mintedUsernames.clear();
  const stranded: string[] = [];
  for (const username of usernames) {
    try {
      const user = await findUserByUsername(adminClient, username);
      // Already gone (or never landed - e.g. the registration was refused):
      // nothing to sweep, and not worth reporting.
      if (!user) continue;
      await adminClient.users.delete(user.id);
    } catch {
      stranded.push(username);
    }
  }
  if (stranded.length > 0) {
    // stdout, not an annotation: `test.afterAll` has no TestInfo to attach to.
    console.warn(
      `[e2e] MANUAL FOLLOW-UP: could not delete ${stranded.length} account(s) this run created ` +
        `(${stranded.join(', ')}). They remain on the stack; delete them from the Users admin page.`,
    );
  }
}

/** Read the public system config through a throwaway (unauthenticated) client. */
export async function readSystemConfig(env: E2eEnv): Promise<SystemConfig> {
  const client = new ApiClient({ baseUrl: env.apiUrl });
  return client.system.config();
}

/**
 * Provision a `viewer` for the suite.
 *
 * - `E2E_VIEWER_USER`/`E2E_VIEWER_PASS` set: sign in as that pre-seeded account
 *   (the only path that works on a demo stack since #1624 — see the module
 *   header). Returns `null` if those credentials don't authenticate.
 * - Otherwise registers a unique account. On 403 (registration disabled) or 429
 *   (demo per-IP rate limit) returns `null` so the caller can skip gracefully.
 * - Demo mode: the account is created `pending_confirmation`; login is refused
 *   with 403 until the emailed link is followed, which this client cannot do —
 *   returns `null`.
 * - Normal mode: the account is PENDING — an admin approves it as `viewer`
 *   (already-active accounts skip approval) before logging in.
 */
export async function provisionViewer(
  env: E2eEnv,
  adminClient: ApiClient,
): Promise<ProvisionedViewer | null> {
  if (env.viewerUser && env.viewerPass) {
    const seeded = new ApiClient({ baseUrl: env.apiUrl });
    try {
      await seeded.login(env.viewerUser, env.viewerPass);
    } catch (error) {
      // ONLY the two statuses that mean "this stack will not hand out this
      // viewer" degrade to a skip: 401 (credentials refused) and 403 (account
      // not active - the #1624 `pending_confirmation` case). Swallowing every
      // `ApiError` made a typo in `E2E_VIEWER_USER`, a 404 on a renamed route
      // and a 500 all indistinguishable from "no viewer configured", silently
      // disabling every viewer/RBAC/UI case in the project while the run stayed
      // green.
      //
      // 429 is deliberately NOT in this set even though the registration path
      // below swallows it: the demo per-IP limit is documented on
      // `POST /auth/register` and `/auth/resend-confirmation` only, never on
      // `/auth/login` (`auth.controller.ts`). A 429 here would therefore come
      // from a proxy/WAF in front of OL, not from a modelled OL condition, and
      // that is exactly the infrastructure fault we must not convert into a
      // silent skip.
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        return null;
      }
      throw error;
    }
    return {
      client: seeded,
      creds: { username: env.viewerUser, email: '', password: env.viewerPass },
    };
  }

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
    // #1624: demo signups land in `pending_confirmation`. Login answers 403
    // until the emailed link is followed — unreachable from an API client, and
    // no admin endpoint activates that status. Skip rather than fail.
    try {
      await client.login(creds.username, creds.password);
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        return null;
      }
      throw error;
    }
    return { client, creds };
  }

  // Normal mode: locate the just-registered account and approve it. Look in the
  // pending queue first, then fall back to the full list (handles already-active).
  // PAGED (`findUserByUsername`), not a single `pageSize: 100` read: on a stack
  // carrying more than 100 users the flat read stops finding the account it just
  // created and this throws "Provisioned viewer not found" for no real reason.
  const found =
    (await findUserByUsername(adminClient, creds.username, 'pending')) ??
    (await findUserByUsername(adminClient, creds.username));

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

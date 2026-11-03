/**
 * G11 test fixture (#3591)
 *
 * Extends Playwright's own `test` rather than the shared `fixtures/test.ts`,
 * because that one logs in as `OL_ADMIN_USER` from the environment, while the
 * G11 stand names its users in the setup file. Everything role-shaped comes
 * from there: one raw HTTP client per role, a browser opener per role, the
 * Postgres helper and the order context.
 *
 * A missing setup file fails the worker fixture, so every test reports the same
 * clear message instead of skipping.
 *
 * @module fixtures
 */
import { test as base, type Page } from '@playwright/test';
import { ApiClient } from '../api/api-client';
import { poller } from '../support/poller';
import { SyncJobs } from '../support/jobs';
import { buildWorld } from '../world/world';
import { G11Db } from '../support/g11/db';
import { G11Http, type G11Clients } from '../support/g11/http';
import type { G11Ctx } from '../support/g11/orders';
import {
  applySecretsToEnv,
  loadSetup,
  loadUsers,
  type G11Role,
  type G11Setup,
  type G11Users,
} from '../support/g11/setup';

interface WorkerFixtures {
  g11Setup: G11Setup;
  g11Users: G11Users;
  http: G11Clients;
  db: G11Db;
  ctx: G11Ctx;
}

interface TestFixtures {
  /** A page logged in as the role, in its own browser context. */
  openAs: (role: G11Role) => Promise<Page>;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  g11Setup: [
    async ({}, use) => {
      const setup = loadSetup();
      applySecretsToEnv(setup);
      await use(setup);
    },
    { scope: 'worker' },
  ],

  g11Users: [
    async ({ g11Setup }, use) => {
      await use(loadUsers(g11Setup));
    },
    { scope: 'worker' },
  ],

  http: [
    async ({ g11Setup, g11Users }, use) => {
      const [admin, operator, viewer, packer] = await Promise.all([
        G11Http.as(g11Setup.urls.api, g11Users.admin),
        G11Http.as(g11Setup.urls.api, g11Users.operator),
        G11Http.as(g11Setup.urls.api, g11Users.viewer),
        G11Http.as(g11Setup.urls.api, g11Users.packer),
      ]);
      await use({ admin, operator, viewer, packer });
    },
    { scope: 'worker' },
  ],

  db: [
    async ({ g11Setup }, use) => {
      await use(G11Db.from(g11Setup));
    },
    { scope: 'worker' },
  ],

  ctx: [
    async ({ g11Setup, g11Users, db }, use) => {
      const api = new ApiClient({ baseUrl: g11Setup.urls.api });
      await api.login(g11Users.admin.username, g11Users.admin.password);
      const world = await buildWorld(api);
      await use({ setup: g11Setup, api, world, jobs: new SyncJobs(api), poll: poller, db });
    },
    { scope: 'worker' },
  ],

  openAs: async ({ browser, g11Setup, g11Users }, use) => {
    const contexts: Array<{ close: () => Promise<void> }> = [];
    await use(async (role) => {
      const context = await browser.newContext({
        baseURL: g11Setup.urls.web,
        viewport: { width: 1440, height: 900 },
      });
      contexts.push(context);
      const login = await context.request.post(`${g11Setup.urls.api}/v1/auth/login`, {
        data: g11Users[role],
        headers: { 'Content-Type': 'application/json' },
      });
      if (!login.ok()) {
        throw new Error(`browser login as ${role} failed: HTTP ${login.status()} ${await login.text()}`);
      }
      return context.newPage();
    });
    for (const context of contexts) await context.close();
  },
});

export { expect } from '@playwright/test';

/**
 * Extended Playwright test
 *
 * The single import a spec needs. Layers OpenLinker-specific fixtures on top of
 * Playwright's `test`:
 *
 *   - `env`     — resolved config (worker-scoped)
 *   - `api`     — authenticated node API client (worker-scoped)
 *   - `world`   — stack topology resolved from the API (worker-scoped)
 *   - `jobs`    — sync-job trigger helpers over `api` (worker-scoped)
 *   - `poll`    — deterministic polling helper (test-scoped)
 *   - `pages`   — page-object registry bound to `page` (test-scoped)
 *
 * Auth model: the `setup` project writes `.auth/admin.json` (cookies) which the
 * browser projects seed via `storageState`. Because OL rotates refresh tokens
 * with single-use reuse-detection (`RefreshTokenReuseDetectedException`), a
 * shared saved cookie would be revoked the moment a second browser context (or a
 * retry) presented it. So the auto `browserAuth` fixture establishes a *fresh*
 * session per test context by logging in through `context.request` (which shares
 * the browser cookie jar) before the page navigates — sidestepping rotation
 * while still honouring the storageState seed. Trade-off documented in README.
 *
 * @module fixtures
 */
import { test as base, type Page } from '@playwright/test';
import { ApiClient } from '../api/api-client';
import { resolveEnv, type E2eEnv } from '../config/env';
import { poller, type Poller } from '../support/poller';
import { SyncJobs } from '../support/jobs';
import { buildWorld, type World } from '../world/world';
import { createPageObjects, type PageObjects } from '../pages';

interface WorkerFixtures {
  env: E2eEnv;
  api: ApiClient;
  world: World;
  jobs: SyncJobs;
}

interface TestFixtures {
  poll: Poller;
  pages: PageObjects;
  browserAuth: void;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  // Specs locate elements by English text. Pin the interface language so they
  // keep passing whatever VITE_DEFAULT_UI_LOCALE the stack was built with
  // (#3859, ADR-079). A spec that needs Polish navigates with `?lang=pl`,
  // which saves Polish; the pin only fills an empty slot, so a reload or an
  // internal link after that stays in Polish.
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      try {
        if (window.localStorage.getItem('openlinker.locale') === null) {
          window.localStorage.setItem('openlinker.locale', 'en');
        }
      } catch {
        // Storage blocked: the deployment default applies.
      }
    });
    await use(page);
  },

  env: [
    async ({}, use) => {
      await use(resolveEnv());
    },
    { scope: 'worker' },
  ],

  api: [
    async ({ env }, use) => {
      const client = new ApiClient({ baseUrl: env.apiUrl });
      await client.login(env.adminUser, env.adminPass);
      await use(client);
    },
    { scope: 'worker' },
  ],

  world: [
    async ({ api }, use) => {
      await use(await buildWorld(api));
    },
    { scope: 'worker' },
  ],

  jobs: [
    async ({ api }, use) => {
      await use(new SyncJobs(api));
    },
    { scope: 'worker' },
  ],

  // Auto fixture: establish a fresh browser session before the page is used.
  browserAuth: [
    async ({ context, env }, use) => {
      const response = await context.request.post(`${env.apiUrl}/v1/auth/login`, {
        data: { username: env.adminUser, password: env.adminPass },
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok()) {
        throw new Error(
          `Browser auth login failed: HTTP ${response.status()} ${await response.text()}`,
        );
      }
      await use();
    },
    { auto: true },
  ],

  poll: async ({}, use) => {
    await use(poller);
  },

  pages: async ({ page }: { page: Page }, use) => {
    await use(createPageObjects(page));
  },
});

export { expect } from '@playwright/test';

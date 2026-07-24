/**
 * Auth setup project
 *
 * Runs once before the browser projects. Logs in through the real `/login` UI
 * and saves the resulting cookies to `.auth/admin.json` (gitignored). Browser
 * projects seed this via `storageState`; the per-test `browserAuth` fixture then
 * refreshes the session to avoid single-use refresh-token rotation (see
 * src/fixtures/test.ts). This project therefore both produces the canonical
 * "login once" artifact and validates the login UI end-to-end.
 *
 * @module tests
 */
import { test as setup, expect } from '@playwright/test';
import { resolveEnv } from '../src/config/env';
import { LoginPage } from '../src/pages/login.page';
import { STORAGE_STATE } from '../playwright.config';

setup('authenticate operator and persist storage state', async ({ page }) => {
  const env = resolveEnv();
  const loginPage = new LoginPage(page);

  await loginPage.goto();
  await loginPage.login(env.adminUser, env.adminPass);

  // Sanity: the authenticated shell renders its primary nav.
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();

  await page.context().storageState({ path: STORAGE_STATE });
});

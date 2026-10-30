/**
 * Auth bootstrap for the `delivery-on-documents` project (#3912)
 *
 * Same login-through-the-UI artifact the shared `setup` project writes, minus
 * the connection-topology preflight: that preflight demands an active
 * ProductMaster connection, which a near-empty stack this project seeds for
 * itself does not have yet. Named `.bootstrap.ts` rather than `.setup.ts` so
 * the shared `setup` project's `*.setup.ts` glob does not pick it up too.
 *
 * @module tests/delivery-on-documents
 */
import { test as setup, expect } from '@playwright/test';
import { resolveEnv } from '../../src/config/env';
import { LoginPage } from '../../src/pages/login.page';
import { DELIVERY_STORAGE_STATE } from '../../playwright.config';

setup('authenticate operator for delivery-on-documents', async ({ page }) => {
  const env = resolveEnv();
  const loginPage = new LoginPage(page);

  await loginPage.goto();
  await loginPage.login(env.adminUser, env.adminPass);
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();

  await page.context().storageState({ path: DELIVERY_STORAGE_STATE });
});

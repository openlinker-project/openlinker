/**
 * Amazon suite auth bootstrap: logs in once and writes the shared storage
 * state. The generic `setup` project also asserts a catalogue-master topology,
 * which the isolated Amazon stack deliberately does not have.
 *
 * @module tests/amazon
 */
import { test as setup, expect } from '@playwright/test';
import { resolveEnv } from '../../src/config/env';
import { LoginPage } from '../../src/pages/login.page';
import { STORAGE_STATE } from '../../playwright.config';

setup('authenticate admin for the amazon suite', async ({ page }) => {
  const env = resolveEnv();
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login(env.adminUser, env.adminPass);
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  await page.context().storageState({ path: STORAGE_STATE });
});

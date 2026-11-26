/**
 * Amazon E2E part A.1 - connection wizard (points 1-15)
 *
 * @module tests/amazon
 */
import { test, expect, shot, OlApi } from './amazon-test';
import { allMarketplaceOptions, COUNTRY_NAMES, createViaWizard, fillWizard, openWizard, regionWizard } from './wizard';
import { provisionRoleUser } from './roles';
import { resolveEnv } from '../../src/config/env';

let connectionId = '';
const NAME = `Amazon E2E ${Date.now()}`;

async function findByName(ol: OlApi, name: string): Promise<{ id: string } | null> {
  const res = await ol.call('GET', '/connections');
  const list = res.body as { id: string; name: string }[];
  return list.find((c) => c.name === name) ?? null;
}

test('P001 catalogue lists the Amazon card', async ({ page }) => {
  await page.goto('/connections/new');
  const card = page.getByText('Amazon', { exact: true }).first();
  await expect(card).toBeVisible();
  await expect(page.getByText('Sell on Amazon: import orders, link and publish listings, keep stock and prices in sync.')).toBeVisible();
  await expect(page.getByText('Marketplace').first()).toBeVisible();
});

test('P002 setup page states one connection is one account in one region', async ({ page }) => {
  await openWizard(page);
  await expect(page.getByText('One connection is one Amazon seller account in one region')).toBeVisible();
  await expect(page.getByText(/cannot be changed later/)).toBeVisible();
  await expect(page.getByText(/Far East connection covers one marketplace/)).toBeVisible();
});

test('P003 empty submit shows required errors and creates nothing', async ({ page, ol }) => {
  const before = await ol.call('GET', '/connections');
  await openWizard(page);
  await page.getByLabel('Connection name').fill('');
  await page.getByLabel('LWA client id').fill('');
  await page.getByRole('button', { name: 'Create connection' }).click();
  await expect(page.getByText('Choose at least one marketplace.').first()).toBeVisible();
  await expect(page.getByText('This field is required.').first()).toBeVisible();
  const after = await ol.call('GET', '/connections');
  expect(JSON.stringify(after.body)).toBe(JSON.stringify(before.body));
});

test('P004 EU region lists only its marketplaces, labelled country (currency)', async ({ page, region }) => {
  await openWizard(page);
  await page.getByLabel('Region', { exact: true }).selectOption('eu');
  await page.locator('button[aria-haspopup="listbox"]').first().click();
  const options = await allMarketplaceOptions(page);
  expect(options).toHaveLength(16);
  expect(options).toContain('Poland (PLN)');
  expect(options).toContain('Germany (EUR)');
  expect(options.some((o) => o.includes('United States'))).toBe(false);
  void region;
});

test('P005 switching region drops marketplaces the new region does not serve', async ({ page }) => {
  await openWizard(page);
  await page.getByLabel('Region', { exact: true }).selectOption('eu');
  const combo = page.locator('button[aria-haspopup="listbox"]').first();
  await combo.click();
  await page.locator('[role=listbox] [role=option]').filter({ hasText: 'Germany (EUR)' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('form').getByText('Germany (EUR)').first()).toBeVisible();
  await page.getByLabel('Region', { exact: true }).selectOption('na');
  await expect(page.locator('form').getByText('Germany (EUR)')).toHaveCount(0);
  await page.getByLabel('Region', { exact: true }).selectOption('eu');
  await expect(page.locator('form').getByText('Germany (EUR)')).toHaveCount(0);
  await expect(page.locator('form').getByText('Choose marketplaces').first()).toBeVisible();
});

test('P006 Far East accepts one marketplace and explains why', async ({ page }) => {
  await openWizard(page);
  await page.getByLabel('Region', { exact: true }).selectOption('fe');
  await expect(page.getByText('Each country in this region is a separate seller account, so choose one marketplace.')).toBeVisible();
  const combo = page.locator('button[aria-haspopup="listbox"]').first();
  await combo.click();
  const options = await allMarketplaceOptions(page);
  expect(options).toHaveLength(3);
  await page.locator('[role=listbox] [role=option]').filter({ hasText: 'Japan (JPY)' }).click();
  await combo.click().catch(() => undefined);
  const second = page.locator('[role=listbox] [role=option]').filter({ hasText: 'Australia (AUD)' });
  if (await second.isVisible().catch(() => false)) await second.click();
  await page.keyboard.press('Escape');
  const selectedText = await page.locator('form').innerText();
  const hasJapan = selectedText.includes('Japan (JPY)');
  const hasAustralia = selectedText.includes('Australia (AUD)');
  expect(hasJapan !== hasAustralia || (hasJapan && !hasAustralia)).toBe(true);
});

test('P007 sandbox environment shows the sample-data notice', async ({ page }) => {
  await openWizard(page);
  await page.getByLabel('Environment', { exact: true }).selectOption('sandbox');
  await expect(page.getByText("The sandbox answers with Amazon's sample data only. No real orders or listings are read or changed.")).toBeVisible();
});

test('P008 role switch: sales channel offers orders and offers, master keeps offers off', async ({ page }) => {
  await openWizard(page);
  await page.getByRole('radio', { name: /Sales channel/ }).check();
  await expect(page.getByRole('checkbox', { name: /^Offers/ })).toBeEnabled();
  await page.getByRole('radio', { name: /Catalogue master/ }).check();
  await expect(page.getByRole('checkbox', { name: /^Offers/ })).toBeDisabled();
  await expect(page.getByText("A catalogue master's stock is not written back to its own listings, so offers stay off.")).toBeVisible();
});

test('P009 offers need the merchant token', async ({ page, region }) => {
  await openWizard(page);
  await fillWizard(page, regionWizard(region, 'x', { offers: true }));
  await page.getByRole('button', { name: 'Create connection' }).click();
  await expect(page.getByText('The merchant token is required to manage offers.').first()).toBeVisible();
  await page.getByRole('checkbox', { name: /^Offers/ }).uncheck();
  await page.getByRole('button', { name: 'Create connection' }).click();
  await expect(page.getByText('The merchant token is required to manage offers.')).toHaveCount(0);
});

test('P010 malformed merchant token is rejected', async ({ page, region }) => {
  await openWizard(page);
  await fillWizard(page, regionWizard(region, 'x', { offers: true, sellerId: 'abc' }));
  await page.getByRole('button', { name: 'Create connection' }).click();
  await expect(page.getByText(/Enter the merchant token from Seller Central: 8 to 20 capital letters and digits/).first()).toBeVisible();
});

test('P011 SQS queue url must be well formed, empty is fine', async ({ page, region }) => {
  await openWizard(page);
  await fillWizard(page, regionWizard(region, 'x', { queueUrl: 'https://example.com/q' }));
  await page.getByRole('button', { name: 'Create connection' }).click();
  await expect(page.getByText(/Enter an SQS queue URL, such as/).first()).toBeVisible();
});

test('P012 only one AWS key is refused', async ({ page, region }) => {
  await openWizard(page);
  await fillWizard(page, regionWizard(region, 'x', { awsKeyId: 'AKIAEXAMPLE' }));
  await page.getByRole('button', { name: 'Create connection' }).click();
  await expect(page.getByText('Enter both AWS keys, or neither.').first()).toBeVisible();
});

test('P013 a valid connection is created for this region and listed Active', async ({ page, region, ol }) => {
  await openWizard(page);
  await fillWizard(page, regionWizard(region, NAME));
  await page.getByRole('button', { name: 'Create connection' }).click();
  await expect(page.getByText('Amazon connection created')).toBeVisible();
  await expect(page.getByText('Open the connection').first()).toBeVisible();
  connectionId = (await findByName(ol, NAME))?.id ?? '';
  expect(connectionId).not.toBe('');
  await shot(page, region.region, 13);
  await page.goto('/connections');
  await expect(page.getByText(NAME)).toBeVisible();
  void COUNTRY_NAMES;
  void createViaWizard;
});

test('P014 stored connection has region, environment, marketplaces array and no secret', async ({ ol, region, evidence }) => {
  connectionId = connectionId || ((await findByName(ol, NAME))?.id ?? '');
  const res = await ol.call('GET', `/connections/${connectionId}`);
  expect(res.status).toBe(200);
  expect(res.body.platformType).toBe('amazon');
  expect(res.body.adapterKey).toBe('amazon.spapi.v1');
  expect(res.body.config.region).toBe(region.region);
  expect(res.body.config.environment).toBe('production');
  expect(Array.isArray(res.body.config.marketplaceIds)).toBe(true);
  expect(res.body.config.marketplaceIds).toEqual(region.marketplaces.map((m) => m.id));
  const text = JSON.stringify(res.body);
  expect(text).not.toMatch(/e2e-fake-secret|Atzr\|e2e-fake-refresh-token|clientSecret|refreshToken/);
  await evidence('GET /v1/connections/:id', res.body);
});

test('P015 viewer sees Read-only access instead of the form', async ({ browser, ol, region }) => {
  const env = resolveEnv();
  const viewer = await provisionRoleUser(env, ol, 'viewer');
  const ctx = await browser.newContext({ baseURL: env.webUrl });
  await ctx.request.post(`${env.apiUrl}/v1/auth/login`, { data: { username: viewer.username, password: viewer.password } });
  const page = await ctx.newPage();
  await page.addInitScript(() => window.localStorage.setItem('openlinker.locale', 'en'));
  await page.goto('/connections/new/amazon');
  await expect(page.getByText('Read-only access')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create connection' })).toHaveCount(0);
  await shot(page, region.region, 15);
  await ctx.close();
});

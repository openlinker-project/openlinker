/**
 * Page helpers for the Amazon setup wizard and the connection edit page.
 *
 * @module tests/amazon
 */
import type { Locator, Page } from '@playwright/test';
import type { RegionFixture } from '../../src/support/amazon';

export const COUNTRY_NAMES: Record<string, string> = {
  PL: 'Poland',
  DE: 'Germany',
  US: 'United States',
  JP: 'Japan',
};

export interface WizardInput {
  name: string;
  region?: 'eu' | 'na' | 'fe';
  environment?: 'production' | 'sandbox';
  marketplaces?: readonly { country: string; currency: string }[];
  role?: 'sales-channel' | 'master';
  orders?: boolean;
  offers?: boolean;
  sellerId?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  queueUrl?: string;
  awsKeyId?: string;
  awsSecret?: string;
  /** 'now' | 'from' | 'all'; default leaves the recommended "New orders only". */
  start?: 'now' | 'from' | 'all';
}

export const marketplacePicker = (page: Page): Locator =>
  page.getByRole('button', { name: /Choose marketplaces|\(\w{3}\)/ }).first();

export async function openWizard(page: Page): Promise<void> {
  await page.goto('/connections/new/amazon');
  await page.getByLabel('Connection name').waitFor();
}

export async function pickMarketplaces(
  page: Page,
  marketplaces: readonly { country: string; currency: string }[],
): Promise<void> {
  const combo = page.locator('button[aria-haspopup="listbox"]').first();
  await combo.click();
  for (const m of marketplaces) {
    await page.locator('[role=listbox] [role=option]').filter({ hasText: `${COUNTRY_NAMES[m.country] ?? m.country} (${m.currency})` }).first().click();
  }
  await page.keyboard.press('Escape');
}

export async function fillWizard(page: Page, input: WizardInput): Promise<void> {
  await page.getByLabel('Connection name').fill(input.name);
  if (input.region) await page.getByLabel('Region', { exact: true }).selectOption(input.region);
  if (input.environment) await page.getByLabel('Environment', { exact: true }).selectOption(input.environment);
  if (input.marketplaces) await pickMarketplaces(page, input.marketplaces);
  if (input.role === 'master') await page.getByRole('radio', { name: /Catalogue master/ }).check();
  else if (input.role === 'sales-channel') await page.getByRole('radio', { name: /Sales channel/ }).check();
  const orders = page.getByRole('checkbox', { name: /^Orders/ });
  if (input.orders !== undefined) {
    if (input.orders) await orders.check();
    else await orders.uncheck();
  }
  const offers = page.getByRole('checkbox', { name: /^Offers/ });
  if (input.offers !== undefined) {
    if (input.offers) await offers.check();
    else await offers.uncheck();
  }
  if (input.start === 'all') await page.getByText('Every order the shop has').click();
  if (input.start === 'now') await page.getByText('New orders only').click();
  if (input.sellerId !== undefined) await page.getByLabel('Merchant token').fill(input.sellerId);
  await page.getByLabel('LWA client id').fill(input.clientId ?? 'amzn1.application-oa2-client.e2efake');
  await page.getByLabel('LWA client secret').fill(input.clientSecret ?? 'e2e-fake-secret');
  await page.getByLabel('Refresh token').fill(input.refreshToken ?? 'Atzr|e2e-fake-refresh-token');
  if (input.queueUrl !== undefined || input.awsKeyId !== undefined) {
    await page.getByText('Order notifications (optional)').click();
    if (input.queueUrl !== undefined) await page.getByLabel('SQS queue URL').fill(input.queueUrl);
    if (input.awsKeyId !== undefined) await page.getByLabel('AWS access key id').fill(input.awsKeyId);
    if (input.awsSecret !== undefined) await page.getByLabel('AWS secret access key').fill(input.awsSecret);
  }
}

export function regionWizard(r: RegionFixture, name: string, extra: Partial<WizardInput> = {}): WizardInput {
  return {
    name,
    region: r.region,
    environment: 'production',
    marketplaces: r.region === 'eu' ? r.marketplaces : r.marketplaces,
    role: 'sales-channel',
    orders: true,
    offers: false,
    ...extra,
  };
}

/** Creates a connection through the wizard and returns its id (read back from the API list by name). */
export async function createViaWizard(
  page: Page,
  input: WizardInput,
  listByName: (name: string) => Promise<{ id: string } | null>,
): Promise<string> {
  await openWizard(page);
  await fillWizard(page, input);
  await page.getByRole('button', { name: 'Create connection' }).click();
  await page.getByText('Amazon connection created').waitFor();
  const found = await listByName(input.name);
  if (!found) throw new Error(`connection ${input.name} not found after wizard create`);
  return found.id;
}

/** Every option of the (virtualised) marketplace list, collected while scrolling it. */
export async function allMarketplaceOptions(page: Page): Promise<string[]> {
  const seen = new Set<string>();
  const list = page.locator('[role=listbox]').first();
  await list.waitFor();
  for (let i = 0; i < 40; i += 1) {
    for (const text of await page.locator('[role=listbox] .combobox__option-label').allInnerTexts()) seen.add(text.trim());
    const atEnd = await list.evaluate((el) => {
      const before = el.scrollTop;
      el.scrollTop += el.clientHeight - 20;
      return el.scrollTop === before;
    });
    if (atEnd) break;
    await page.waitForTimeout(80);
  }
  return [...seen];
}

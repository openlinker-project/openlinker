/**
 * Sales documents: the providers table split onto its own page (#2806 review)
 *
 * Verifies the settings market page and the new
 * `/settings/sales-documents/providers` page against operator feedback: the
 * two tables ("what each market issues" vs. "which connection is configured
 * to issue automatically") were stacked directly on top of each other with
 * no visual break, reading as one long table answering two unrelated
 * questions. This confirms the split actually landed — the market page no
 * longer renders the providers table, a link takes the operator to it, and
 * the new page renders it standalone with its own heading.
 *
 * Also captures `/settings` itself, so the entry point into this flow is on
 * record too.
 *
 * @module tests/sales-documents
 */
import { test, expect } from '../../src/fixtures/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCREENSHOT_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '__screenshots__',
);

test.beforeAll(async () => {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
});

test.describe('sales documents: providers page split (#2806 review)', () => {
  test('the settings page lists Sales documents and is admin-visible', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('heading', { name: 'Sales documents' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Manage routing' })).toBeVisible();
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'desktop-1440-settings-index.png'),
      fullPage: true,
    });
  });

  test('the market page no longer renders the providers table, and links to it', async ({
    page,
  }) => {
    await page.goto('/settings/sales-documents');
    await expect(page.getByRole('heading', { name: 'Sales documents' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole('list', { name: 'Sales-document markets' }).or(page.getByText('No markets yet')),
    ).toBeVisible({ timeout: 30_000 });

    // The providers table's own distinguishing column header must be GONE
    // from this page now — this is the actual regression guard for the
    // split, not just "a link exists".
    await expect(page.getByText('Goes first', { exact: false })).toHaveCount(0);
    await expect(page.getByText('No connection is marked primary')).toHaveCount(0);

    const link = page.getByRole('link', { name: /Manage connections/i });
    await expect(link).toBeVisible();

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'desktop-1440-market-page-no-providers.png'),
      fullPage: true,
    });

    await link.click();
    await expect(page).toHaveURL(/\/settings\/sales-documents\/providers$/);
  });

  test('the providers page renders the table standalone, with its own heading', async ({
    page,
  }) => {
    await page.goto('/settings/sales-documents/providers');
    await expect(page.getByRole('heading', { name: 'Connected providers' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('columnheader', { name: 'Goes first' })).toBeVisible();

    // Back-navigation returns to the market page, not to bare /settings —
    // this page is a child of the market page, not a sibling of it.
    await expect(page.getByRole('link', { name: 'Sales documents' })).toBeVisible();

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'desktop-1440-providers-page.png'),
      fullPage: true,
    });
  });
});

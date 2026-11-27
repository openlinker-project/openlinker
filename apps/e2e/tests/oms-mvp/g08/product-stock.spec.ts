/**
 * G08 product page stock: one variants table, one Stock column
 *
 * The product detail page answers "how much can I sell" in the variants table
 * itself: each row carries an available-to-sell figure with a status badge, and
 * an expanded row shows the formula, where the count lives and the way into the
 * correction dialog and the history. A viewer sees the same figures with Adjust
 * disabled and the reason beside it.
 *
 * READ-ONLY. Nothing here writes stock. The product is found through the API
 * (a multi-variant product whose variants a PrestaShop master owns); a stack
 * without one skips the suite with that reason.
 *
 * @module tests/oms-mvp/g08
 */
import type { Locator } from '@playwright/test';
import { test, expect } from '../../../src/fixtures/test';
import { ProductStockPage } from '../../../src/pages/product-stock.page';
import {
  provisionViewer,
  seedBrowserSession,
  sweepProvisionedAccounts,
} from '../../../src/support/access-control';
import {
  findStockFixture,
  SKIP_NO_FIXTURE,
  type StockFixture,
} from '../../../src/support/g08-stock-fixture';

const VIEWER_HINT = 'Only admins and operators can change stock.';

test.describe('G08 product page stock', () => {
  let fixture: StockFixture | null = null;

  test.beforeAll(async ({ api }) => {
    fixture = await findStockFixture(api);
  });

  test.afterAll(async ({ api }) => {
    await sweepProvisionedAccounts(api);
  });

  test.beforeEach(() => {
    test.skip(fixture === null, SKIP_NO_FIXTURE);
  });

  test('shows every variant once in a single table with its available-to-sell figure', async ({
    page,
    api,
  }) => {
    const stock = new ProductStockPage(page);
    await stock.goto(fixture!.productId);

    const availability = await api.inventory.availability(fixture!.variants.map((v) => v.id));

    for (const variant of fixture!.variants) {
      await expect(stock.row(variant.key)).toHaveCount(1);
      const apiValue = availability.find((a) => a.productVariantId === variant.id)
        ?.availableToPromise;
      // `null`/absent means OpenLinker does not know; the page then shows a dash
      // and never a zero, so there is nothing numeric to compare.
      if (typeof apiValue === 'number') {
        await expect(stock.atp(variant.key)).toHaveText(String(apiValue));
      } else {
        await expect(stock.atp(variant.key)).toBeVisible();
      }
    }

    // One table: the stock column is not a second, separate stock panel.
    await expect(page.getByTestId('stock-summary-atp')).toHaveText(/^\d+$/);
  });

  test('expands a row to the formula, where the count lives and the way into history', async ({
    page,
  }) => {
    const variant = fixture!.variants[0];
    const stock = new ProductStockPage(page);
    await stock.goto(fixture!.productId);
    await stock.expand(variant.key);

    await expect(page.getByTestId(`stock-formula-${variant.key}`)).toContainText(/=\s*\d+ to sell/);
    await expect(page.getByTestId(`stock-provenance-${variant.key}`)).toBeVisible();
    // The per-position table only appears when a variant has more than one position.
    await expect(page.getByTestId(`stock-positions-${variant.key}`)).toHaveCount(0);
    await expect(stock.adjustButton(variant.key)).toBeEnabled();
    await expect(page.getByTestId(`stock-adjust-hint-${variant.key}`)).toHaveCount(0);

    await page.getByTestId(`stock-movements-${variant.key}`).click();
    await expect(page.getByTestId('stock-history')).toBeVisible();
    await expect(page.getByTestId('stock-history-variant')).toHaveValue(variant.id);
  });

  test('lists the orders behind a reservation when a variant has one', async ({ page }) => {
    const stock = new ProductStockPage(page);
    await stock.goto(fixture!.productId);

    const held: Locator = page.locator('[data-testid^="stock-held-"]');
    test.skip((await held.count()) === 0, 'No variant of the fixture product carries a reservation.');

    const heldKey = (await held.first().getAttribute('data-testid'))!.replace('stock-held-', '');
    await expect(held.first()).toContainText(/\d+ reserved/);
    await expect(page.getByTestId(`stock-master-${heldKey}`)).toContainText(/\d+ in /);

    await stock.expand(heldKey);
    await page.getByTestId(`stock-holds-toggle-${heldKey}`).click();
    await expect(page.getByTestId(`stock-holds-${heldKey}`)).toBeVisible();
  });

  test('gives a viewer the figures with Adjust disabled and the reason beside it', async ({
    api,
    env,
    browser,
  }) => {
    const viewer = await provisionViewer(env, api);
    test.skip(
      !viewer,
      'No viewer available: registration disabled, rate-limited, or awaiting email confirmation. ' +
        'Set E2E_VIEWER_USER / E2E_VIEWER_PASS to a pre-seeded active viewer.',
    );

    const variant = fixture!.variants[0];
    const context = await browser.newContext({ baseURL: env.webUrl });
    try {
      // A fresh context can inherit the admin cookies; clear them so this stays a viewer run.
      await context.clearCookies();
      await seedBrowserSession(context, env, viewer!.creds);
      const page = await context.newPage();
      const stock = new ProductStockPage(page);
      await page.goto(`/products/${fixture!.productId}`);

      await expect(page.getByTestId('stock-viewer-notice')).toBeVisible();
      await stock.expand(variant.key);
      await expect(stock.adjustButton(variant.key)).toBeDisabled();
      await expect(page.getByTestId(`stock-adjust-hint-${variant.key}`)).toHaveText(VIEWER_HINT);
    } finally {
      await context.close();
    }
  });
});

/**
 * G08 products list: the Stock column is available to sell
 *
 * `/products` shows what can be sold per product, not the master's raw count,
 * and keeps the same test ids on the desktop table and the mobile cards so a
 * stock check reads either layout the same way. The "Out of stock" tile filters
 * on that same figure.
 *
 * READ-ONLY. The product is found through the API (any product with a known
 * available-to-sell figure); the suite skips with that reason when there is none.
 *
 * @module tests/oms-mvp/g08
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../../../src/fixtures/test';
import type { Product } from '../../../src/api/api.types';

const MOBILE_VIEWPORT = { width: 390, height: 844 };

async function openProductsFiltered(page: Page, product: Product): Promise<void> {
  await page.goto(`/products?search=${encodeURIComponent(product.name)}`);
}

test.describe('G08 products list stock', () => {
  let product: Product | null = null;
  let rowKey = '';

  test.beforeAll(async ({ api }) => {
    const page = await api.products.list({ limit: 50 });
    product = page.items.find((p) => typeof p.availableToPromise === 'number') ?? null;
    rowKey = product ? (product.sku ?? product.id) : '';
  });

  test.beforeEach(() => {
    test.skip(product === null, 'No product with a known available-to-sell figure on this stack.');
  });

  test('desktop table shows available to sell and matches the API figure', async ({ page }) => {
    await openProductsFiltered(page, product!);

    await expect(page.getByTestId('stock-list-table')).toBeVisible();
    await expect(page.getByTestId(`stock-list-row-${rowKey}`)).toBeVisible();
    const cell = page.getByTestId(`stock-list-cell-${rowKey}`);
    await expect(cell).toContainText(`${product!.availableToPromise}`);
    await expect(cell).toContainText('to sell');
  });

  test.describe('mobile', () => {
    test.use({ viewport: MOBILE_VIEWPORT });

    test('cards carry the same row and cell test ids as the table', async ({ page }) => {
      await openProductsFiltered(page, product!);

      await expect(page.getByTestId('stock-list-cards')).toBeVisible();
      await expect(page.getByTestId(`stock-list-row-${rowKey}`)).toBeVisible();
      const cell = page.getByTestId(`stock-list-cell-${rowKey}`);
      await expect(cell).toContainText(`${product!.availableToPromise} to sell`);
    });
  });

  test('the Out of stock tile keeps only products that cannot be sold', async ({ page, api }) => {
    const out = await api.products.list({ limit: 50 });
    const hasSoldOut = out.items.some((p) => p.availableToPromise === 0);
    test.skip(!hasSoldOut, 'No product on the first page has 0 available to sell.');

    await page.goto('/products');
    const tile = page.locator('button.products-segment').filter({ hasText: 'Out of stock' });
    await tile.click();
    await expect(tile).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/[?&]stock=out/);

    const cells = page.locator('[data-testid^="stock-list-cell-"]');
    await expect(cells.first()).toBeVisible();
    // Polled: the list refetches after the tile click, so the first read can
    // still be the unfiltered page.
    await expect
      .poll(async () => (await cells.allInnerTexts()).every((text) => /^\s*0\s+to sell/.test(text)))
      .toBe(true);
  });
});

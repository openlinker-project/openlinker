/**
 * G08 stock history
 *
 * The product page's history section and the global `/inventory/movements`
 * page read one ledger: stock movements plus reservations. A correction shows
 * with its real before and after; a reservation reads "Reserved"; a change the
 * master refused reads "Not applied" and nothing else about the count; a new
 * position reads "new -> N".
 *
 * Rows the stack may not hold (reservations, refusals, new positions) are
 * asserted only when the API reports one, and skip with that reason otherwise:
 * a spec cannot make the shop refuse a write or an order reserve stock on cue.
 * The correction rows are made here, and the stock is restored afterwards.
 *
 * `retries: 0` on the project; serial, because the specs share the fixture
 * product's ledger.
 *
 * @module tests/oms-mvp/g08
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../../../src/fixtures/test';
import {
  findStockFixture,
  freshIdempotencyKey,
  restoreStock,
  SKIP_NO_FIXTURE,
  stockiest,
  type StockFixture,
} from '../../../src/support/g08-stock-fixture';
import type { ApiClient } from '../../../src/api/api-client';

const VIEWPORTS = [
  { name: 'desktop', viewport: { width: 1280, height: 800 } },
  { name: 'mobile', viewport: { width: 390, height: 844 } },
] as const;

test.describe.configure({ mode: 'serial' });

/** Make one applied manual correction (+1) and put it back, leaving two ledger rows. */
async function leaveCorrectionAndRestore(
  api: ApiClient,
  fixture: StockFixture,
): Promise<{ id: string; before: number }> {
  const variant = stockiest(fixture);
  const outcome = await api.inventory.correct(variant.id, {
    mode: 'set',
    quantity: variant.quantity + 1,
    operatorReason: 'count_correction',
    idempotencyKey: freshIdempotencyKey(),
    // Only the ledger rows matter here, not the large-change rule.
    confirmLargeChange: true,
  });
  expect(outcome.kind).toBe('result');
  await restoreStock(api, fixture);
  return { id: variant.id, before: variant.quantity };
}

async function rowText(page: Page, index: number, testId: string): Promise<string> {
  return (
    await page
      .getByTestId('stock-history')
      .locator('[data-movement-type="manual"]')
      .nth(index)
      .getByTestId(testId)
      .innerText()
  ).trim();
}

test.describe('G08 stock history', () => {
  let fixture: StockFixture | null = null;

  test.beforeAll(async ({ api }) => {
    fixture = await findStockFixture(api);
  });

  test.afterEach(async ({ api }) => {
    if (fixture) await restoreStock(api, fixture);
  });

  test('product page history shows a correction and its restore with real before and after', async ({
    page,
    api,
  }) => {
    test.skip(fixture === null, SKIP_NO_FIXTURE);
    const { id, before } = await leaveCorrectionAndRestore(api, fixture!);

    await page.goto(`/products/${fixture!.productId}`);
    await page.getByTestId('stock-history-variant').selectOption(id);
    await expect(page.getByTestId('stock-history-summary')).toBeVisible();

    // Newest first: the restore (before + 1 -> before), then the correction (before -> before + 1).
    const manual = page.getByTestId('stock-history').locator('[data-movement-type="manual"]');
    await expect(manual.first()).toBeVisible();
    await expect.poll(() => manual.count()).toBeGreaterThanOrEqual(2);

    expect(await rowText(page, 0, 'stock-movement-before')).toBe(String(before + 1));
    expect(await rowText(page, 0, 'stock-movement-after')).toBe(String(before));
    expect(await rowText(page, 1, 'stock-movement-before')).toBe(String(before));
    expect(await rowText(page, 1, 'stock-movement-after')).toBe(String(before + 1));
  });

  for (const { name, viewport } of VIEWPORTS) {
    test.describe(`movements page (${name})`, () => {
      test.use({ viewport });

      test('filters by type and by the Needs attention and Reserved only chips', async ({
        page,
        api,
      }) => {
        test.skip(fixture === null, SKIP_NO_FIXTURE);
        await leaveCorrectionAndRestore(api, fixture!);

        await page.goto('/inventory/movements');
        const rows = page.getByTestId('stock-movement-row');
        await expect(page.getByTestId('stock-movements-table')).toBeVisible();
        await expect(rows.first()).toBeVisible();

        // Type filter: only manual corrections remain.
        await page.getByTestId('stock-movements-filter-type').selectOption('manual_correction');
        await expect(page).toHaveURL(/[?&]type=manual_correction/);
        await expect(rows.first()).toBeVisible();
        await expect
          .poll(async () =>
            (await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-movement-type')))).every(
              (type) => type === 'manual',
            ),
          )
          .toBe(true);

        // Chips replace the type filter and are linkable.
        await page.getByTestId('stock-movements-chip-attention').click();
        await expect(page).toHaveURL(/[?&]chip=attention/);
        await expect(page).not.toHaveURL(/[?&]type=/);
        await page.getByTestId('stock-movements-chip-promised').click();
        await expect(page).toHaveURL(/[?&]chip=promised/);
        await page.getByTestId('stock-movements-chip-all').click();
        await expect(page).not.toHaveURL(/[?&]chip=/);
        await expect(rows.first()).toBeVisible();
      });
    });
  }

  test('Reserved only lists reservations, each marked Reserved', async ({ page, api }) => {
    const reservations = await api.inventory.movements({ kind: 'promised', limit: 1 });
    test.skip(reservations.items.length === 0, 'No reservation exists on this stack.');

    await page.goto('/inventory/movements?chip=promised');
    const rows = page.getByTestId('stock-movement-row');
    await expect(rows.first()).toBeVisible();
    await expect
      .poll(async () =>
        (await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-movement-type')))).every(
          (type) => type === 'reservation',
        ),
      )
      .toBe(true);
    await expect(rows.first().getByTestId('stock-movement-promised')).toHaveText('Reserved');
  });

  test('a refused movement reads Not applied, struck from the count', async ({ page, api }) => {
    const all = await api.inventory.movements({ kind: 'movements', limit: 100 });
    const refused = all.items.find((m) => m.status === 'refused');
    test.skip(!refused, 'No refused movement exists on this stack.');

    await page.goto('/inventory/movements?chip=attention');
    const row = page.locator('[data-testid="stock-movement-row"][data-movement-status="refused"]');
    await expect(row.first()).toBeVisible();
    await expect(row.first().getByTestId('stock-movement-after')).toHaveText('Not applied');
  });

  test('a movement that created a position reads new, not a question mark', async ({
    page,
    api,
  }) => {
    const all = await api.inventory.movements({ kind: 'movements', limit: 100 });
    const created = all.items.find(
      (m) =>
        m.status === 'applied' &&
        m.quantityBefore === null &&
        m.quantityAfter !== null &&
        m.productVariantId !== null,
    );
    test.skip(!created, 'No applied movement without a before-quantity exists on this stack.');

    await page.goto(`/inventory/movements?productVariantId=${created!.productVariantId}`);
    const row = page
      .locator('[data-testid="stock-movement-row"][data-movement-status="applied"]')
      .filter({ has: page.getByTestId('stock-movement-before').filter({ hasText: 'new' }) });
    await expect(row.first()).toBeVisible();
    await expect(row.first().getByTestId('stock-movement-after')).not.toHaveText('?');
  });
});

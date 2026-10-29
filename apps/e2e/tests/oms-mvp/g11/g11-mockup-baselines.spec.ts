/**
 * G11 mockup baselines and live parity (#3591)
 *
 * Part 1 serves the REPO-COMMITTED mockups (`file://`, never the Artifact URL,
 * `docs/frontend-architecture.md` § UX Mockups) and screenshots every
 * `data-mk-state` - 8 in M26, 9 in M30 - failing when the count in the file
 * stops matching the list below, so a state added to a mockup cannot go
 * uncovered.
 *
 * Part 2 drives the live app to the same state for each one and asserts the key
 * `data-testid`s are present, with a screenshot beside the mockup's. Test ids
 * the mockup draws but the shipped screens deliberately do not carry are
 * recorded as annotations (`MOCKUP_ONLY`), not skipped silently.
 *
 * Seed for part 2 (admin API + shop orders, no SQL): A1 gets a cost and one
 * order; A2 gets one order and stays without a cost, so margin, the coverage
 * note, the banners and the work list all have something to show.
 *
 * @module tests/oms-mvp/g11
 */
import { test as plain, expect as plainExpect } from '@playwright/test';
import { test, expect } from '../../../src/fixtures/g11';
import {
  G11_MOCKUP_FILES,
  M26_STATES,
  M30_STATES,
  MOCKUP_ONLY,
  MOCKUP_TESTIDS,
  OmsMvpG11MockupPage,
} from '../../../src/pages/oms-mvp-g11-mockup.page';
import { VariantCostPage, slugOf } from '../../../src/pages/variant-cost.page';
import { CostWorklistPage } from '../../../src/pages/cost-worklist.page';
import { MarginPanelPage } from '../../../src/pages/margin-panel.page';
import { createPrestashopOrder } from '../../../src/support/g11/orders';
import { liveWindow } from '../../../src/support/g11/ranges';
import { mustClearCost, mustSetCost } from '../../../src/support/g11/cost';

const FILES = { m26: G11_MOCKUP_FILES.m26, m30: G11_MOCKUP_FILES.m30 } as const;
const STATE_LISTS = { m26: M26_STATES, m30: M30_STATES } as const;

plain.describe('G11 mockup baselines @g11', () => {
  for (const key of ['m26', 'm30'] as const) {
    const expected = STATE_LISTS[key];

    plain(`${key.toUpperCase()} declares exactly ${expected.length} states`, async ({ page }) => {
      const mockup = new OmsMvpG11MockupPage(page);
      await mockup.gotoState(FILES[key], expected[0]);
      const declared = await page.locator('[data-mk-state]').evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute('data-mk-state')),
      );
      plainExpect(declared.sort()).toEqual([...expected].sort());
    });

    plain(`${key.toUpperCase()} - one screenshot per state, with the testids it declares`, async ({ page }, testInfo) => {
      const mockup = new OmsMvpG11MockupPage(page);
      for (const state of expected) {
        await mockup.gotoState(FILES[key], state);
        const region = mockup.visibleStateRegion();
        await plainExpect(region).toHaveAttribute('data-mk-state', state);
        const ids = (MOCKUP_TESTIDS[key] as Record<string, readonly string[]>)[state] ?? [];
        for (const id of ids) {
          await plainExpect(
            page
              .locator(`[data-mk-state="${state}"] [data-testid="${id}"], [data-mk-state="${state}"][data-testid="${id}"]`)
              .first(),
            `${key}/${state} declares ${id}`,
          ).toBeAttached();
        }
        const shot = testInfo.outputPath(`${key}--${state}--mockup.png`);
        await page.screenshot({ path: shot, fullPage: true });
        await testInfo.attach(`${key.toUpperCase()} mockup - ${state}`, { path: shot, contentType: 'image/png' });
      }
    });
  }
});

test.describe('G11 live parity with the mockup states @g11', () => {
  test.describe.configure({ mode: 'serial' });

  let orderA1: string | undefined;
  let orderA2: string | undefined;

  test.beforeAll(async ({ ctx, http }) => {
    const { psA } = ctx.setup.products;
    if (!psA || !ctx.setup.connections.prestashop) return;
    const a1 = psA.variants.A1;
    const a2 = psA.variants.A2;
    if (!a1 || !a2) return;
    await mustSetCost(http.admin, a1.variantId, '10.00', 'PLN');
    await mustClearCost(http.admin, a2.variantId);
    orderA1 = (await createPrestashopOrder(ctx, psA.productId, a1, 1)).order.internalOrderId;
    orderA2 = (await createPrestashopOrder(ctx, psA.productId, a2, 1)).order.internalOrderId;
  });

  /** Assert `ids` are attached on the live page and note the ones the mockup alone carries. */
  async function expectLive(
    page: import('@playwright/test').Page,
    state: string,
    ids: readonly string[],
  ): Promise<void> {
    for (const id of ids) {
      if (MOCKUP_ONLY[id]) {
        test.info().annotations.push({ type: 'mockup-only', description: `${state}: ${id} - ${MOCKUP_ONLY[id]}` });
        continue;
      }
      await expect(page.getByTestId(id).first(), `${state}: ${id}`).toBeAttached();
    }
  }

  async function shoot(page: import('@playwright/test').Page, name: string): Promise<void> {
    const testInfo = test.info();
    const path = testInfo.outputPath(`${name}--live.png`);
    await page.screenshot({ path, fullPage: true });
    await testInfo.attach(`live - ${name}`, { path, contentType: 'image/png' });
  }

  // ── M26 ────────────────────────────────────────────────────────────────

  test('M26 variant-images', async ({ openAs, ctx }) => {
    const { psA, psB } = ctx.setup.products;
    test.skip(!psA?.variants.A1, 'setup.products.psA missing');
    const page = await openAs('admin');
    const cost = new VariantCostPage(page);
    const a1 = psA!.variants.A1;
    await cost.goto(psA!.productId);
    await cost.open(a1.sku);
    await expectLive(page, 'variant-images', [
      'variant-table-section',
      `variant-row-${slugOf(a1.sku)}`,
      `variant-photo-strip-${slugOf(a1.sku)}`,
      'variant-photo-bench-preview',
    ]);
    if (psB?.variants.B1) {
      await cost.goto(psB.productId);
      await expect(cost.photoSource.first()).toBeVisible();
    }
    await shoot(page, 'm26-variant-images');
  });

  test('M26 cost-edit', async ({ openAs, ctx, http }) => {
    const a1 = ctx.setup.products.psA?.variants.A1;
    test.skip(!a1, 'setup.products.psA missing');
    await mustClearCost(http.admin, a1!.variantId);
    const page = await openAs('admin');
    const cost = new VariantCostPage(page);
    await cost.goto(ctx.setup.products.psA!.productId);
    await cost.open(a1!.sku);
    await cost.addButton(a1!.sku).click();
    await cost.input.fill('abc');
    await page.getByTestId('variant-cost-save').click();
    await expect(cost.error).toBeVisible();
    await expectLive(page, 'cost-edit', [
      `variant-cost-cell-${slugOf(a1!.sku)}`,
      `variant-cost-form-${slugOf(a1!.sku)}`,
      'variant-cost-input',
      'variant-cost-currency',
      'variant-cost-save',
      'variant-cost-cancel',
      'variant-cost-error',
    ]);
    await shoot(page, 'm26-cost-edit');
    await page.getByTestId('variant-cost-cancel').click();

    await mustSetCost(http.admin, a1!.variantId, '10.00', 'PLN');
    await cost.goto(ctx.setup.products.psA!.productId);
    await cost.open(a1!.sku);
    await expectLive(page, 'cost-edit (recorded)', [
      `variant-cost-value-${slugOf(a1!.sku)}`,
      `variant-cost-provenance-${slugOf(a1!.sku)}`,
      `variant-cost-edit-${slugOf(a1!.sku)}`,
      `variant-cost-clear-${slugOf(a1!.sku)}`,
    ]);
  });

  test('M26 margin', async ({ openAs, ctx }) => {
    const a1 = ctx.setup.products.psA?.variants.A1;
    test.skip(!a1 || !orderA1 || !orderA2, 'seed orders were not created');
    const page = await openAs('admin');
    const margin = new MarginPanelPage(page);
    await margin.goto(liveWindow());
    await expect(margin.panel).toBeVisible();
    await expectLive(page, 'margin', [
      'margin-panel',
      'margin-trend',
      'margin-by-channel-table',
      'margin-by-product-table',
      `margin-channel-row-${ctx.setup.connections.prestashop ?? ''}`,
      'margin-coverage-note',
      'margin-coverage-toggle',
      'margin-kpi-net-revenue',
      'margin-kpi-cost',
      'margin-kpi-margin',
      'margin-kpi-margin-pct',
      'analytics-date-from',
      'analytics-date-to',
      'analytics-apply',
      'analytics-vat-basis',
      'analytics-display-currency',
    ]);
    await margin.coverageToggle.click();
    await expect(margin.coverageDetails).toBeVisible();
    await expectLive(page, 'margin (details)', ['margin-coverage-details', 'margin-coverage-show-variants']);
    await shoot(page, 'm26-margin');
  });

  test('M26 missing-cost', async ({ openAs, ctx, http }) => {
    const range = ctx.setup.noCostRange;
    test.skip(
      !range,
      'needs a window with only sales of variants without a cost (setup.noCostRange); the stand carries costs',
    );
    const page = await openAs('admin');
    const margin = new MarginPanelPage(page);
    await margin.goto(range);
    await expect(margin.missingCostEmpty).toBeVisible();
    await expectLive(page, 'missing-cost', [
      'margin-panel',
      'margin-missing-cost-empty',
      'margin-missing-cost-list',
      'export-csv-margin-channel',
    ]);
    const summary = await http.admin.get('/products/cost-coverage/summary');
    test.info().annotations.push({ type: 'cost-summary', description: summary.text });
    await shoot(page, 'm26-missing-cost');
  });

  test('M26 export-preparing', async ({ openAs }) => {
    const page = await openAs('admin');
    const margin = new MarginPanelPage(page);
    // Hold the REAL margin CSV request so the in-flight state can be observed.
    await page.route('**/analytics/margin?*format=csv*', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      await route.continue();
    });
    await margin.goto(liveWindow());
    await expect(margin.panel).toBeVisible();
    const download = page.waitForEvent('download', { timeout: 60_000 });
    await margin.exportButton('margin-channel').click();
    await expect(margin.exportButton('margin-channel')).toHaveAttribute('aria-busy', 'true');
    await expect(margin.exportStatus).toContainText('Preparing');
    await shoot(page, 'm26-export-preparing');
    await download;
  });

  test('M26 export-ready', async ({ openAs }) => {
    const page = await openAs('admin');
    const margin = new MarginPanelPage(page);
    await margin.goto(liveWindow());
    await expect(margin.panel).toBeVisible();
    const download = await margin.download('margin-channel');
    expect(download.suggestedFilename()).toMatch(/^openlinker_margin-by-channel_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}_[A-Z]{3}_net\.csv$/);
    await expectLive(page, 'export-ready', ['export-status', 'export-dismiss', 'export-csv-sample']);
    await shoot(page, 'm26-export-ready');
  });

  test('M26 export-failed', async ({ openAs }) => {
    const page = await openAs('admin');
    const margin = new MarginPanelPage(page);
    await margin.goto({ from: '2025-01-01', to: '2026-06-01' });
    await margin.exportButton('margin-channel').click();
    await expect(margin.exportStatus).toBeVisible();
    await expectLive(page, 'export-failed', ['export-status', 'export-retry', 'export-change-range']);
    await shoot(page, 'm26-export-failed');
  });

  test('M26 viewer', async ({ openAs, ctx, http }) => {
    const a1 = ctx.setup.products.psA?.variants.A1;
    test.skip(!a1, 'setup.products.psA missing');
    await mustSetCost(http.admin, a1!.variantId, '10.00', 'PLN');
    const page = await openAs('viewer');
    const cost = new VariantCostPage(page);
    await cost.goto(ctx.setup.products.psA!.productId);
    await cost.open(a1!.sku);
    await expectLive(page, 'viewer', ['variant-cost-readonly-reason', `variant-cost-value-${slugOf(a1!.sku)}`]);
    await shoot(page, 'm26-viewer');
  });

  // ── M30 ────────────────────────────────────────────────────────────────

  test('M30 products-banner', async ({ openAs }) => {
    const page = await openAs('admin');
    await page.goto('/products');
    await expect(page.getByTestId('cost-coverage-banner')).toBeVisible();
    await expectLive(page, 'products-banner', [
      'cost-coverage-banner',
      'cost-coverage-meter',
      'cost-coverage-banner-open',
      'cost-coverage-banner-dismiss',
      'products-filter-no-cost',
      'products-open-cost-prices',
    ]);
    await shoot(page, 'm30-products-banner');
  });

  test('M30 worklist', async ({ openAs, ctx }) => {
    const a2 = ctx.setup.products.psA?.variants.A2;
    test.skip(!a2, 'setup.products.psA missing');
    const page = await openAs('admin');
    const list = new CostWorklistPage(page);
    await list.goto();
    await list.selectTab('all');
    await list.search.fill(a2!.sku);
    await expect(list.row(a2!.sku)).toBeVisible();
    await expectLive(page, 'worklist', [
      'cost-worklist-table',
      'cost-worklist-tab-sold',
      'cost-worklist-tab-all',
      'cost-worklist-tab-has-cost',
      'cost-worklist-search',
      'cost-worklist-channel',
      `cost-worklist-row-${slugOf(a2!.sku)}`,
      `cost-worklist-add-${slugOf(a2!.sku)}`,
      `cost-worklist-select-${slugOf(a2!.sku)}`,
    ]);
    await page.getByTestId(`cost-worklist-add-${slugOf(a2!.sku)}`).click();
    await expectLive(page, 'worklist (entry)', [
      `cost-worklist-input-${slugOf(a2!.sku)}`,
      `cost-worklist-currency-${slugOf(a2!.sku)}`,
      `cost-worklist-save-${slugOf(a2!.sku)}`,
    ]);
    await shoot(page, 'm30-worklist');
  });

  test('M30 bulk', async ({ openAs, ctx }) => {
    const { psA, psC } = ctx.setup.products;
    const a2 = psA?.variants.A2;
    const c1 = psC?.variants.C1;
    test.skip(!a2 || !c1, 'needs setup.products.psA.A2 and psC.C1 (both without a cost)');
    const page = await openAs('admin');
    const list = new CostWorklistPage(page);
    await list.goto();
    await list.selectTab('all');
    for (const v of [a2!, c1!]) {
      await list.search.fill(v.sku);
      await list.select(v.sku).check();
    }
    await expect(list.bulkBar).toBeVisible();
    await list.openBulk();
    await list.fillBulk('abc');
    await list.saveBulk();
    await expect(list.bulkError).toBeVisible();
    await expectLive(page, 'bulk', [
      'cost-worklist-bulk-bar',
      'cost-worklist-bulk-open',
      'cost-bulk-dialog',
      'cost-bulk-input',
      'cost-bulk-currency',
      'cost-bulk-preview',
      'cost-bulk-save',
      'cost-bulk-cancel',
      'cost-bulk-error',
    ]);
    await shoot(page, 'm30-bulk');
  });

  test('M30 analytics', async ({ openAs }) => {
    const page = await openAs('admin');
    const margin = new MarginPanelPage(page);
    await margin.goto(liveWindow());
    await expect(margin.costBanner).toBeVisible();
    await expectLive(page, 'analytics', [
      'cost-coverage-banner',
      'cost-coverage-banner-margin',
      'cost-coverage-banner-open',
      'cost-coverage-banner-dismiss',
      'cost-coverage-meter',
      'margin-kpi-margin-pct',
    ]);
    await shoot(page, 'm30-analytics');
  });

  test('M30 insights', async ({ openAs }) => {
    const page = await openAs('admin');
    await page.goto('/insights');
    await expect(page.getByTestId('insights-setup-gaps')).toBeVisible();
    await expectLive(page, 'insights', ['insights-setup-gaps', 'insights-gap-cost-price', 'insights-gap-cost-price-open']);
    await shoot(page, 'm30-insights');
  });

  test('M30 order-line', async ({ openAs }) => {
    test.skip(!orderA1 || !orderA2, 'seed orders were not created');
    const page = await openAs('admin');
    await page.goto(`/orders/${orderA2!}`);
    await expect(page.getByTestId('order-items-cost-table')).toBeVisible();
    await expectLive(page, 'order-line', [
      'order-items-cost-table',
      'order-line-no-cost',
      'order-line-add-cost',
      'order-line-cost-note',
    ]);
    await shoot(page, 'm30-order-line');
  });

  test('M30 done', async ({ openAs }) => {
    const page = await openAs('admin');
    // A stand with every variant costed cannot be assembled on a shared stack,
    // so the empty result is served for the read the list makes. The assertion
    // is on what the UI does with "nothing left", which is the state.
    await page.route('**/products/variants/cost-worklist/count*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ total: 0 }) }),
    );
    await page.route('**/products/variants/cost-worklist?*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ currency: 'PLN', items: [], total: 0 }),
      }),
    );
    await page.goto('/products/cost-prices');
    await expect(page.getByTestId('cost-worklist-done-empty')).toBeVisible();
    await expectLive(page, 'done', ['cost-worklist-done-empty']);
    await shoot(page, 'm30-done');
  });

  test('M30 viewer', async ({ openAs }) => {
    const page = await openAs('viewer');
    await page.goto('/products/cost-prices');
    await expect(page.getByTestId('cost-worklist-readonly')).toBeVisible();
    await expectLive(page, 'viewer', ['cost-worklist-readonly']);
    await shoot(page, 'm30-viewer');
  });

  test('M30 off', async ({ openAs }) => {
    const page = await openAs('admin');
    const margin = new MarginPanelPage(page);
    await margin.goto(liveWindow());
    await margin.settingsButton.click();
    await expectLive(page, 'off', [
      'settings-margin-tracking',
      'settings-margin-tracking-toggle',
      'settings-margin-tracking-save',
    ]);
    await shoot(page, 'm30-off');
  });
});

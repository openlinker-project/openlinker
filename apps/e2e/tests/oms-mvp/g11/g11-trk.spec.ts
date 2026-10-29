/**
 * G11 TRK - the `trackMargin` setting (G11-F; M30 `off`)
 *
 * Off hides the margin panel and every cost reminder; it does NOT stop the cost
 * snapshot being written at ingestion, so switching it back on finds the
 * history intact. The setting is deployment-wide, so every scenario puts it
 * back to what it found.
 *
 * @module tests/oms-mvp/g11
 */
import { test, expect } from '../../../src/fixtures/g11';
import { MarginPanelPage } from '../../../src/pages/margin-panel.page';
import { lineSnapshots, variantCostRow, type VariantCostRow } from '../../../src/support/g11/db';
import { clearCost, getMargin, mustSetCost, setCost } from '../../../src/support/g11/cost';
import type { G11Http } from '../../../src/support/g11/http';
import { createPrestashopOrder } from '../../../src/support/g11/orders';
import { liveWindow } from '../../../src/support/g11/ranges';

interface SettingsBody {
  displayCurrency: string;
  displayCurrencySource: string;
  rateBasis: string;
  includeBackfilledTaxRatesInNetSales: boolean;
  netGrossBasis: string;
  trackMargin: boolean;
}

async function readSettings(http: G11Http): Promise<SettingsBody> {
  const response = await http.get('/analytics/settings');
  expect(response.status).toBe(200);
  return response.json<SettingsBody>();
}

function putBody(current: SettingsBody, trackMargin?: boolean): Record<string, unknown> {
  return {
    displayCurrency: current.displayCurrencySource === 'setting' ? current.displayCurrency : null,
    rateBasis: current.rateBasis,
    includeBackfilledTaxRatesInNetSales: current.includeBackfilledTaxRatesInNetSales,
    netGrossBasis: current.netGrossBasis,
    ...(trackMargin === undefined ? {} : { trackMargin }),
  };
}

test.describe('G11 TRK - trackMargin @g11', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(900_000);

  let initial: SettingsBody | undefined;
  let a1Original: VariantCostRow | undefined;

  test.beforeAll(async ({ http, ctx }) => {
    initial = await readSettings(http.admin);
    const a1 = ctx.setup.products.psA?.variants.A1;
    if (a1) a1Original = variantCostRow(ctx.db, a1.variantId);
  });

  test.afterAll(async ({ http, ctx }) => {
    if (initial) await http.admin.put('/analytics/settings', putBody(initial, initial.trackMargin));
    const a1 = ctx.setup.products.psA?.variants.A1;
    if (a1) {
      if (a1Original?.netUnitCost && a1Original.costCurrency) await setCost(http.admin, a1.variantId, a1Original.netUnitCost, a1Original.costCurrency);
      else await clearCost(http.admin, a1.variantId);
    }
  });

  test('TRK-1 switching it off hides the panel, the banners, the link and the Insights gap', async ({ openAs, http }) => {
    const page = await openAs('admin');
    const panel = new MarginPanelPage(page);
    await panel.goto(liveWindow());
    await panel.settingsButton.click();
    const toggle = panel.trackMarginToggle;
    await expect(toggle).toBeVisible();
    if (!(await toggle.isChecked())) await toggle.check();
    const saved = page.waitForResponse((r) => r.url().includes('/analytics/settings') && r.request().method() === 'PUT');
    await toggle.uncheck();
    expect((await saved).status()).toBe(204);
    expect((await readSettings(http.admin)).trackMargin).toBe(false);
    const shot = test.info().outputPath('trk-1-settings.png');
    await page.screenshot({ path: shot, fullPage: true });
    await test.info().attach('TRK-1 settings (off)', { path: shot, contentType: 'image/png' });

    await panel.goto(liveWindow());
    await expect(panel.panel).toHaveCount(0);
    await expect(panel.costBanner).toHaveCount(0);

    await page.goto('/products');
    await expect(page.getByRole('heading', { name: 'Products', exact: true })).toBeVisible();
    await expect(page.getByTestId('cost-coverage-banner')).toHaveCount(0);
    await expect(page.getByTestId('products-open-cost-prices')).toHaveCount(0);
    await expect(page.getByTestId('products-filter-no-cost')).toHaveCount(0);

    await page.goto('/insights');
    await expect(page.getByTestId('insights-gap-cost-price')).toHaveCount(0);
  });

  test('TRK-2 while it is off, the snapshot is still written; switching on finds the history', async ({ ctx, http }) => {
    const product = ctx.setup.products.psA;
    const a1 = product?.variants.A1;
    test.skip(!product || !a1 || !ctx.setup.connections.prestashop, 'needs psA.A1 and a PrestaShop connection');
    const current = await readSettings(http.admin);
    expect((await http.admin.put('/analytics/settings', putBody(current, false))).status).toBe(204);
    await mustSetCost(http.admin, a1!.variantId, '10.00', 'PLN');
    const created = await createPrestashopOrder(ctx, product!.productId, a1!, 1);
    const line = lineSnapshots(ctx.db, created.order.internalOrderId).find((l) => l.variantId === a1!.variantId);
    expect(line?.costState, 'snapshot written while the setting is off').toBe('recorded');
    expect(Number(line?.unitCostNet)).toBe(10);

    expect((await http.admin.put('/analytics/settings', putBody(await readSettings(http.admin), true))).status).toBe(204);
    const margin = await getMargin(http.admin, liveWindow());
    expect(margin.headline.costOfGoods, 'margin counts the order placed while it was off').toBeGreaterThan(0);
  });

  test('TRK-3 an update without trackMargin keeps the stored value', async ({ http }) => {
    const current = await readSettings(http.admin);
    expect((await http.admin.put('/analytics/settings', putBody(current, false))).status).toBe(204);
    expect((await readSettings(http.admin)).trackMargin).toBe(false);
    expect((await http.admin.put('/analytics/settings', putBody(await readSettings(http.admin)))).status).toBe(204);
    expect((await readSettings(http.admin)).trackMargin, 'absent keeps false').toBe(false);
    expect((await http.admin.put('/analytics/settings', putBody(await readSettings(http.admin), true))).status).toBe(204);
    expect((await http.admin.put('/analytics/settings', putBody(await readSettings(http.admin)))).status).toBe(204);
    expect((await readSettings(http.admin)).trackMargin, 'absent keeps true').toBe(true);
    test.info().annotations.push({ type: 'default', description: 'the "true on a fresh install" default is asserted in MIG-3 against the column default' });
  });

  test('TRK-4 operator and viewer cannot change it: the API refuses and the control is disabled', async ({ openAs, http }) => {
    const current = await readSettings(http.admin);
    for (const role of ['operator', 'viewer'] as const) {
      expect((await http[role].put('/analytics/settings', putBody(current, !current.trackMargin))).status, role).toBe(403);
      const page = await openAs(role);
      const panel = new MarginPanelPage(page);
      await panel.goto(liveWindow());
      await panel.settingsButton.click();
      await expect(panel.trackMarginToggle, role).toBeDisabled();
    }
    expect((await readSettings(http.admin)).trackMargin).toBe(current.trackMargin);
  });
});

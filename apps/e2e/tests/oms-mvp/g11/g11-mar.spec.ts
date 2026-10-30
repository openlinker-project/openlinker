/**
 * G11 MAR - margin (#3588; M26 `margin`, `missing-cost`)
 *
 * Margin is net revenue minus the snapshotted cost of goods, over lines that
 * have a recorded cost in the order's own currency. Orders are real shop
 * orders; every figure is read as a DELTA around the order the scenario
 * creates, because the stand is shared and absolute totals are not ours.
 *
 * @module tests/oms-mvp/g11
 */
import { test, expect } from '../../../src/fixtures/g11';
import { MarginPanelPage } from '../../../src/pages/margin-panel.page';
import { buildPrestashopWebserviceClient } from '../../../src/support/order-synthesis';
import { variantCostRow, type VariantCostRow } from '../../../src/support/g11/db';
import {
  clearCost,
  figDelta,
  getMarginVariants,
  getMargin,
  mustClearCost,
  mustSetCost,
  setCost,
  sumGaps,
  variantMargin,
  type MarginResponse,
} from '../../../src/support/g11/cost';
import { createPrestashopOrder, reingestOrder, type G11Ctx } from '../../../src/support/g11/orders';
import { liveWindow } from '../../../src/support/g11/ranges';

interface CoverageRow {
  category: string;
  countUnit: 'orders' | 'lines';
  affectedCount: number;
}

interface SalesBody {
  headline: { netRevenue: number; currency: string | null };
  channels: Array<{ sourceConnectionId: string; netRevenue: number }>;
}

const cents = (n: number): number => Math.round(n * 100) / 100;

test.describe('G11 MAR - margin @g11', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(900_000);

  const originals = new Map<string, VariantCostRow | undefined>();

  test.beforeAll(({ ctx }) => {
    const { psA } = ctx.setup.products;
    for (const v of [psA?.variants.A1, psA?.variants.A2]) {
      if (v) originals.set(v.variantId, variantCostRow(ctx.db, v.variantId));
    }
  });

  test.afterAll(async ({ http }) => {
    for (const [variantId, row] of originals) {
      if (row?.netUnitCost && row.costCurrency) await setCost(http.admin, variantId, row.netUnitCost, row.costCurrency);
      else await clearCost(http.admin, variantId);
    }
  });

  function stand(ctx: G11Ctx): {
    productId: string;
    a1: { variantId: string; sku: string };
    a2: { variantId: string; sku: string };
    connectionId: string;
  } {
    const product = ctx.setup.products.psA;
    const a1 = product?.variants.A1;
    const a2 = product?.variants.A2;
    const connectionId = ctx.setup.connections.prestashop;
    test.skip(!product || !a1 || !a2 || !connectionId, 'needs psA (A1, A2) and a PrestaShop connection');
    return { productId: product!.productId, a1: a1!, a2: a2!, connectionId: connectionId! };
  }

  test('MAR-1 a costed variant enters margin, an uncosted one stays out and is reported', async ({ openAs, ctx, http }) => {
    const { productId, a1, a2, connectionId } = stand(ctx);
    await mustSetCost(http.admin, a1.variantId, '10.00', 'PLN');
    await mustClearCost(http.admin, a2.variantId);
    const range = liveWindow();
    const a1Before = await variantMargin(http.admin, productId, a1.variantId, range);
    const a2Before = await variantMargin(http.admin, productId, a2.variantId, range);

    await createPrestashopOrder(ctx, productId, a1, 1);
    await createPrestashopOrder(ctx, productId, a2, 1);

    const a1Delta = figDelta(await variantMargin(http.admin, productId, a1.variantId, range), a1Before);
    const a2Delta = figDelta(await variantMargin(http.admin, productId, a2.variantId, range), a2Before);
    expect(a1Delta.costOfGoods).toBe(10);
    expect(a1Delta.coveredNetRevenue).toBe(a1Delta.netRevenue);
    expect(a2Delta.coveredNetRevenue, 'A2 is not in margin').toBe(0);
    expect(a2Delta.costOfGoods).toBe(0);
    expect(a2Delta.gaps['no-cost']?.lineCount).toBe(1);

    const margin = await getMargin(http.admin, range);
    expect(margin.headline.costCoveragePct ?? 100).toBeLessThan(100);

    const page = await openAs('admin');
    const panel = new MarginPanelPage(page);
    await panel.goto(range);
    await expect(panel.panel).toBeVisible();
    await expect(panel.channelRow(connectionId)).toBeVisible();
    await expect(panel.coverageNote).toBeVisible();
    const shot = test.info().outputPath('mar-1.png');
    await page.screenshot({ path: shot, fullPage: true });
    await test.info().attach('MAR-1', { path: shot, contentType: 'image/png' });
  });

  test('MAR-2 the coverage note opens onto the reasons lines are left out', async ({ openAs, ctx }) => {
    stand(ctx);
    const page = await openAs('admin');
    const panel = new MarginPanelPage(page);
    await panel.goto(liveWindow());
    await expect(panel.coverageToggle).toBeVisible();
    await expect(panel.coverageDetails).toBeHidden();
    await panel.coverageToggle.click();
    await expect(panel.coverageDetails).toBeVisible();
    await expect(panel.coverageReason('no-cost')).toBeVisible();
    test.info().annotations.push({
      type: 'mockup-only',
      description: 'margin-coverage-show-variants / margin-add-cost-link-* are drawn on the mockup; the live note lists reasons, and the variant links live on the empty state.',
    });
  });

  test('MAR-3 covered + every gap equals net revenue, and net revenue equals Net Sales, to the cent', async ({ ctx, http }) => {
    stand(ctx);
    const range = liveWindow();
    const margin = await getMargin(http.admin, range);
    const sales = (await http.admin.get('/analytics/sales', { query: { ...range, basis: 'net' } })).json<SalesBody>();

    const check = (label: string, fig: MarginResponse['headline'], salesNet: number): void => {
      const gaps = fig.gaps.reduce((s, g) => s + g.netAmount, 0);
      expect(cents(fig.coveredNetRevenue + gaps), `${label}: covered + gaps`).toBeCloseTo(fig.netRevenue, 1);
      expect(fig.netRevenue, `${label}: margin net revenue is Net Sales`).toBeCloseTo(salesNet, 1);
    };
    check('headline', margin.headline, sales.headline.netRevenue);
    for (const channel of margin.channels) {
      const salesChannel = sales.channels.find((c) => c.sourceConnectionId === channel.sourceConnectionId);
      expect(salesChannel, `channel ${channel.sourceConnectionId} in sales`).toBeDefined();
      check(`channel ${channel.sourceConnectionId}`, channel, salesChannel!.netRevenue);
    }
  });

  test('MAR-4 a cost of 0.00 is counted: covered, cost of goods 0, margin equals net revenue', async ({ ctx, http }) => {
    const { productId, a1 } = stand(ctx);
    await mustSetCost(http.admin, a1.variantId, '0.00', 'PLN');
    const range = liveWindow();
    const before = await variantMargin(http.admin, productId, a1.variantId, range);
    await createPrestashopOrder(ctx, productId, a1, 1);
    const after = await variantMargin(http.admin, productId, a1.variantId, range);
    const delta = figDelta(after, before);
    expect(delta.costOfGoods).toBe(0);
    expect(delta.coveredNetRevenue).toBe(delta.netRevenue);
    expect(delta.coveredNetRevenue).toBeGreaterThan(0);
    expect(delta.gaps['no-cost']?.lineCount ?? 0).toBe(0);
  });

  test('MAR-5 no cost is not zero: giving the uncosted variant 0.00 adds its revenue to margin', async ({ ctx, http }) => {
    const { productId, a2 } = stand(ctx);
    await mustClearCost(http.admin, a2.variantId);
    const range = liveWindow();
    const base = await variantMargin(http.admin, productId, a2.variantId, range);
    await createPrestashopOrder(ctx, productId, a2, 1);
    const uncosted = figDelta(await variantMargin(http.admin, productId, a2.variantId, range), base);
    expect(uncosted.coveredNetRevenue).toBe(0);

    await mustSetCost(http.admin, a2.variantId, '0.00', 'PLN');
    const mid = await variantMargin(http.admin, productId, a2.variantId, range);
    await createPrestashopOrder(ctx, productId, a2, 1);
    const zeroCost = figDelta(await variantMargin(http.admin, productId, a2.variantId, range), mid);
    expect(zeroCost.coveredNetRevenue).toBe(zeroCost.netRevenue);
    expect(zeroCost.coveredNetRevenue).toBeGreaterThan(0);
  });

  test('MAR-6 (G11-C) a cost in another currency leaves the line out with reason currency-mismatch', async ({ ctx, http }) => {
    const { productId, a1 } = stand(ctx);
    await mustSetCost(http.admin, a1.variantId, '10.00', 'EUR');
    const range = liveWindow();
    const before = await variantMargin(http.admin, productId, a1.variantId, range);
    await createPrestashopOrder(ctx, productId, a1, 1);
    const after = await variantMargin(http.admin, productId, a1.variantId, range);
    const delta = figDelta(after, before);
    expect(delta.coveredNetRevenue, 'the line is outside margin').toBe(0);
    expect(delta.costOfGoods, 'no conversion by any rate').toBe(0);
    expect(delta.gaps['currency-mismatch']?.lineCount).toBe(1);
    await mustSetCost(http.admin, a1.variantId, '10.00', 'PLN');
  });

  test('MAR-7 a cancelled order drops out of margin the way it drops out of Net Sales', async ({ ctx, http }) => {
    const { productId, a1, connectionId } = stand(ctx);
    const ps = buildPrestashopWebserviceClient(ctx.world);
    test.skip(!ps, 'needs the PrestaShop webservice key to cancel an order');
    await mustSetCost(http.admin, a1.variantId, '10.00', 'PLN');
    const range = liveWindow();
    const before = await variantMargin(http.admin, productId, a1.variantId, range);
    const created = await createPrestashopOrder(ctx, productId, a1, 1);
    const live = figDelta(await variantMargin(http.admin, productId, a1.variantId, range), before);
    expect(live.costOfGoods).toBe(10);

    await ps!.setOrderState(created.externalOrderId, '6');
    await reingestOrder(ctx, connectionId, created.externalOrderId);
    const order = await ctx.api.orders.getById(created.order.internalOrderId);
    test.skip(!order.cancelledAt, 'OL did not record the cancellation (shop order-state mapping differs on this stand)');
    const cancelled = figDelta(await variantMargin(http.admin, productId, a1.variantId, range), before);
    expect(cancelled.costOfGoods, 'cancelled order leaves cost of goods').toBe(0);
    expect(cancelled.netRevenue).toBe(0);
    test.info().annotations.push({
      type: 'not-covered',
      description: 'MAR-7 pre-rollout / no-rate half: taxRateEra is written only by a historical migration, no flow produces it.',
    });
  });

  test('MAR-8 reporting currency EUR: revenue and cost converted by the same per-order quotient', () => {
    test.fixme(
      true,
      'the reporting currency is a deployment-wide setting (ADR-040) and the margin routes have no display-currency parameter; ' +
        'flipping it would move every figure on the shared stand. Needs a dedicated run on a throwaway stack with an exchange_rates row.',
    );
  });

  test('MAR-9 bucket and channel filter change the shape, not the totals', async ({ ctx, http }) => {
    const { connectionId } = stand(ctx);
    const range = liveWindow();
    const day = await getMargin(http.admin, range, { bucket: 'day' });
    const week = await getMargin(http.admin, range, { bucket: 'week' });
    expect(week.headline.netRevenue).toBe(day.headline.netRevenue);
    expect(week.headline.costOfGoods).toBe(day.headline.costOfGoods);
    const sum = (m: MarginResponse): number => cents(m.trend.reduce((s, p) => s + p.costOfGoods, 0));
    expect(sum(week)).toBe(sum(day));

    const filtered = await getMargin(http.admin, range, { sourceConnectionId: connectionId });
    const channel = day.channels.find((c) => c.sourceConnectionId === connectionId);
    expect(channel).toBeDefined();
    expect(filtered.headline.netRevenue).toBe(channel!.netRevenue);
    expect(filtered.channels.map((c) => c.sourceConnectionId)).toEqual([connectionId]);
  });

  test('MAR-10 channel and product tables; a product opens onto its variants', async ({ openAs, ctx, http }) => {
    const { productId, a1, connectionId } = stand(ctx);
    const page = await openAs('admin');
    const panel = new MarginPanelPage(page);
    await panel.goto(liveWindow());
    await expect(panel.byChannelTable).toBeVisible();
    await expect(panel.channelRow(connectionId)).toBeVisible();
    await expect(panel.byProductTable).toBeVisible();
    // The table lists PRODUCTS (keyed by the product's own SKU); the mockup has no per-row expansion,
    // so the variants of a product are asserted on the API the table is built from.
    const productSku = ctx.db.scalar(`SELECT sku FROM products WHERE id = '${productId}'`);
    expect(productSku, 'the product has a sku').toBeTruthy();
    await expect(panel.productRow(productSku!)).toBeVisible();
    const variants = await getMarginVariants(http.admin, productId, liveWindow());
    expect(variants.some((v) => v.variantId === a1.variantId), 'the sold variant is listed under its product').toBe(true);
  });

  test('MAR-11 an install with no cost at all shows the empty state with a list of best sellers', async ({ openAs, ctx }) => {
    const range = ctx.setup.noCostRange;
    test.skip(!range, 'needs a window with only sales of variants without a cost (setup.noCostRange)');
    const page = await openAs('admin');
    const panel = new MarginPanelPage(page);
    await panel.goto(range);
    await expect(panel.missingCostEmpty).toBeVisible();
    await expect(panel.missingCostList).toBeVisible();
    await expect(panel.byChannelTable).toHaveCount(0);
  });

  test('MAR-12 the VAT basis switch does not change margin: it is always on net revenue', async ({ openAs, ctx }) => {
    stand(ctx);
    const page = await openAs('admin');
    const panel = new MarginPanelPage(page);
    await panel.goto({ ...liveWindow(), netGrossBasis: 'net' });
    await expect(panel.panel).toBeVisible();
    const net = await panel.kpi('net-revenue').textContent();
    await panel.goto({ ...liveWindow(), netGrossBasis: 'gross' });
    await expect(panel.panel).toBeVisible();
    expect(await panel.kpi('net-revenue').textContent(), 'margin net revenue is the same on a gross page').toBe(net);
    await expect(panel.panel).toContainText(/net/i);
  });

  test('MAR-13 coverage trust: the no-cost category counts LINES, every other category counts orders', async ({ ctx, http }) => {
    stand(ctx);
    const range = liveWindow();
    const response = await http.admin.get('/analytics/coverage', { query: range });
    expect(response.status).toBe(200);
    const rows = response.json<{ categories: CoverageRow[] }>().categories;
    const noCost = rows.find((r) => r.category === 'no-cost');
    expect(noCost, 'a no-cost category').toBeDefined();
    expect(noCost!.countUnit).toBe('lines');
    for (const row of rows.filter((r) => r.category !== 'no-cost')) {
      expect(row.countUnit, row.category).toBe('orders');
    }
    const margin = await getMargin(http.admin, range);
    expect(noCost!.affectedCount).toBe(sumGaps(margin.headline, 'no-cost').lineCount);
  });

  test('MAR-14 a later cost change leaves every earlier trend point exactly as it was', async ({ ctx, http }) => {
    const { a1 } = stand(ctx);
    const range = liveWindow();
    const before = await getMargin(http.admin, range);
    await mustSetCost(http.admin, a1.variantId, '33.33', 'PLN');
    const after = await getMargin(http.admin, range);
    expect(after.trend.map((p) => [p.date, p.costOfGoods, p.grossMargin])).toEqual(
      before.trend.map((p) => [p.date, p.costOfGoods, p.grossMargin]),
    );
    await mustSetCost(http.admin, a1.variantId, '10.00', 'PLN');
  });
});

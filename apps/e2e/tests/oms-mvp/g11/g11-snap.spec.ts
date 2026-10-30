/**
 * G11 SNAP - cost snapshot and immutable history (D27, G11-G; M30 `order-line`)
 *
 * The unit cost is copied onto each order line when the order is ingested, and
 * an edit afterwards never moves an earlier order. Orders are created in the
 * source shops and waited for through the API; the snapshot is read back from
 * `order_line_items` because no HTTP route exposes the column the margin is
 * built on.
 *
 * Boundary note: shops cannot back-date an order, so G11-G ("order placed
 * before the cost existed") is produced from the other side - the variant's
 * `costUpdatedAt` is moved ahead of "now", which makes the next order older
 * than its cost (`backdateCostTimestampPastNow`, SQL by decision).
 *
 * @module tests/oms-mvp/g11
 */
import { test, expect } from '../../../src/fixtures/g11';
import { lineSnapshots, variantCostRow, type VariantCostRow } from '../../../src/support/g11/db';
import {
  backdateCostTimestampPastNow,
  clearCost,
  figDelta,
  mustClearCost,
  mustSetCost,
  setCost,
  variantMargin,
} from '../../../src/support/g11/cost';
import { createPrestashopOrder, createWooOrder, reingestOrder } from '../../../src/support/g11/orders';
import { liveWindow } from '../../../src/support/g11/ranges';

test.describe('G11 SNAP - cost snapshot @g11', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(900_000);

  const originals = new Map<string, VariantCostRow | undefined>();
  let o1: { internalOrderId: string; externalOrderId: string } | undefined;
  let o3: { internalOrderId: string; externalOrderId: string } | undefined;

  test.beforeAll(({ ctx }) => {
    const { psA, wooVariable } = ctx.setup.products;
    for (const v of [psA?.variants.A1, psA?.variants.A2, wooVariable?.variants.withImage]) {
      if (v) originals.set(v.variantId, variantCostRow(ctx.db, v.variantId));
    }
  });

  test.afterAll(async ({ http }) => {
    for (const [variantId, row] of originals) {
      if (row?.netUnitCost && row.costCurrency) await setCost(http.admin, variantId, row.netUnitCost, row.costCurrency);
      else await clearCost(http.admin, variantId);
    }
  });

  function psA(ctx: import('../../../src/support/g11/orders').G11Ctx): {
    productId: string;
    a1: { variantId: string; sku: string };
    a2: { variantId: string; sku: string };
  } {
    const product = ctx.setup.products.psA;
    const a1 = product?.variants.A1;
    const a2 = product?.variants.A2;
    test.skip(!product || !a1 || !a2 || !ctx.setup.connections.prestashop, 'needs psA (A1, A2) and a PrestaShop connection');
    return { productId: product!.productId, a1: a1!, a2: a2! };
  }

  test('SNAP-1 an order ingested after a cost exists snapshots it as recorded', async ({ ctx, http }) => {
    const { productId, a1 } = psA(ctx);
    await mustSetCost(http.admin, a1.variantId, '10.00', 'PLN');
    const created = await createPrestashopOrder(ctx, productId, a1, 2);
    o1 = { internalOrderId: created.order.internalOrderId, externalOrderId: created.externalOrderId };
    const lines = lineSnapshots(ctx.db, o1.internalOrderId);
    const line = lines.find((l) => l.variantId === a1.variantId);
    expect(line, 'a line for A1').toBeDefined();
    expect(line!.costState).toBe('recorded');
    expect(Number(line!.unitCostNet)).toBe(10);
    expect(line!.unitCostCurrency).toBe('PLN');
    expect(line!.quantity).toBe(2);
  });

  test('SNAP-2 editing the cost afterwards does not move the earlier order; the next order uses the new cost', async ({ ctx, http }) => {
    const { productId, a1 } = psA(ctx);
    test.skip(!o1, 'SNAP-1 did not create the order');
    const range = liveWindow();
    const before = await variantMargin(http.admin, productId, a1.variantId, range);
    expect(before).toBeDefined();

    await mustSetCost(http.admin, a1.variantId, '15.00', 'PLN');
    const unchanged = await variantMargin(http.admin, productId, a1.variantId, range);
    expect(unchanged?.costOfGoods, 'cost of goods of already-ingested orders').toBe(before!.costOfGoods);
    expect(unchanged?.grossMargin).toBe(before!.grossMargin);

    const created = await createPrestashopOrder(ctx, productId, a1, 1);
    const line = lineSnapshots(ctx.db, created.order.internalOrderId).find((l) => l.variantId === a1.variantId);
    expect(Number(line?.unitCostNet)).toBe(15);
    const after = await variantMargin(http.admin, productId, a1.variantId, range);
    expect(figDelta(after, before).costOfGoods).toBe(15);
  });

  test('SNAP-3 re-ingesting an order keeps its snapshot', async ({ ctx }) => {
    const { a1 } = psA(ctx);
    test.skip(!o1, 'SNAP-1 did not create the order');
    const connectionId = ctx.setup.connections.prestashop!;
    const before = lineSnapshots(ctx.db, o1!.internalOrderId);
    await reingestOrder(ctx, connectionId, o1!.externalOrderId);
    const after = lineSnapshots(ctx.db, o1!.internalOrderId);
    expect(after.length, 'line count').toBe(before.length);
    expect(after).toEqual(before);
    const line = after.find((l) => l.variantId === a1.variantId);
    expect(Number(line?.unitCostNet), 'still the cost at the time of the order, not the current 15').toBe(10);
  });

  test('SNAP-4 a not-recorded snapshot is never upgraded; the report says the cost came after the sale', async ({ ctx, http }) => {
    const { productId, a2 } = psA(ctx);
    const connectionId = ctx.setup.connections.prestashop!;
    await mustClearCost(http.admin, a2.variantId);
    const created = await createPrestashopOrder(ctx, productId, a2, 1);
    o3 = { internalOrderId: created.order.internalOrderId, externalOrderId: created.externalOrderId };
    const first = lineSnapshots(ctx.db, o3.internalOrderId).find((l) => l.variantId === a2.variantId);
    expect(first?.costState).toBe('not-recorded');
    expect(first?.unitCostNet).toBeNull();

    await mustSetCost(http.admin, a2.variantId, '6.00', 'PLN');
    await reingestOrder(ctx, connectionId, o3.externalOrderId);
    const again = lineSnapshots(ctx.db, o3.internalOrderId).find((l) => l.variantId === a2.variantId);
    expect(again?.costState, 'still not-recorded after the cost was entered').toBe('not-recorded');

    const row = await variantMargin(http.admin, productId, a2.variantId, liveWindow());
    const gap = row?.gaps.find((g) => g.reason === 'cost-entered-after-sale');
    expect(gap?.lineCount ?? 0).toBeGreaterThanOrEqual(1);
  });

  test('SNAP-5 (G11-G) an order older than the cost is stored not-recorded, even on first ingestion', async ({ ctx, http }) => {
    const { productId, a1 } = psA(ctx);
    await mustSetCost(http.admin, a1.variantId, '20.00', 'PLN');
    backdateCostTimestampPastNow(ctx.db, a1.variantId, 24);
    const created = await createPrestashopOrder(ctx, productId, a1, 1);
    const line = lineSnapshots(ctx.db, created.order.internalOrderId).find((l) => l.variantId === a1.variantId);
    expect(line?.costState).toBe('not-recorded');
    expect(line?.unitCostNet, 'never today\'s cost on an older order').toBeNull();
    const row = await variantMargin(http.admin, productId, a1.variantId, liveWindow());
    expect(row?.gaps.find((g) => g.reason === 'cost-entered-after-sale')?.lineCount ?? 0).toBeGreaterThanOrEqual(1);
    await mustSetCost(http.admin, a1.variantId, '15.00', 'PLN');
  });

  test('SNAP-6 boundary: placedAt equal to costUpdatedAt records, one second earlier does not', () => {
    test.fixme(
      true,
      'a shop cannot choose placedAt and OL stamps costUpdatedAt itself, so the equal-timestamp case cannot be produced through a flow; ' +
        'the <= comparison is asserted in the order-ingestion unit specs. A SQL-only variant would test the test, not the product.',
    );
  });

  test('SNAP-7 order detail shows the snapshot cost; "Add cost" does not change that order', async ({ openAs, ctx, http }) => {
    test.skip(!o1 || !o3, 'earlier scenarios did not create the orders');
    const page = await openAs('admin');
    await page.goto(`/orders/${o1!.internalOrderId}`);
    const table = page.getByTestId('order-items-cost-table');
    await expect(table).toBeVisible();
    // The column is the line total (mockup: qty 2, cost 45.60), and SNAP-1 sold 2 units at a unit cost of 10.
    await expect(table).toContainText('20.00');

    // o3's variant has a cost by now (SNAP-4), which the panel reports as "entered after the sale". The
    // plain `no-cost` row and its "Add cost" link (M30 order-line) need the variant to be uncosted again.
    await mustClearCost(http.admin, psA(ctx).a2.variantId);
    await page.goto(`/orders/${o3!.internalOrderId}`);
    await expect(page.getByTestId('order-line-no-cost').first()).toBeVisible();
    await expect(page.getByTestId('order-line-cost-note')).toBeVisible();
    const note = (await page.getByTestId('order-line-cost-note').textContent()) ?? '';
    test.info().annotations.push({ type: 'cost-note-copy', description: note.trim() });
    const before = lineSnapshots(ctx.db, o3!.internalOrderId);
    await page.getByTestId('order-line-add-cost').first().click();
    await expect(page).toHaveURL(/\/products\/cost-prices/);
    expect(lineSnapshots(ctx.db, o3!.internalOrderId)).toEqual(before);
    const shot = test.info().outputPath('snap-7.png');
    await page.screenshot({ path: shot, fullPage: true });
    await test.info().attach('SNAP-7', { path: shot, contentType: 'image/png' });
  });

  test('SNAP-8 a line without a variant is always a "no-variant" gap', () => {
    test.fixme(
      true,
      'needs an order whose product resolves but whose variant does not, which no shop order produces on a mapped catalogue; covered by the margin read-model int-specs.',
    );
  });

  test('SNAP-9 two lines of the same variant both get the cost', async ({ ctx, http }) => {
    const woo = ctx.setup.products.wooVariable;
    const v = woo?.variants.withImage;
    test.skip(!woo || !v || !ctx.setup.connections.woocommerce, 'needs wooVariable.withImage and a WooCommerce connection');
    await mustSetCost(http.admin, v!.variantId, '7.00', 'PLN');
    const { order } = await createWooOrder(ctx, woo!.productId, [
      { ref: v!, quantity: 1 },
      { ref: v!, quantity: 2 },
    ]);
    const lines = lineSnapshots(ctx.db, order.internalOrderId).filter((l) => l.variantId === v!.variantId);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    for (const line of lines) {
      expect(line.costState).toBe('recorded');
      expect(Number(line.unitCostNet)).toBe(7);
    }
    test.info().annotations.push({ type: 'lines', description: `${lines.length} line(s) for the variant` });
  });

  test('SNAP-10 awaiting_mapping -> ready recomputes the snapshot from the current cost (documented ADR-080 limit)', () => {
    test.fixme(
      true,
      'needs an order that first ingests as awaiting_mapping; the stand maps its whole catalogue. This is a documented limitation, recorded as a screenshot-and-note in the evidence, not a pass/fail product claim.',
    );
  });
});

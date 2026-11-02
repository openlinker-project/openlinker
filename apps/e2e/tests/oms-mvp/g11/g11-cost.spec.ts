/**
 * G11 COST - variant cost price (#3588; M26 `cost-edit`, `viewer`)
 *
 * Entering, editing and clearing a net unit cost through the product page and
 * the API, what the API refuses, and the guarantee that a catalogue sync never
 * touches it. Every variant a scenario writes is returned to its starting cost
 * afterwards (the timestamp cannot be restored; the amount and currency are).
 *
 * @module tests/oms-mvp/g11
 */
import { test, expect } from '../../../src/fixtures/g11';
import { VariantCostPage } from '../../../src/pages/variant-cost.page';
import { variantCostRow, type VariantCostRow } from '../../../src/support/g11/db';
import {
  bulkFill,
  clearCost,
  mustClearCost,
  mustSetCost,
  setCost,
  type BulkFillBody,
  type VariantCostBody,
} from '../../../src/support/g11/cost';

test.describe('G11 COST - variant cost price @g11', () => {
  test.describe.configure({ mode: 'serial' });

  const original = new Map<string, VariantCostRow | undefined>();

  test.beforeAll(({ ctx }) => {
    const { psA, psB, psC } = ctx.setup.products;
    for (const v of [psA?.variants.A1, psA?.variants.A2, psB?.variants.B1, psC?.variants.C1]) {
      if (v) original.set(v.variantId, variantCostRow(ctx.db, v.variantId));
    }
  });

  test.afterAll(async ({ http }) => {
    for (const [variantId, row] of original) {
      if (row?.netUnitCost && row.costCurrency) await setCostSilently(http.admin, variantId, row.netUnitCost, row.costCurrency);
      else await clearCost(http.admin, variantId);
    }
  });

  async function setCostSilently(
    client: import('../../../src/support/g11/http').G11Http,
    variantId: string,
    amount: string,
    currency: string,
  ): Promise<void> {
    await setCost(client, variantId, amount, currency);
  }

  test('COST-1 admin adds a cost through the UI; the API and the database agree', async ({ openAs, ctx, http }) => {
    const psA = ctx.setup.products.psA;
    const a1 = psA?.variants.A1;
    test.skip(!a1, 'setup.products.psA.A1 missing');
    await mustClearCost(http.admin, a1!.variantId);
    const page = await openAs('admin');
    const cost = new VariantCostPage(page);
    await cost.goto(psA!.productId);
    await cost.open(a1!.sku);
    const patch = page.waitForResponse((r) => r.url().includes('/cost') && r.request().method() === 'PATCH');
    await cost.addButton(a1!.sku).click();
    await cost.submit('12.50', 'PLN');
    expect((await patch).status()).toBe(200);
    await expect(cost.value(a1!.sku)).toContainText('12.50');
    await expect(cost.value(a1!.sku)).toContainText('PLN');
    await expect(cost.provenance(a1!.sku)).toBeVisible();
    await expect(cost.costCell(a1!.sku)).toContainText('12.50');

    const row = variantCostRow(ctx.db, a1!.variantId);
    expect(row?.netUnitCost).toBe('12.5000');
    expect(row?.costCurrency).toBe('PLN');
    expect(row?.costUpdatedAt).not.toBeNull();
    expect(row?.costUpdatedByUserId).not.toBeNull();
    const shot = test.info().outputPath('cost-1.png');
    await page.screenshot({ path: shot, fullPage: true });
    await test.info().attach('COST-1', { path: shot, contentType: 'image/png' });
  });

  test('COST-2 edit changes the value, clear returns it to "not recorded" (NULL, not 0)', async ({ openAs, ctx, http }) => {
    const psA = ctx.setup.products.psA;
    const a1 = psA?.variants.A1;
    test.skip(!a1, 'setup.products.psA.A1 missing');
    await mustSetCost(http.admin, a1!.variantId, '12.50', 'PLN');
    const page = await openAs('admin');
    const cost = new VariantCostPage(page);
    await cost.goto(psA!.productId);
    await cost.open(a1!.sku);
    await cost.editButton(a1!.sku).click();
    await cost.submit('15.75');
    await expect(cost.value(a1!.sku)).toContainText('15.75');
    expect(variantCostRow(ctx.db, a1!.variantId)?.netUnitCost).toBe('15.7500');

    await cost.clearButton(a1!.sku).click();
    await expect(cost.addButton(a1!.sku)).toBeVisible();
    const row = variantCostRow(ctx.db, a1!.variantId);
    expect(row?.netUnitCost).toBeNull();
    expect(row?.costCurrency).toBeNull();
  });

  test('COST-3 a cost of 0.00 is a recorded cost, not "not recorded"', async ({ openAs, ctx, http }) => {
    const psA = ctx.setup.products.psA;
    const a1 = psA?.variants.A1;
    test.skip(!a1, 'setup.products.psA.A1 missing');
    await mustClearCost(http.admin, a1!.variantId);
    const page = await openAs('admin');
    const cost = new VariantCostPage(page);
    await cost.goto(psA!.productId);
    await cost.addCost(a1!.sku, '0.00', 'PLN');
    await expect(cost.value(a1!.sku)).toContainText('0.00');
    await expect(cost.addButton(a1!.sku)).toHaveCount(0);
    const row = variantCostRow(ctx.db, a1!.variantId);
    expect(row?.netUnitCost).toBe('0.0000');
    expect(row?.costCurrency).toBe('PLN');
    const api = await http.admin.get(`/products/${psA!.productId}/variant-costs`);
    const body = api.json<Array<VariantCostBody & { sku: string }>>().find((v) => v.variantId === a1!.variantId);
    expect(Number(body?.netUnitCost)).toBe(0);
    expect(body?.netUnitCost).not.toBeNull();
  });

  test('COST-4 invalid input: the form shows an error, the API answers 400, nothing is saved', async ({ openAs, ctx, http }) => {
    const psA = ctx.setup.products.psA;
    const a1 = psA?.variants.A1;
    test.skip(!a1, 'setup.products.psA.A1 missing');
    await mustSetCost(http.admin, a1!.variantId, '9.00', 'PLN');
    const before = variantCostRow(ctx.db, a1!.variantId);

    const page = await openAs('admin');
    const cost = new VariantCostPage(page);
    await cost.goto(psA!.productId);
    await cost.open(a1!.sku);
    for (const bad of ['-1', 'abc', '1.23456']) {
      await cost.editButton(a1!.sku).click();
      await cost.submit(bad);
      await expect(cost.error, `"${bad}" is rejected in the form`).toBeVisible();
      await page.getByTestId('variant-cost-cancel').click();
    }

    const cases: Array<[string, unknown]> = [
      ['negative', { netUnitCost: '-1', currency: 'PLN' }],
      ['text', { netUnitCost: 'abc', currency: 'PLN' }],
      ['five decimals', { netUnitCost: '1.23456', currency: 'PLN' }],
      ['lower-case currency', { netUnitCost: '1.00', currency: 'pl' }],
      ['amount without currency', { netUnitCost: '1.00', currency: null }],
      ['currency without amount', { netUnitCost: null, currency: 'PLN' }],
    ];
    for (const [label, body] of cases) {
      const response = await http.admin.patch(`/products/variants/${a1!.variantId}/cost`, body);
      expect(response.status, label).toBe(400);
    }
    expect(variantCostRow(ctx.db, a1!.variantId)?.netUnitCost).toBe(before?.netUnitCost);
  });

  test('COST-5 an unknown variant answers 404', async ({ http }) => {
    const response = await setCost(http.admin, 'ol_variant_doesnotexist', '1.00', 'PLN');
    expect(response.status).toBe(404);
  });

  test('COST-6 a catalogue sync never overwrites or clears a cost', async ({ ctx, http }) => {
    const psA = ctx.setup.products.psA;
    const a1 = psA?.variants.A1;
    const connectionId = ctx.setup.connections.prestashop;
    test.skip(!a1 || !connectionId, 'needs psA.A1 and setup.connections.prestashop');
    await mustSetCost(http.admin, a1!.variantId, '11.11', 'PLN');
    const before = variantCostRow(ctx.db, a1!.variantId);

    const product = await ctx.api.products.getById(psA!.productId);
    const externalId = product.externalIds?.find((e) => e.connectionId === connectionId)?.externalId;
    test.skip(!externalId, 'psA has no PrestaShop id mapped');
    await ctx.jobs.triggerAndWait(
      {
        connectionId: connectionId!,
        jobType: 'master.product.syncByExternalId',
        payload: { schemaVersion: 1, externalId: externalId!, objectType: 'Product' },
      },
      { timeoutMs: 180_000 },
    );
    const after = variantCostRow(ctx.db, a1!.variantId);
    expect(after).toEqual(before);
    test.info().annotations.push({
      type: 'not-covered',
      description:
        'COST-6 stale-variant half (delete the product in PrestaShop, then sync) is destructive and not run here; the live half above proves a sync leaves cost untouched.',
    });
  });

  test('COST-7 the cost currency defaults to the product currency and can be changed', async ({ openAs, ctx, http }) => {
    const psA = ctx.setup.products.psA;
    const a2 = psA?.variants.A2;
    test.skip(!a2, 'setup.products.psA.A2 missing');
    await mustClearCost(http.admin, a2!.variantId);
    const product = await ctx.api.products.getById(psA!.productId);
    const page = await openAs('admin');
    const cost = new VariantCostPage(page);
    await cost.goto(psA!.productId);
    await cost.open(a2!.sku);
    await cost.addButton(a2!.sku).click();
    await expect(cost.currency).toHaveValue(product.currency ?? 'PLN');
    const options = await cost.currency.locator('option').allTextContents();
    expect(options.length).toBeGreaterThan(1);
    const other = options.find((o) => o !== (product.currency ?? 'PLN'));
    await cost.submit('5.00', other);
    await expect(cost.value(a2!.sku)).toContainText(other ?? '');
    expect(variantCostRow(ctx.db, a2!.variantId)?.costCurrency).toBe(other);
  });

  test('COST-8 a simple product (synthetic variant) takes a cost too', async ({ ctx, http }) => {
    const psC = ctx.setup.products.psC;
    const c1 = psC?.variants.C1;
    test.skip(!c1, 'setup.products.psC.C1 missing');
    const response = await setCost(http.admin, c1!.variantId, '3.30', 'PLN');
    expect(response.status).toBe(200);
    expect(variantCostRow(ctx.db, c1!.variantId)?.netUnitCost).toBe('3.3000');
    await mustClearCost(http.admin, c1!.variantId);
  });

  test('COST-9 admin, operator and viewer read the costs; the packer is refused', async ({ ctx, http }) => {
    const psA = ctx.setup.products.psA;
    const a1 = psA?.variants.A1;
    test.skip(!a1, 'setup.products.psA.A1 missing');
    await mustSetCost(http.admin, a1!.variantId, '8.00', 'PLN');
    for (const role of ['admin', 'operator', 'viewer'] as const) {
      const response = await http[role].get(`/products/${psA!.productId}/variant-costs`);
      expect(response.status, role).toBe(200);
      const mine = response.json<Array<VariantCostBody & { sku: string }>>().find((v) => v.variantId === a1!.variantId);
      expect(mine?.netUnitCost, role).toBe('8.0000');
    }
    expect((await http.packer.get(`/products/${psA!.productId}/variant-costs`)).status).toBe(403);
  });

  test('COST-10 bulk fill fills only variants without a cost, never overwrites', async ({ ctx, http }) => {
    const { psA, psC } = ctx.setup.products;
    const a1 = psA?.variants.A1;
    const a2 = psA?.variants.A2;
    const c1 = psC?.variants.C1;
    test.skip(!a1 || !a2 || !c1, 'needs psA.A1, psA.A2 and psC.C1');
    await mustSetCost(http.admin, a1!.variantId, '4.00', 'PLN');
    await mustClearCost(http.admin, a2!.variantId);
    await mustClearCost(http.admin, c1!.variantId);

    const response = await bulkFill(http.admin, [a1!.variantId, a2!.variantId, c1!.variantId, 'ol_variant_doesnotexist'], '2.50', 'PLN');
    expect(response.status).toBe(200);
    const body = response.json<BulkFillBody>();
    expect([...body.filled].sort()).toEqual([a2!.variantId, c1!.variantId].sort());
    expect(body.skippedAlreadySet).toEqual([a1!.variantId]);
    expect(body.notFound).toEqual(['ol_variant_doesnotexist']);
    expect(variantCostRow(ctx.db, a1!.variantId)?.netUnitCost, 'existing cost untouched').toBe('4.0000');
    expect(variantCostRow(ctx.db, a2!.variantId)?.netUnitCost).toBe('2.5000');
    await mustClearCost(http.admin, c1!.variantId);
  });
});

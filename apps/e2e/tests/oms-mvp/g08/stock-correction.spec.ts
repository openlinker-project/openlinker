/**
 * G08 manual stock correction
 *
 * An operator corrects a variant's stock from the product page; the change is
 * written to the product master that owns it and recorded in the movement
 * ledger with the real before and after. Refusals decided before the master is
 * reached (not enough stock, a large change nobody confirmed, a reused
 * idempotency key) are 409s that change nothing.
 *
 * MUTATING, against a real PrestaShop master. The specs run serially, every
 * request uses a fresh idempotency key, and `afterEach` puts every variant of
 * the fixture product back to the count it had on entry, so a failed assertion
 * does not leave the shop with altered stock. `retries: 0` on the project keeps
 * a silent retry from correcting twice.
 *
 * @module tests/oms-mvp/g08
 */
import type { ApiClient } from '../../../src/api/api-client';
import { test, expect } from '../../../src/fixtures/test';
import { ProductStockPage } from '../../../src/pages/product-stock.page';
import {
  COMFORTABLE_STOCK,
  findStockFixture,
  freshIdempotencyKey,
  restoreStock,
  SKIP_NO_FIXTURE,
  stockiest,
  type StockFixture,
  type StockFixtureVariant,
} from '../../../src/support/g08-stock-fixture';

/** Past the large-change confirmation threshold (more than 50 units). */
const LARGE_INCREASE = 60;

test.describe.configure({ mode: 'serial' });

test.describe('G08 manual stock correction', () => {
  let fixture: StockFixture | null = null;

  test.beforeAll(async ({ api }) => {
    fixture = await findStockFixture(api);
  });

  test.beforeEach(() => {
    test.skip(fixture === null, SKIP_NO_FIXTURE);
  });

  test.afterEach(async ({ api }) => {
    if (fixture) await restoreStock(api, fixture);
  });

  /**
   * Put a variant at a comfortable count through the API, so a small UI change stays under the
   * large-change rule whatever the stack held. `afterEach` restores the original.
   */
  async function seedBaseline(api: ApiClient, variant: StockFixtureVariant): Promise<number> {
    const outcome = await api.inventory.correct(variant.id, {
      mode: 'set',
      quantity: COMFORTABLE_STOCK * 2,
      operatorReason: 'count_correction',
      note: 'G08 e2e baseline',
      idempotencyKey: freshIdempotencyKey(),
      confirmLargeChange: true,
    });
    expect(outcome.kind === 'result' || (outcome.kind === 'conflict' && outcome.conflict.code === 'no-change')).toBe(true);
    return COMFORTABLE_STOCK * 2;
  }

  /** The variant with the most stock, so small corrections stay under the large-change rule. */
  function firstVariant(): StockFixtureVariant {
    return stockiest(fixture!);
  }

  test('sets a new quantity from the dialog and records the real before and after', async ({
    page,
    api,
  }) => {
    const variant = firstVariant();
    const base = await seedBaseline(api, variant);
    const wanted = base + 3;
    const stock = new ProductStockPage(page);
    await stock.goto(fixture!.productId);

    const dialog = await stock.openCorrectionDialog(variant.key);
    await dialog.setQuantity(wanted);
    await expect(dialog.diff).toContainText(`${base} → ${wanted}`);
    await expect(dialog.largeChange).toHaveCount(0);
    await dialog.submit.click();

    await expect(dialog.applied).toBeVisible();
    await expect(page.getByTestId('stock-correction-confirmed')).toBeVisible();
    await dialog.done();

    const target = await api.inventory.correctionTarget(variant.id);
    expect(target.currentQuantity).toBe(wanted);

    const history = await api.inventory.movements({
      productVariantId: variant.id,
      kind: 'movements',
      limit: 5,
    });
    const movement = history.items.find(
      (m) => m.reason === 'manual_correction' && m.quantityAfter === wanted,
    );
    expect(movement).toBeDefined();
    expect(movement).toMatchObject({
      status: 'applied',
      quantityBefore: base,
      sourceKind: 'operator',
    });
  });

  test('removes stock in delta mode', async ({ page, api }) => {
    const variant = firstVariant();
    const base = await seedBaseline(api, variant);
    const stock = new ProductStockPage(page);
    await stock.goto(fixture!.productId);

    const dialog = await stock.openCorrectionDialog(variant.key);
    await dialog.setDelta(-1);
    await expect(dialog.diff).toContainText(`${base} → ${base - 1}`);
    await dialog.submit.click();

    await expect(dialog.applied).toBeVisible();
    await dialog.done();

    const target = await api.inventory.correctionTarget(variant.id);
    expect(target.currentQuantity).toBe(base - 1);
  });

  test('asks for confirmation before a large change and applies it once confirmed', async ({
    page,
    api,
  }) => {
    const variant = firstVariant();
    const wanted = variant.quantity + LARGE_INCREASE;
    const stock = new ProductStockPage(page);
    await stock.goto(fixture!.productId);

    const dialog = await stock.openCorrectionDialog(variant.key);
    await dialog.setQuantity(wanted);
    await expect(dialog.largeChange).toBeVisible();
    await expect(dialog.submit).toBeDisabled();

    await dialog.acknowledgeLargeChange();
    await expect(dialog.submit).toBeEnabled();
    await dialog.submit.click();

    await expect(dialog.applied).toBeVisible();
    await dialog.done();
    expect((await api.inventory.correctionTarget(variant.id)).currentQuantity).toBe(wanted);
  });

  test('refuses a removal larger than the master holds and changes nothing', async ({ api }) => {
    const variant = firstVariant();
    const before = await api.inventory.movements({ productVariantId: variant.id, limit: 1 });

    const outcome = await api.inventory.correct(variant.id, {
      mode: 'delta',
      quantity: -(variant.quantity + 5),
      operatorReason: 'damaged',
      idempotencyKey: freshIdempotencyKey(),
      // Confirmed on purpose: a big removal must reach the stock check, not stop at the
      // large-change confirmation that would otherwise answer first.
      confirmLargeChange: true,
    });

    expect(outcome.kind).toBe('conflict');
    if (outcome.kind !== 'conflict') return;
    expect(outcome.conflict.code).toBe('insufficient-stock');
    expect(outcome.conflict.currentQuantity).toBe(variant.quantity);

    expect((await api.inventory.correctionTarget(variant.id)).currentQuantity).toBe(
      variant.quantity,
    );
    const after = await api.inventory.movements({ productVariantId: variant.id, limit: 1 });
    expect(after.total).toBe(before.total);
  });

  test('asks for confirmation over the API too, and changes nothing without it', async ({
    api,
  }) => {
    const variant = firstVariant();

    const outcome = await api.inventory.correct(variant.id, {
      mode: 'delta',
      quantity: LARGE_INCREASE,
      operatorReason: 'found',
      idempotencyKey: freshIdempotencyKey(),
    });

    expect(outcome.kind).toBe('conflict');
    if (outcome.kind !== 'conflict') return;
    expect(outcome.conflict.code).toBe('confirmation-required');
    expect(typeof outcome.conflict.absoluteThresholdUnits).toBe('number');
    expect((await api.inventory.correctionTarget(variant.id)).currentQuantity).toBe(
      variant.quantity,
    );
  });

  test('replays the first outcome for a repeated key and refuses the key with other values', async ({
    api,
  }) => {
    const variant = firstVariant();
    const key = freshIdempotencyKey();
    const input = {
      mode: 'delta' as const,
      quantity: 1,
      operatorReason: 'found' as const,
      idempotencyKey: key,
    };

    const first = await api.inventory.correct(variant.id, input);
    expect(first.kind).toBe('result');

    const repeat = await api.inventory.correct(variant.id, input);
    expect(repeat.kind).toBe('result');
    if (repeat.kind === 'result') expect(repeat.result.deduplicated).toBe(true);
    expect((await api.inventory.correctionTarget(variant.id)).currentQuantity).toBe(
      variant.quantity + 1,
    );

    const reused = await api.inventory.correct(variant.id, { ...input, quantity: 2 });
    expect(reused.kind).toBe('conflict');
    if (reused.kind === 'conflict') expect(reused.conflict.code).toBe('idempotency-key-reused');
  });
});

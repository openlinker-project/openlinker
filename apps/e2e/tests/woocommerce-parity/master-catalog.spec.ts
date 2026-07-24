/**
 * WooCommerce parity — scenario 1: WooCommerce as master catalogue
 *
 * Mirrors golden-path S1 (`tests/golden-path/operator-setup.spec.ts`), but for
 * a connection where WooCommerce — not PrestaShop — carries `ProductMaster` /
 * `InventoryMaster`. Resolves the connection BY CAPABILITY
 * (`world.connectionWithCapability`, #1571) rather than assuming a platform,
 * so the same spec works whichever platform the stack designates as master.
 *
 * Self-configuring: skips with a clear reason when the stack has no
 * WooCommerce connection configured as ProductMaster, or no WC REST
 * credentials to cross-check against (`OL_WC_CONSUMER_KEY` /
 * `OL_WC_CONSUMER_SECRET`).
 *
 * @module tests/woocommerce-parity
 */
import { test, expect } from '../../src/fixtures/test';
import { buildWooCommerceClient } from '../../src/support/woocommerce-client';
import { externalIdFor } from '../../src/support/external-ids';
import type { Product } from '../../src/api/api.types';

test.describe('WooCommerce as master catalogue', () => {
  test('simple + multi-variant products land in OL with per-variation stock and EANs', async ({
    api,
    world,
    jobs,
    poll,
  }) => {
    const wcMaster = world.connectionWithCapability('ProductMaster', 'woocommerce');
    test.skip(!wcMaster, 'no WooCommerce connection configured as ProductMaster on this stack');

    const wc = buildWooCommerceClient(wcMaster);
    test.skip(!wc, 'OL_WC_CONSUMER_KEY / OL_WC_CONSUMER_SECRET not set — cannot cross-check against WC REST');

    const hasInventoryMaster = world
      .connectionsWithCapability('InventoryMaster')
      .some((c) => c.id === wcMaster!.id);

    await jobs.triggerAndWait(
      { connectionId: wcMaster!.id, jobType: 'master.product.syncAll' },
      { timeoutMs: 120_000 },
    );
    if (hasInventoryMaster) {
      await jobs.triggerAndWait(
        { connectionId: wcMaster!.id, jobType: 'master.inventory.syncAll' },
        { timeoutMs: 120_000 },
      );
    }

    // Find at least one product OL mapped to this WooCommerce connection —
    // the master sync may share the stack with other master connections
    // (e.g. PrestaShop), so filter by external-id presence rather than
    // assuming the first listed product came from WC.
    const products = await poll.until(
      () => api.products.list({ limit: 50 }),
      (page) => page.items.length > 0,
      { message: 'products to appear in OL after WooCommerce master sync', timeoutMs: 60_000 },
    );

    let wcProduct: Product | undefined;
    let wcExternalId: string | undefined;
    for (const summary of products.items) {
      const detail = await api.products.getById(summary.id);
      const externalId = externalIdFor(detail.externalIds, wcMaster!.id);
      if (externalId) {
        wcProduct = detail;
        wcExternalId = externalId;
        break;
      }
    }
    expect(wcProduct, 'at least one OL product mapped to the WooCommerce master connection').toBeTruthy();

    const wcView = await wc!.getProduct(wcExternalId!);
    expect(norm(wcView.name), 'product name matches WC').toBe(norm(wcProduct!.name));
    if (wcProduct!.sku && wcView.sku) {
      expect(norm(wcView.sku)).toBe(norm(wcProduct!.sku));
    }

    const variants = await world.variantsOf(wcProduct!.id);
    expect(variants.length).toBeGreaterThan(0);

    // Per-variant EAN + stock parity against WC (simple products expose a
    // single synthetic variant; variable products expose real WC variations).
    const availability = await api.inventory.availability(variants.map((v) => v.id));
    expect(availability.length).toBe(variants.length);

    if (wcView.type === 'variable') {
      const wcVariations = await wc!.getProductVariations(wcExternalId!);
      expect(wcVariations.length, 'WC variable product exposes variations').toBeGreaterThan(0);
      for (const variant of variants) {
        if (!variant.ean) continue; // some demo variants legitimately lack an EAN
        const match = wcVariations.find((v) => v.ean && norm(v.ean) === norm(variant.ean));
        expect(match, `OL variant EAN ${variant.ean} present on a WC variation`).toBeTruthy();
        if (match && hasInventoryMaster) {
          const expectedStock = match.stockQuantity;
          // master.inventory.syncAll (like master.product.syncAll) returns
          // 'succeeded' as soon as it has fanned out per-variant sub-jobs, not
          // once they've all landed — poll until the number actually converges
          // rather than asserting a single-shot read right after the outer job.
          const olAvailable = await poll.until(
            async () => {
              const [entry] = await api.inventory.availability([variant.id]);
              return entry?.totalAvailable;
            },
            (value) => value === expectedStock,
            {
              message: `OL master stock for variant ${variant.id} to converge to WC stock_quantity ${String(expectedStock)}`,
              timeoutMs: 60_000,
            },
          );
          expect(
            olAvailable,
            `OL master stock for variant ${variant.id} matches WC stock_quantity`,
          ).toBe(expectedStock);
        }
      }
    } else if (hasInventoryMaster && wcView.stockQuantity !== null) {
      const expectedStock = wcView.stockQuantity;
      const total = await poll.until(
        async () => {
          const avail = await api.inventory.availability(variants.map((v) => v.id));
          return avail.reduce((sum, a) => sum + a.totalAvailable, 0);
        },
        (value) => value === expectedStock,
        {
          message: `OL master total stock to converge to WC simple-product stock_quantity ${String(expectedStock)}`,
          timeoutMs: 60_000,
        },
      );
      expect(total, 'OL master total stock matches WC simple-product stock_quantity').toBe(
        expectedStock,
      );
    }
  });
});

function norm(value: string | null | undefined): string {
  return (value ?? '').trim();
}

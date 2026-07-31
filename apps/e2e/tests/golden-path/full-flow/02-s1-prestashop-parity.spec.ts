/**
 * Golden path full-flow: S1 — PrestaShop parity
 *
 * Assert the OL product matches the master shop's webservice view, field by field.
 *
 * Segment of the attended S0-S9 flow across all six systems. The segments share
 * `state` and run in file order in one worker — see `./segment.ts` for the
 * ordering, fail-fast and attended-gate contract, and
 * `docs/manual-testing/e2e-golden-path.md` for the flow itself.
 *
 * WARNING: MUTATING and ATTENDED. Run only via
 * `pnpm --filter @openlinker/e2e test:e2e:full-flow`, in a coordinated session
 * against a stack you control.
 *
 * @module tests/golden-path/full-flow
 */
import { test, expect } from '../../../src/fixtures/test';
import { PlatformType } from '../../../src/world/world';
import { assertProductFieldParity, type ProductParityView } from '../../../src/support/parity';
import { state } from './flow-state';
import { fullFlowSegment } from './segment';
import { requireProduct, skipWhenResuming, externalIdFor, buildPrestashopClient } from './helpers';

fullFlowSegment(() => {
  test('S1 — PrestaShop parity: OL product matches master (webservice)', async ({ api, world, env }) => {
    skipWhenResuming(env);
    requireProduct();
    const prestashop = world.requireConnection(PlatformType.prestashop);
    const primary = state.primaryVariant!;
    const olProduct = await api.products.getById(state.product!.id);

    // SKIP, never degrade. Without the webservice key this segment used to fall
    // back to `expect(olProduct.name).toBeTruthy()` and return GREEN - a
    // "PrestaShop parity" result in the HTML report that never compared a single
    // value against PrestaShop, and that silently dropped the EAN-set, price and
    // master-stock assertions below with it. Every other missing precondition in
    // this suite skips; this one has no reason to be different.
    const ps = buildPrestashopClient(world);
    test.skip(
      !ps,
      'OL_PS_WEBSERVICE_KEY / OL_PS_ADMIN_URL not set - cannot assert OL<->PrestaShop parity',
    );

    const externalProductId = externalIdFor(olProduct.externalIds, prestashop.id);
    test.skip(!externalProductId, 'no PrestaShop external id mapped for the product');
    const psProduct = await ps!.getProduct(externalProductId!);

    // PrestaShop stores barcodes on COMBINATIONS for multi-variant products —
    // the parent's `ean13` is empty there. Variant-level EAN parity compares
    // the OL variant EAN set against the PS combination EAN set; a simple
    // product falls back to the parent-level field.
    const psCombEans = await ps!.getCombinationEans(externalProductId!);
    const olVariants = await world.variantsOf(state.product!.id);
    if (psCombEans.length > 0) {
      const olEans = olVariants
        .map((v) => v.ean ?? v.gtin)
        .filter((e): e is string => !!e)
        .sort();
      expect(olEans.length, 'OL variants carry EANs').toBeGreaterThan(0);
      expect(
        olEans,
        'OL variant EAN set equals the PS combination EAN set',
      ).toEqual([...psCombEans].sort());
    }

    const expected: ProductParityView = {
      name: psProduct.name,
      ean: psCombEans.length > 0 ? (primary.ean ?? primary.gtin) : psProduct.ean13,
      price: psProduct.price ?? undefined,
      currency: olProduct.currency ?? 'PLN',
    };
    const actual: ProductParityView = {
      name: olProduct.name,
      ean: primary.ean ?? primary.gtin,
      price: olProduct.price ?? undefined,
      currency: olProduct.currency ?? 'PLN',
    };
    // Price is load-bearing - fail loudly if the master read is missing it
    // rather than silently skipping the comparison.
    //
    // `'ean'` is required ONLY on the simple-product branch. On the
    // multi-variant branch both sides of the `ean` slot are literally the same
    // expression (`primary.ean ?? primary.gtin`), so requiring it asserted the
    // primary variant's EAN against itself - a self-comparison reported as
    // cross-system parity. The real EAN coverage there is the set assertion
    // above, against the PS combination EANs.
    assertProductFieldParity({
      label: 'OL↔PS product',
      expected,
      actual,
      required: psCombEans.length > 0 ? ['price'] : ['ean', 'price'],
    });

    // Master stock: OL master availability totals the PS stock_availables.
    const psStock = await ps!.getStockForProduct(externalProductId!);
    const olTotal = [...state.olBaseline!.values()].reduce((a, b) => a + b, 0);
    expect(olTotal, `OL master total (${olTotal}) matches PS stock (${psStock})`).toBe(psStock);
  });
});

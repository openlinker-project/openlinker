/**
 * Golden path full-flow: S2 — WooCommerce publish
 *
 * Publish the driver product to the shop and assert REST-level parity.
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
import { resolve } from 'node:path';
import { test, expect } from '../../../src/fixtures/test';
import { PlatformType } from '../../../src/world/world';
import { assertProductFieldParity } from '../../../src/support/parity';
import { state } from './flow-state';
import { fullFlowSegment } from './segment';
import { requireProduct, skipWhenResuming, buildWooClient, publishToShop } from './helpers';

fullFlowSegment(() => {
  test('S2 — WooCommerce publish + REST parity', async ({ api, world, pages, poll, env }) => {
    skipWhenResuming(env);
    const testInfo = test.info();
    requireProduct();
    // Scoped to WooCommerce, not "the first ProductPublisher".
    // `connectionsWithCapability` unions ENABLED and SUPPORTED capabilities, and
    // PrestaShop's adapter supports ProductPublisher too — so on this stack the
    // unscoped lookup returned "PrestaShop (master)" (created first), which the
    // publish rail correctly does not offer as a destination. The step then died
    // before the purchase pause on a locator that could never resolve.
    const shop =
      world.connectionWithCapability('ProductPublisher', PlatformType.woocommerce) ??
      world.connectionFor(PlatformType.woocommerce);
    test.skip(!shop, 'no WooCommerce/ProductPublisher connection on this stack');

    await publishToShop(pages, api, shop!.name, state.product!.name);

    // WooCommerce is a ProductPublisher, not an OfferManager — publishing
    // creates a PRODUCT on the shop (async, via the shop.product.publish
    // worker job), NOT an `/listings` offer mapping (which stays empty for a
    // shop connection). The real end-to-end signal is the product landing on
    // WooCommerce, read back over its REST API by name.
    // SKIP, never degrade. The old `else` branch annotated and asserted
    // `products.list().items.length > 0` - "OL has at least one product", which
    // S0 already proved and which is true of any stack - so a run with no WC
    // credentials reported a green "WooCommerce publish + REST parity" segment
    // that had verified nothing on WooCommerce. There is no OL-side list
    // endpoint for shop-publish records to fall back on, so the honest outcome
    // is a skip. (The wp-admin storage-state step at the end of this test is
    // skipped with it; nothing else in the suite consumes `.auth/woocommerce.json`.)
    const wcClient = buildWooClient(world);
    test.skip(
      !wcClient,
      'OL_WC_CONSUMER_KEY / OL_WC_CONSUMER_SECRET not set - the publish landed OL-side but ' +
        'cannot be verified on WooCommerce, and OL exposes no shop-publish read to assert instead',
    );
    // Non-null past the skip above: `test.skip` throws, which TypeScript's
    // control-flow analysis cannot see.
    const wc = wcClient!;

    // Prefer SKU lookup (the shop publisher now carries the variant SKU, #1485),
    // falling back to exact-name for products published before that landed.
    // Both lookups are exact-match only — no exact match keeps the poll going
    // and times out loudly rather than latching an arbitrary search hit.
    const wcSku = state.primaryVariant?.sku ?? undefined;
    const wcProduct = await poll.until(
      async () =>
        (wcSku ? await wc.getProductBySku(wcSku) : null) ??
        (await wc.getProductByName(state.product!.name)),
      (p) => p !== null,
      {
        message: `the published product "${state.product!.name}" to appear on WooCommerce`,
        timeoutMs: 120_000,
      },
    );
    state.wcProductId = wcProduct!.id;
    state.channelBaseline.set('woocommerce', wcProduct!.stockQuantity ?? 0);
    // Name + price are asserted for parity. The publisher now carries the SKU
    // (#1485); category mapping is still a known WooCommerce-publish gap ("not
    // implemented in MVP") — recorded below rather than failed, so the report
    // stays honest.
    // A MULTI-variant product publishes as a WooCommerce `variable` parent
    // plus one variation per sibling (#1836), and a variable parent carries no
    // price of its own — the price lives on each variation. Comparing the
    // parent's price would therefore assert null against the master price for
    // every multi-variant product. Read the price off the variation matching
    // the primary variant instead, and keep the parent comparison for the
    // simple-product shape.
    //
    // Poll for the price rather than reading it once: WooCommerce returns the
    // product as soon as it exists, but its computed `price` field lags the
    // create by a moment and comes back empty (which the view maps to null).
    // A single read therefore raced the publish and failed on a price that
    // was populated seconds later.
    const wcPrice = await poll.until(
      async () => {
        if (wcProduct!.type !== 'variable') {
          return (await wc.getProduct(String(wcProduct!.id))).price ?? undefined;
        }
        const variations = await wc.getProductVariations(wcProduct!.id);
        expect(
          variations.length,
          'a variable WooCommerce parent exposes one variation per OL sibling',
        ).toBeGreaterThan(0);
        const match =
          (wcSku ? variations.find((v) => v.sku === wcSku) : undefined) ?? variations[0];
        return match?.price ?? undefined;
      },
      (price) => price !== undefined && price !== '',
      {
        message: `the published product "${state.product!.name}" to carry a price on WooCommerce`,
        timeoutMs: 60_000,
      },
    );
    assertProductFieldParity({
      label: 'OL↔WC product',
      expected: { name: state.product!.name, price: state.product!.price ?? undefined },
      actual: { name: wcProduct!.name, price: wcPrice },
      // `required: ['price']` - `assertProductFieldParity` skips any field the
      // EXPECTED side does not carry, so a null `state.product.price` silently
      // reduced this parity check to a currency-string comparison. S1 already
      // declares its own `required`; these three call sites did not.
      required: ['price'],
    });
    if (!wcProduct!.sku) {
      testInfo.annotations.push({
        type: 'wc-publish-gap',
        description:
          'WooCommerce product published without a SKU — the publisher is expected to carry the ' +
          'variant SKU (#1485); a missing SKU here means the API predates #1485, so SKU-level ' +
          'parity + stock reconciliation by SKU are not possible on this stack',
      });
    }
    if (wcProduct!.categories.every((c) => c.name.toLowerCase() === 'uncategorized')) {
      testInfo.annotations.push({
        type: 'wc-publish-gap',
        description: 'WooCommerce product published uncategorised (category mapping not implemented in MVP)',
      });
    }

    // Light visual confirmation in wp-admin (own login + storageState).
    await pages.woocommerceAdmin.login(env.wcAdminUrl, env.wcAdminUser, env.wcAdminPass);
    await pages.woocommerceAdmin.saveStorageState(resolve('.auth/woocommerce.json'));
  });
});

/**
 * Subiekt GT: a product OpenLinker published to a shop, sold, comes back (#3365)
 *
 * This is the topology an ERP-backed shop actually runs: the catalogue lives in
 * Subiekt, OpenLinker PUBLISHES it to the shop, the buyer orders there, and the
 * order has to find its way back to the Subiekt towar it came from. Before
 * #3365 it could not. The publish writes a `ShopProduct` identifier mapping and
 * `OrderItemRefResolverService` read `Offer`, `Product`, `ProductVariant` and
 * `Sku` - never `ShopProduct` - so the line either failed to resolve or, on a
 * stack where the shop is ALSO swept as a ProductMaster, resolved to the
 * duplicate product that sweep created, which carries no mapping to Subiekt at
 * all. Either way the sale never reached the ERP.
 *
 * `order-to-documents.spec.ts` is the sibling that proves the document chain,
 * and it skips its stock assertion for exactly this reason - its own message
 * says so: "the sold product maps to no Subiekt towar ... To exercise this
 * assertion the sold product must carry a Subiekt identifier mapping." This
 * spec produces such a product rather than hoping the stack has one, which is
 * the whole difference between the two files.
 *
 * WHAT IT PROVES, in order:
 *   1. a Subiekt towar can be published to the shop at all;
 *   2. an order placed for the PUBLISHED product resolves back to the SAME
 *      internal product the Subiekt mapping names - not a duplicate;
 *   3. the destination mirror accepts it;
 *   4. the resulting document moves the towar's stock.
 *
 * Step 2 is the one that was broken, and it is asserted on identity rather than
 * on absence of error: an order that resolved to a duplicate also "succeeds",
 * so a green run that only checked for errors would have proved nothing.
 *
 * Opt-in like every spec in this folder: `E2E_TEST_SUBIEKT=true`, a live
 * Subiekt GT connection, a PrestaShop connection with webservice credentials.
 * It publishes a real product into a real shop and sells it, so it never runs
 * by accident.
 *
 * @module apps/e2e/tests/subiekt
 */
import { expect, test } from '../../src/fixtures/test';
import type { ApiClient } from '../../src/api/api-client';
import type { Product, ProductVariant } from '../../src/api/api.types';
import { PlatformType } from '../../src/world/world';
import {
  synthesizeOrder,
  buildPrestashopWebserviceClient,
} from '../../src/support/order-synthesis';

/** A publish is a job; the mapping it writes appears only once that job ran. */
const PUBLISH_TIMEOUT_MS = 180_000;

/** The external id this product carries on `connectionId`, or null. */
function externalIdOn(product: Product, connectionId: string): string | null {
  return product.externalIds?.find((m) => m.connectionId === connectionId)?.externalId ?? null;
}

/**
 * The first catalogue product carrying a Subiekt mapping and a sellable
 * variant, or null.
 *
 * Scoped to the Subiekt connection for the same reason `pickDriverProduct` is
 * scoped to PrestaShop: OpenLinker's catalogue is global and carries other
 * masters' products, so an unscoped page decides the outcome by whatever sorts
 * first.
 */
async function pickSubiektProduct(
  api: ApiClient,
  subiektConnectionId: string
): Promise<{ product: Product; variant: ProductVariant; symbol: string } | null> {
  const page = await api.products.list({ limit: 50, connectionId: subiektConnectionId });
  for (const summary of page.items) {
    const detail = await api.products.getById(summary.id);
    const symbol = externalIdOn(detail, subiektConnectionId);
    if (!symbol) continue;
    const variants =
      detail.variants && detail.variants.length > 0
        ? detail.variants
        : (await api.products.listVariants(summary.id)).items;
    // A price is required to sell it and a SKU is required to find it again on
    // the shop side - the publish carries the SKU across as `reference`, which
    // is the only handle the shop's own API offers for a product OpenLinker
    // created (see `getProductIdByReference`).
    const variant = variants.find(
      (v) => (v.price ?? detail.price ?? 0) > 0 && !!(v.sku ?? detail.sku)
    );
    if (variant) return { product: detail, variant, symbol };
  }
  return null;
}

/** Poll until the variant reports a listing on `connectionId`. */
async function waitForPublishedMapping(
  api: ApiClient,
  connectionId: string,
  variantId: string,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const published = await api.listings.publishedVariants(connectionId, [variantId]);
    if (published.includes(variantId)) return true;
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  return false;
}

test.describe('Subiekt GT: a published product sold in the shop (#3365)', () => {
  // Serial: the second test sells what the first published. Publishing per
  // test would put a duplicate product into somebody's real shop.
  test.describe.configure({ mode: 'serial' });

  let driver: { product: Product; variant: ProductVariant; symbol: string } | null = null;
  let shopProductId: string | null = null;
  const soldQuantity = 1;

  test('a Subiekt towar publishes to the shop and becomes findable there', async ({
    api,
    world,
    env,
  }) => {
    test.skip(
      !env.testSubiekt,
      'opt-in — set E2E_TEST_SUBIEKT=true against a live Subiekt GT bridge'
    );
    const subiekt = world.connectionFor(PlatformType.subiektGt);
    const prestashop = world.connectionFor(PlatformType.prestashop);
    test.skip(!subiekt, 'no Subiekt GT connection on this stack');
    test.skip(!prestashop, 'no PrestaShop connection on this stack');
    const ps = buildPrestashopWebserviceClient(world);
    test.skip(ps === null, 'no PrestaShop webservice credentials — set OL_PS_WEBSERVICE_KEY');

    driver = await pickSubiektProduct(api, subiekt!.id);
    test.skip(
      driver === null,
      'no catalogue product carries a Subiekt mapping AND a priced, SKU-bearing variant. Run the ' +
        'Subiekt ProductMaster sweep first — without a towar in the catalogue there is nothing ' +
        'this spec can publish.'
    );

    const alreadyPublished = await api.listings.publishedVariants(prestashop!.id, [
      driver!.variant.id,
    ]);
    if (!alreadyPublished.includes(driver!.variant.id)) {
      await api.listings.shopPublish(prestashop!.id, {
        internalVariantId: driver!.variant.id,
        status: 'published',
        // Deliberately not the master's own figure: this spec sells ONE unit
        // and then asserts the drop, so it only needs enough to sell, and a
        // large number here would be a claim about stock it did not check.
        stock: 10,
        ...(driver!.variant.price !== null && driver!.variant.price !== undefined
          ? { price: driver!.variant.price }
          : {}),
      });

      const mapped = await waitForPublishedMapping(
        api,
        prestashop!.id,
        driver!.variant.id,
        PUBLISH_TIMEOUT_MS
      );
      expect(
        mapped,
        `variant ${driver!.variant.id} never reported a listing on the shop — the publish job did ` +
          `not write its ShopProduct mapping (check ProductPublisher is enabled on the connection)`
      ).toBe(true);
    }

    // The shop's own side is the only place the published id can be read back
    // from: `GET /products/:id` returns `Product` mappings only, and a publish
    // writes `ShopProduct`.
    const reference = driver!.variant.sku ?? driver!.product.sku ?? '';
    shopProductId = await ps!.getProductIdByReference(reference);
    expect(
      shopProductId,
      `no shop product carries reference "${reference}" — the publish reported a mapping but the ` +
        `product is not findable by the SKU it was published under`
    ).not.toBeNull();
  });

  test('an order for the published product resolves back to the SAME Subiekt product', async ({
    api,
    world,
    jobs,
    poll,
    env,
  }) => {
    test.skip(!env.testSubiekt, 'opt-in — set E2E_TEST_SUBIEKT=true');
    test.skip(driver === null || shopProductId === null, 'nothing was published to sell');
    const subiekt = world.connectionFor(PlatformType.subiektGt)!;

    const synthesized = await synthesizeOrder(
      { api, world, jobs, poll },
      { quantity: soldQuantity, driver: { product: driver!.product, variant: driver!.variant } }
    );

    // THE ASSERTION THIS FILE EXISTS FOR. Resolving to a DUPLICATE is also a
    // successful ingestion - the order would look healthy and carry a product
    // that has no Subiekt mapping - so identity is what has to be checked, not
    // the absence of an error.
    //
    // Read off the snapshot because that is where a line lives: `order_records`
    // has no lines table, the items are inside the `orderSnapshot` jsonb, and
    // the resolved internal id is written onto them at ingestion.
    const items = (synthesized.order.orderSnapshot as { items?: { productId?: string }[] }).items;
    const resolvedProductId = items?.[0]?.productId;
    expect(resolvedProductId, 'the ingested order carries no resolved line at all').toBeTruthy();
    expect(
      resolvedProductId,
      `the order line resolved to ${resolvedProductId} instead of ${driver!.product.id}. A ` +
        `different internal product means the shop's ShopProduct mapping was not consulted and ` +
        `the line landed on a duplicate the shop's own catalogue sweep created — which carries ` +
        `no mapping to Subiekt, so the sale can never reach the ERP.`
    ).toBe(driver!.product.id);

    // And the product it resolved to is genuinely the Subiekt towar, read
    // independently rather than inferred from the id matching above.
    const resolved = await api.products.getById(resolvedProductId!);
    expect(
      externalIdOn(resolved, subiekt.id),
      'the resolved product carries no Subiekt mapping'
    ).toBe(driver!.symbol);
  });

  test('the sale reaches Subiekt and moves the towar stock', async ({ api, world, jobs, env }) => {
    test.skip(!env.testSubiekt, 'opt-in — set E2E_TEST_SUBIEKT=true');
    test.skip(driver === null || shopProductId === null, 'nothing was published to sell');
    const subiekt = world.connectionFor(PlatformType.subiektGt)!;

    const before = await api.inventory.availability([driver!.variant.id]);
    const beforeAvailable = before[0]?.totalAvailable ?? null;
    test.skip(
      beforeAvailable === null,
      'OpenLinker holds no availability for the sold variant, so there is no figure to compare'
    );

    // Re-read the master so the mirror reflects the release the document made.
    await jobs.triggerAndWait({ connectionId: subiekt.id, jobType: 'master.inventory.syncAll' });

    const after = await api.inventory.availability([driver!.variant.id]);
    const afterAvailable = after[0]?.totalAvailable ?? null;

    expect(
      afterAvailable,
      'availability became unknown after the sync — a null publishes as a suppressed write, not ' +
        'as a lower number'
    ).not.toBeNull();
    expect(
      afterAvailable,
      `${driver!.symbol}: stock did not drop after the sale (${beforeAvailable} -> ` +
        `${afterAvailable}). Either no document was issued against the order, or its line resolved ` +
        `to a one-off service position that no warehouse document can release.`
    ).toBeLessThanOrEqual(beforeAvailable - soldQuantity);
  });
});

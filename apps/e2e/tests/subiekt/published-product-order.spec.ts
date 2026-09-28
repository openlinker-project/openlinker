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
import type { Connection, Product, ProductVariant } from '../../src/api/api.types';
import { PlatformType } from '../../src/world/world';
import {
  synthesizeOrder,
  buildPrestashopWebserviceClient,
} from '../../src/support/order-synthesis';
// Shared with `order-to-documents.spec.ts`, which needs the same product for
// the same reason: Subiekt refuses an order line for a towar it does not know.
// Idempotent, so two specs in one serial project publish it once between them.
import {
  ensureSubiektProductOnShop,
  externalIdOn,
} from '../../src/support/subiekt-shop-driver';

test.describe('Subiekt GT: a published product sold in the shop (#3365)', () => {
  // Serial: the second test sells what the first published. Publishing per
  // test would put a duplicate product into somebody's real shop.
  test.describe.configure({ mode: 'serial' });

  let driver: { product: Product; variant: ProductVariant; symbol: string } | null = null;
  let shopProductId: string | null = null;
  let publishConnection: Connection | null = null;
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
    // The connection that PUBLISHES, resolved by capability rather than by
    // position. A stand can carry several PrestaShop connections and the
    // positional answer is whichever sorts first - on this stand a seed
    // fixture with zero enabled capabilities, which would skip this whole file
    // while the real store sat one row down.
    const prestashop = world
      .connectionsFor(PlatformType.prestashop)
      .find((c) => c.status === 'active' && c.enabledCapabilities.includes('ProductPublisher'));
    test.skip(!subiekt, 'no Subiekt GT connection on this stack');
    const ps = buildPrestashopWebserviceClient(world);
    test.skip(ps === null, 'no PrestaShop webservice credentials — set OL_PS_WEBSERVICE_KEY');
    // The ENABLED list, not the adapter's advertised one: `enabledCapabilities`
    // is stamped at connection create and never retro-filled (#2085), so a
    // PrestaShop connection that predates ProductPublisher advertises it and
    // still rejects the publish with a 422. Skipping states that as the
    // configuration fact it is, rather than reporting it as a defect.
    test.skip(
      !prestashop,
      `no ACTIVE PrestaShop connection has ProductPublisher enabled. Enable it on the store — ` +
        `the adapter advertises the capability, but enabledCapabilities is stamped at create ` +
        `and never retro-filled (#2085).`
    );

    // ONE helper, shared with `order-to-documents.spec.ts`, and idempotent: two
    // specs in one serial project would otherwise publish the same towar twice
    // and leave a second product in somebody's real shop on every run.
    const resolved = await ensureSubiektProductOnShop(api, ps!, subiekt!.id, prestashop!);
    test.skip(
      resolved === null,
      'no catalogue product carries a Subiekt mapping AND a priced, SKU-bearing variant. Run the ' +
        'Subiekt ProductMaster sweep first — without a towar in the catalogue there is nothing ' +
        'this spec can publish.'
    );

    driver = { product: resolved!.product, variant: resolved!.variant, symbol: resolved!.symbol };
    publishConnection = resolved!.publishConnection;
    shopProductId = resolved!.shopProductId;

    // The shop's own side is the only place the published id can be read back
    // from: `GET /products/:id` returns `Product` mappings only, and a publish
    // writes `ShopProduct`. The helper asserts that lookup succeeded, so
    // reaching here means the product really is findable in the shop under the
    // reference it was published with.
    expect(shopProductId, 'the publish reported no shop product id').not.toBeNull();
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
      {
        quantity: soldQuantity,
        driver: { product: driver!.product, variant: driver!.variant },
        // The id the shop itself reports for the product OpenLinker published.
        // Its `ShopProduct` mapping is invisible to OpenLinker's products API,
        // so the synthesiser's own lookup would find nothing.
        externalProductId: shopProductId!,
        // WAIT on the connection that PUBLISHED, not on the catalogue master.
        // This stand carries two PrestaShop connections on one store; both
        // poll the same order and only this one holds the `ShopProduct`
        // mapping that resolves the line. The other ingests it as
        // `awaiting_mapping` - correctly - so waiting there can only time out.
        ingestConnection: publishConnection!,
      }
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

    // Re-read THIS towar, not the whole catalogue (#3365 audit).
    //
    // `master.inventory.syncAll` is budgeted and cursor-resumed (#2219): it
    // enqueues at most a page of children per tick, starting wherever the
    // cursor happens to sit, and `triggerAndWait` waits for the PARENT - whose
    // whole job is to enqueue. So the sold towar may not be read at all in that
    // tick, and the assertion measured a mirror nothing had refreshed. The same
    // trap is already written down two tests up, for the VAT rate.
    //
    // Measured while this failed: OpenLinker held 515 and the bridge answered
    // 513 for the same towar - Subiekt HAD released the stock and the mirror
    // had simply not been told.
    await jobs.triggerAndWait({
      connectionId: subiekt.id,
      jobType: 'master.inventory.syncByExternalId',
      payload: { objectType: 'Product', externalId: driver!.symbol },
    });

    // Polled rather than read once: the per-product sync writes
    // `inventory_items`, and the availability read is a separate query that can
    // observe the row a beat later.
    const deadline = Date.now() + 90_000;
    let afterAvailable: number | null = null;
    for (;;) {
      const after = await api.inventory.availability([driver!.variant.id]);
      afterAvailable = after[0]?.totalAvailable ?? null;
      if (afterAvailable !== null && afterAvailable <= beforeAvailable - soldQuantity) break;
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }

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

/**
 * Golden path: operator setup (S1-S4)
 *
 * The fully-automatable half of the operator flow — no manual buyer purchase
 * required. Each segment triggers the relevant work explicitly (a sync job or a
 * UI wizard) and then polls OL state (API-authoritative, UI cross-checked) with
 * a bounded timeout. The post-purchase half (S5-S9) is a follow-up issue built
 * on this same substrate.
 *
 *   S1  PrestaShop product sync   → product present in OL, stock == master
 *   S2  Publish to WooCommerce    → publish/listing state in OL
 *   S3  Allegro bulk offer wizard → variants created, listings mapped, stock
 *   S4  Erli bulk offer wizard    → offers created, stock (borrowed taxonomy)
 *
 * WARNING: this spec mutates the stack (publishes products, creates offers). Run
 * it only against a stack you control, in a coordinated session — never
 * unattended against a shared demo stack in active manual use.
 *
 * @module tests/golden-path
 */
import { test, expect } from '../../src/fixtures/test';
import { PlatformType } from '../../src/world/world';

test.describe.configure({ mode: 'serial' });

test.describe('operator setup (S1-S4)', () => {
  test('S1 — PrestaShop product sync lands products with master stock', async ({
    api,
    world,
    jobs,
    poll,
  }) => {
    const prestashop = world.connectionFor(PlatformType.prestashop);
    test.skip(!prestashop, 'no PrestaShop connection on this stack');

    // Trigger the master product sync explicitly and wait for the worker.
    const job = await jobs.triggerAndWait(
      { connectionId: prestashop!.id, jobType: 'master.product.syncAll' },
      { timeoutMs: 120_000 },
    );
    expect(job.status).toBe('succeeded');

    // OL now holds at least one product with resolvable variants.
    const products = await poll.until(
      () => api.products.list({ limit: 25 }),
      (page) => page.items.length > 0,
      { message: 'PrestaShop products to appear in OL', timeoutMs: 60_000 },
    );

    const product = products.items[0];
    const variants = await world.variantsOf(product.id);
    expect(variants.length).toBeGreaterThan(0);

    // Stock is master-sourced: every variant has an availability row (>= 0).
    const availability = await api.inventory.availability(variants.map((v) => v.id));
    expect(availability.length).toBe(variants.length);
    for (const entry of availability) {
      expect(entry.totalAvailable).toBeGreaterThanOrEqual(0);
    }
  });

  test('S2 — publish a product to WooCommerce via the publish dialog', async ({
    api,
    world,
    pages,
    poll,
  }) => {
    const woocommerce = world.connectionsWithCapability('ProductPublisher')[0];
    test.skip(!woocommerce, 'no ProductPublisher (shop) connection on this stack');

    const beforeCount = (await api.listings.list({ connectionId: woocommerce!.id, limit: 1 }))
      .total;

    await pages.listingsList.goto();
    const dialog = await pages.listingsList.openPublishToShop();
    await dialog.chooseConnection(woocommerce!.name);

    // Select the first product's variant (row-scoped) and drive the wizard to publish.
    const firstProduct = (await api.products.list({ limit: 1 })).items[0];
    expect(firstProduct, 'a product must exist to publish (run S1 first)').toBeTruthy();
    await dialog.selectFirstVariantOf(firstProduct.name);
    await dialog.continueWithSelectionButton.click();
    if (await dialog.reviewButton.count()) {
      await dialog.reviewButton.click();
    }
    await dialog.confirmPublishButton.click();

    // OL records the publish as a new listing/mapping for the shop connection —
    // the count must strictly grow past the pre-publish baseline.
    const after = await test.step('poll OL listings for the new shop mapping', async () =>
      poll.until(
        () => api.listings.list({ connectionId: woocommerce!.id, limit: 1 }),
        (page) => page.total > beforeCount,
        { message: 'a new WooCommerce listing mapping to appear', timeoutMs: 120_000 },
      ));
    expect(after.total).toBeGreaterThan(beforeCount);
  });

  test('S3 — Allegro bulk offer wizard creates and maps variant offers', async ({
    api,
    world,
    pages,
    poll,
  }) => {
    const allegro = world.connectionFor(PlatformType.allegro);
    test.skip(!allegro, 'no Allegro connection on this stack');
    await runBulkOfferSegment({ api, world, pages, poll, connectionName: allegro!.name, connectionId: allegro!.id });
  });

  test('S4 — Erli bulk offer wizard creates offers (borrowed taxonomy)', async ({
    api,
    world,
    pages,
    poll,
  }) => {
    const erli = world.connectionFor(PlatformType.erli);
    test.skip(!erli, 'no Erli connection on this stack');
    await runBulkOfferSegment({ api, world, pages, poll, connectionName: erli!.name, connectionId: erli!.id });
  });
});

/**
 * Shared bulk-offer flow for S3/S4: pick a multi-variant product on the Products
 * page, drive the bulk wizard to submission, then poll OL listings for the
 * connection until at least one offer mapping exists.
 */
async function runBulkOfferSegment(ctx: {
  api: import('../../src/api/api-client').ApiClient;
  world: import('../../src/world/world').World;
  pages: import('../../src/pages').PageObjects;
  poll: import('../../src/support/poller').Poller;
  connectionName: string;
  connectionId: string;
}): Promise<void> {
  const { api, world, pages, poll, connectionName, connectionId } = ctx;

  const product = await world.findMultiVariantProduct(2, { requireEans: true });
  expect(product, 'a multi-variant product must exist (run S1 first)').toBeTruthy();

  const before = (await api.listings.list({ connectionId, limit: 1 })).total;

  await pages.productsList.goto();
  await pages.productsList.selectProduct(product!.name);
  const wizard = await pages.productsList.startBulkOfferCreation(connectionName);
  await wizard.selectConnectionIfPresent(connectionName);

  // Config ("Proceed →") → auto-advancing Resolve → Review ("Approve all (N)"),
  // failing fast if any review row needs attention.
  await wizard.advanceToConfirmModal();
  const progress = await wizard.confirmCreation();
  expect(progress.batchId).toBeTruthy();

  // OL-authoritative assertion: offer mappings appear for the connection.
  await poll.until(
    () => api.listings.list({ connectionId, limit: 25 }),
    (page) => page.total > before,
    { message: `offer mappings to appear for ${connectionName}`, timeoutMs: 120_000 },
  );
}

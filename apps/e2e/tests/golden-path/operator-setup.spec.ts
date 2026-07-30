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
import { PlatformType, type World } from '../../src/world/world';
import type { ApiClient } from '../../src/api/api-client';
import type { Product, ProductVariant } from '../../src/api/api.types';
import { PrestashopWebserviceClient } from '../../src/api/prestashop-webservice';

test.describe.configure({ mode: 'serial' });

test.describe('operator setup (S1-S4)', () => {
  test('S1 — PrestaShop product sync lands products with master stock', async ({
    api,
    world,
    jobs,
    poll,
  }, testInfo) => {
    const prestashop = world.connectionFor(PlatformType.prestashop);
    test.skip(!prestashop, 'no PrestaShop connection on this stack');

    // Trigger the master product sync explicitly and wait for the worker.
    const job = await jobs.triggerAndWait(
      { connectionId: prestashop!.id, jobType: 'master.product.syncAll' },
    );
    expect(job.status).toBe('succeeded');

    // OL now holds at least one product with resolvable variants.
    const products = await poll.until(
      () => api.products.list({ limit: 25 }),
      (page) => page.items.length > 0,
      { message: 'PrestaShop products to appear in OL', timeoutMs: 60_000 },
    );

    // Pick a PRESTASHOP-mastered product: `products.items[0]` could be mastered
    // by any connection on the stack, and "master stock" is a claim about the
    // PrestaShop master specifically.
    const target = await findPrestashopMasteredProduct(api, world, prestashop!.id, products.items);
    test.skip(!target, 'no product in the first page carries a PrestaShop external id');
    const { product, psExternalId } = target!;
    const variants = await world.variantsOf(product.id);
    expect(variants.length, `product ${product.id} has variants`).toBeGreaterThan(0);

    // `master.product.syncAll` imports the CATALOGUE; inventory rows come from a
    // separate master-inventory sync. Drive the targeted one so the stock claim
    // in this test's name is about work this test actually caused.
    await jobs.triggerAndWait({
      connectionId: prestashop!.id,
      jobType: 'master.inventory.syncByExternalId',
      payload: { externalId: psExternalId, objectType: 'Product' },
    });

    // Stock is master-sourced: every variant has a REAL availability row.
    //
    // `length === variants.length` plus `totalAvailable >= 0` could not fail:
    // `getAvailabilityByVariantIds` zero-fills unknown ids and preserves input
    // order, so both held with `inventory_items` empty - the exact condition the
    // old comment claimed to rule out. `locationCount` is what distinguishes a
    // real row from the zero-fill.
    const availability = await poll.until(
      () => api.inventory.availability(variants.map((v) => v.id)),
      (rows) => rows.every((row) => row.locationCount > 0),
      {
        message: `a real (non-zero-filled) master availability row for every variant of ${product.id}`,
        timeoutMs: 60_000,
      },
    );

    // Cross-system check, the one that makes this a MASTER-stock test rather
    // than an OL-self-consistency test: OL's total equals PrestaShop's own.
    // Annotated rather than skipped when the webservice key is absent - unlike
    // full-flow's S1 the assertions above still carry real weight without it.
    const ps = buildPrestashopClient(world);
    if (!ps) {
      testInfo.annotations.push({
        type: 'skip-note',
        description:
          'OL_PS_WEBSERVICE_KEY / OL_PS_ADMIN_URL not set - OL master availability was NOT compared ' +
          'against PrestaShop stock_availables; only the OL-side rows were verified',
      });
      return;
    }
    const psStock = await ps.getStockForProduct(psExternalId);
    const olTotal = availability.reduce((sum, row) => sum + row.totalAvailable, 0);
    expect(olTotal, `OL master total (${olTotal}) matches PS stock (${psStock})`).toBe(psStock);
  });

  test('S2 — publish a product to WooCommerce via the unified publish flow', async ({
    api,
    world,
    pages,
    poll,
  }) => {
    // `connectionsWithCapability('ProductPublisher')` unscoped also matches
    // PrestaShop: its ADAPTER supports ProductPublisher (declared in
    // `supportedCapabilities`) even though this connection never enables it
    // (it's the master, not a publish target) — `connectionsWithCapability`'s
    // enabled-OR-supported union (by design, for FE surface gating) picked it
    // as connections[0] since it was created first, and the picker rail then
    // correctly refused to offer a destination the UI never enabled. Scope to
    // `woocommerce` explicitly — this test's whole point is publishing TO
    // WooCommerce, not "whatever ProductPublisher-capable connection sorts
    // first".
    const woocommerce = world.connectionWithCapability('ProductPublisher', PlatformType.woocommerce);
    test.skip(!woocommerce, 'no WooCommerce ProductPublisher (shop) connection on this stack');

    // #1754/#1829: /listings has a single "Publish products" CTA that opens the
    // unified picker; a shop destination continues into the SAME bulk wizard as
    // the marketplace path (Config -> Review -> publish).
    await pages.listingsList.goto();
    const picker = await pages.listingsList.openPublishProducts();

    // Pick a product whose FIRST variant is not already published on this
    // connection.
    //
    // `publishedVariants` (#1837's duplicate guard) reports a variant listed on
    // the connection by ANY run, so with no baseline the poll below was already
    // true on its first probe from run 2 onward: break shop publish server-side
    // entirely and this test still passed on every run but the first. The picker
    // selects the product row's FIRST variant, so eligibility has to be judged
    // on that same variant - same accept-filter discipline the bulk-offer
    // segments below use.
    const target = await findUnpublishedFirstVariant(api, world, woocommerce!.id);
    test.skip(
      !target,
      `every candidate product's first variant is already published on ${woocommerce!.name} - ` +
        'no unpublished target left, so a publish here could not be distinguished from a prior ' +
        'run. This is ELIGIBILITY EXHAUSTION, not a stack-configuration problem: a shop publish ' +
        'is irreversible from here (the suite cannot un-publish), so each run permanently ' +
        'consumes one candidate out of the first 25 products. Add catalogue products, or run ' +
        'with E2E_FRESH_PRODUCT=true, to replenish the pool.',
    );
    const { product: firstProduct, variant } = target!;
    const targetVariantId = variant.id;
    await picker.selectFirstVariantOf(firstProduct.name);
    await picker.chooseDestination(woocommerce!.name);
    await picker.continueToWizard();

    await pages.bulkOfferWizard.expectOnConfigStep();
    await pages.bulkOfferWizard.publishToShop({ visibility: 'published' });

    // A shop publish writes a `ShopProduct` identifier mapping, a DISTINCT
    // entity from the `Offer` mappings `GET /listings` lists (marketplace
    // only) — keyed by VARIANT id, so it never surfaces on `GET /products`
    // either. `POST /listings/published-variants` (#1837's duplicate guard)
    // is the one API surface that reads both mapping kinds, so it is the
    // only correct way to confirm a shop publish from outside the UI.
    await test.step('poll for the published-variant mapping to appear', () =>
      poll.until(
        () => api.listings.publishedVariants(woocommerce!.id, [targetVariantId]),
        (published) => published.includes(targetVariantId),
        { message: 'the published variant to appear on the WooCommerce connection', timeoutMs: 60_000 },
      ));
  });

  test('S3 — Allegro bulk offer wizard creates and maps variant offers', async ({
    api,
    world,
    pages,
    poll,
    env,
  }) => {
    const allegro = world.connectionFor(PlatformType.allegro);
    test.skip(!allegro, 'no Allegro connection on this stack');
    await runBulkOfferSegment({
      api,
      world,
      pages,
      poll,
      connectionName: allegro!.name,
      connectionId: allegro!.id,
      platformType: PlatformType.allegro,
      erliCategoryPath: env.freshAllegroCategoryPath,
    });
  });

  test('S4 — Erli bulk offer wizard creates offers (borrowed taxonomy)', async ({
    api,
    world,
    pages,
    poll,
    env,
  }) => {
    const erli = world.connectionFor(PlatformType.erli);
    test.skip(!erli, 'no Erli connection on this stack');
    await runBulkOfferSegment({
      api,
      world,
      pages,
      poll,
      connectionName: erli!.name,
      connectionId: erli!.id,
      platformType: PlatformType.erli,
      erliCategoryPath: env.freshAllegroCategoryPath,
    });
  });
});

/** The first listed product that carries a PrestaShop external id, with that id. */
async function findPrestashopMasteredProduct(
  api: ApiClient,
  world: World,
  prestashopConnectionId: string,
  candidates: readonly Product[],
): Promise<{ product: Product; psExternalId: string } | null> {
  for (const summary of candidates) {
    // The list endpoint omits externalIds - the detail read resolves them.
    const detail = await api.products.getById(summary.id);
    const psExternalId = detail.externalIds?.find(
      (e) => e.connectionId === prestashopConnectionId,
    )?.externalId;
    if (!psExternalId) continue;
    const variants = await world.variantsOf(detail.id);
    if (variants.length === 0) continue;
    return { product: detail, psExternalId };
  }
  return null;
}

/**
 * The first product whose FIRST variant is NOT yet published on `connectionId`.
 *
 * "First variant" is not incidental: the picker's `selectFirstVariantOf` is
 * row-scoped, so any other variant's publication state says nothing about what
 * this run is about to publish.
 */
async function findUnpublishedFirstVariant(
  api: ApiClient,
  world: World,
  connectionId: string,
): Promise<{ product: Product; variant: ProductVariant } | null> {
  const page = await api.products.list({ limit: 25 });
  for (const summary of page.items) {
    const variants = await world.variantsOf(summary.id);
    const first = variants[0];
    if (!first) continue;
    const published = await api.listings.publishedVariants(connectionId, [first.id]);
    if (!published.includes(first.id)) {
      return { product: summary, variant: first };
    }
  }
  return null;
}

function buildPrestashopClient(world: World): PrestashopWebserviceClient | null {
  const connection = world.connectionFor(PlatformType.prestashop);
  const key = process.env.OL_PS_WEBSERVICE_KEY?.trim();
  const baseUrl =
    process.env.OL_PS_ADMIN_URL?.trim() ||
    (typeof connection?.config?.['baseUrl'] === 'string' ? connection.config['baseUrl'] : '');
  if (!connection || !key || !baseUrl) return null;
  return new PrestashopWebserviceClient({ baseUrl, apiKey: key });
}

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
  platformType: string;
  /** Breadcrumb to the Allegro leaf an Erli row is filed under. */
  erliCategoryPath: string[];
}): Promise<void> {
  const { api, world, pages, poll, connectionName, connectionId, platformType, erliCategoryPath } =
    ctx;

  // Needs a product with at least one variant NOT already listed on this
  // connection. `BulkListingSubmitService` drops already-listed variants before
  // persisting the batch (#1741's authoritative duplicate guard) and rejects
  // the submit when that leaves nothing — so a product every sibling of which
  // an earlier run already published fails with "requires at least one
  // productId", which reads like a defect but is the guard working. The
  // sandbox accumulates offers across runs, so eligibility moves over time and
  // cannot be pinned to a fixed fixture.
  const product = await world.findMultiVariantProduct(2, {
    requireEans: true,
    accept: async (_candidate, variants) => {
      const listed = await api.listings.publishedVariants(
        connectionId,
        variants.map((v) => v.id),
      );
      return listed.length < variants.length;
    },
  });
  test.skip(
    !product,
    `no multi-variant product with an unlisted variant on ${connectionName} - every candidate in ` +
      'the scanned catalogue page is already listed there. ELIGIBILITY EXHAUSTION, not a ' +
      'stack-configuration problem: offers on the marketplace sandboxes cannot be deleted from ' +
      'here, so every run permanently consumes one candidate and this segment eventually skips ' +
      'forever. Add multi-variant, EAN-complete catalogue products (or run with ' +
      'E2E_FRESH_PRODUCT=true) to replenish the pool.',
  );

  const before = (await api.listings.list({ connectionId, limit: 1 })).total;

  await pages.productsList.goto();
  // Disambiguate by SKU, not name: this stack carries same-named products
  // from different masters (e.g. a PrestaShop-mastered multi-variant product
  // and an unrelated WooCommerce-mastered simple product sharing one name),
  // and `hasText` is a substring match — filtering by name alone can resolve
  // to more than one row.
  await pages.productsList.selectProduct(product!.sku ?? product!.name);
  const wizard = await pages.productsList.startBulkOfferCreation(connectionName);
  await wizard.selectConnectionIfPresent(connectionName);

  // Config ("Proceed →") → auto-advancing Resolve → Review ("Create offers (N)"),
  // failing fast if any review row needs attention.
  //
  // The per-destination options mirror `full-flow.spec.ts`'s own bulk segment.
  // Omitting them is not a smaller version of the same run — a borrowed-taxonomy
  // destination (Erli) resolves NO category in the wizard preview and exposes a
  // plain "Allegro category ID" field instead of a tree, so without an explicit
  // id its editor never loads a parameter schema, the required-parameter top-up
  // finds nothing to fill, and every job is rejected server-side with
  // PARAMETER_REQUIRED. Pass the same leaf id the Allegro row maps to.
  const primaryVariant = product!.variants?.[0];
  await wizard.advanceToConfirmModal({
    requiresDeliveryPolicy: platformType === PlatformType.allegro,
    // A buyable Erli offer additionally needs the batch-default delivery price
    // list (#1530) + responsible producer (#1531) from the config step.
    requiresErliBuyabilityFields: platformType === PlatformType.erli,
    gtin: primaryVariant?.ean ?? primaryVariant?.gtin ?? undefined,
    // Erli's category does not auto-resolve in the wizard preview, so its editor
    // opens the category browser. Drive it to the SAME leaf the Allegro row maps
    // to (golden-path parity) instead of "first reachable" — an arbitrary leaf's
    // parameter schema may not even load, and the offer would land in the wrong
    // place regardless.
    categoryPath: platformType === PlatformType.erli ? erliCategoryPath : undefined,
  });
  const progress = await wizard.confirmCreation();
  expect(progress.batchId).toBeTruthy();

  // OL-authoritative assertion: offer mappings appear for the connection.
  //
  // A batch whose jobs are all REJECTED still exists, so this wait can only
  // ever time out on one — reporting "no mappings appeared" for what is really
  // a business rejection (e.g. a required offer parameter with no resolvable
  // value). Surface the batch's own error text instead of the bare timeout.
  try {
    await poll.until(
      () => api.listings.list({ connectionId, limit: 25 }),
      (page) => page.total > before,
      { message: `offer mappings to appear for ${connectionName}`, timeoutMs: 120_000 },
    );
  } catch (error) {
    const batch = await api.listings.bulkBatch(progress.batchId).catch(() => null);
    const reasons = (batch?.records ?? [])
      .filter((r) => r.status === 'failed')
      .flatMap((r) => (r.errors ?? []).map((e) => `${e.code ?? 'ERROR'} ${e.field ?? ''}: ${e.message ?? ''}`.trim()));
    if (reasons.length > 0) {
      throw new Error(
        `batch ${progress.batchId} on ${connectionName} rejected ${batch?.failedCount ?? '?'}/${batch?.totalCount ?? '?'} offers:\n- ${[...new Set(reasons)].join('\n- ')}`,
      );
    }
    throw error;
  }
}

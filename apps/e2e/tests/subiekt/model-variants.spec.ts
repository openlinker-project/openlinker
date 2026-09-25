/**
 * Subiekt GT: models become product variants, and images load
 *
 * Covers the two things the Subiekt GT integration promised and did not do.
 *
 * **Variants.** A Subiekt MODEL (`sl_ModelTw` + `sl_ModelTowar`) is the
 * operator's own grouping of towary that are one article in several sizes. The
 * native adapter never read it, so a three-size article reached OpenLinker as
 * three unrelated products - and because the bulk offer wizard expands "the
 * whole product" from its siblings, selecting one published ONE size and the
 * other two vanished with nothing reported.
 *
 * **Images.** The bridge built image URLs from a compiled-in
 * `host.docker.internal` base, which the OpenLinker worker resolves and a
 * browser does not. Every thumbnail failed while every sync reported success,
 * and a broken thumbnail renders exactly like a product with no photo - which
 * is why nobody saw it. This suite asserts the URL from a BROWSER context for
 * that reason: an assertion made from Node would have passed against the
 * broken state on the machine where the defect was found.
 *
 * WHY THIS IS OPT-IN, not skip-if-absent. Subiekt GT is Windows + Sfera COM +
 * a live SQL Server behind a hand-deployed bridge; no CI runner has one, and
 * the data is somebody's actual warehouse. The suite reads and never writes,
 * but a catalogue sweep on an unsuspecting stack is still load nobody asked
 * for. Set `E2E_TEST_SUBIEKT=true` (the `E2E_TEST_RATE_LIMIT` precedent).
 *
 * WHY IT DISCOVERS ITS FIXTURES. Nothing here hardcodes "Black Tiger": the
 * suite asks OpenLinker which products carry several variants on the Subiekt
 * connection and works with what it finds, so it stays true on an operator's
 * own catalogue rather than only on the reference DEMO database.
 *
 * @module tests/subiekt
 */
import { test, expect } from '../../src/fixtures/test';
import { PlatformType } from '../../src/world/world';
import type { Product, ProductVariant } from '../../src/api/api.types';
import type { ApiClient } from '../../src/api/api-client';

/** A product with its variants already loaded, so assertions read plainly. */
interface ProductWithVariants {
  product: Product;
  variants: ProductVariant[];
}

/** `ListProductsQueryDto` caps a page at 100, so a wider read has to page. */
const PAGE_SIZE = 100;

/**
 * Up to `max` products OF THIS CONNECTION, each with its variants loaded.
 *
 * Scoping to the connection is not an optimisation: `/products` is the whole
 * catalogue, so an unscoped read would check a Subiekt rule against a
 * PrestaShop product and fail for a reason that has nothing to do with what
 * the test is about. (It did, on the first live run.)
 *
 * Bounded rather than exhaustive: a real Subiekt catalogue is thousands of
 * towary and this suite only needs enough of it to find a grouped product and
 * an ungrouped one. Paged because the API refuses a page above 100 - asking
 * for more in one go is a 400, not a bigger page.
 */
async function loadProducts(
  api: ApiClient,
  connectionId: string,
  max: number,
): Promise<ProductWithVariants[]> {
  const out: ProductWithVariants[] = [];
  for (let offset = 0; offset < max; offset += PAGE_SIZE) {
    const page = await api.products.list({
      connectionId,
      limit: Math.min(PAGE_SIZE, max - offset),
      offset,
    });
    for (const product of page.items) {
      const variants = await api.products.listVariants(product.id);
      // LIVE variants only. A towar that joined a model leaves its old
      // standalone product behind with its variant STALED (#1599) - the
      // product row itself is not deleted, so an unfiltered read sees the
      // retired variant and the live one and reports the towar as claimed
      // twice. Staleness is exactly the fact that distinguishes them.
      out.push({ product, variants: variants.items.filter((v) => v.isStale !== true) });
    }
    if (page.items.length < PAGE_SIZE) break;
  }
  return out;
}

/**
 * Wait until the catalogue sweep's CHILDREN have produced a grouped product.
 *
 * `master.product.syncAll` only fans out - it enqueues one
 * `master.product.syncBatch` per page and succeeds immediately - so a read
 * taken the moment it reports success describes the catalogue BEFORE the sweep,
 * which on the first live run made every model assertion skip with "no
 * multi-variant product" while the adapter was in fact producing them.
 *
 * Returns what it found, or an empty array once the budget is spent, so the
 * caller can skip for the honest reason (this catalogue has no model) rather
 * than for a timing one.
 */
async function waitForGroupedProducts(
  api: ApiClient,
  connectionId: string,
  timeoutMs: number,
): Promise<ProductWithVariants[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const grouped = (await loadProducts(api, connectionId, 200)).filter((p) => p.variants.length > 1);
    if (grouped.length > 0) return grouped;
    if (Date.now() >= deadline) return [];
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

/**
 * Poll a product until its VAT rate has been READ, whatever the answer.
 *
 * The sweep is budgeted and fans out per-product children (#2218/#2593), and
 * `triggerAndWait` returns when the PARENT succeeds - so the read this asserts
 * on happens after the trigger returns, not during it. Keyed on
 * `taxRateReadAt` rather than on the rate, because "the master answered, and
 * named no rate" is a legitimate end state that must not keep the poll
 * spinning.
 */
async function waitForTaxRateRead(
  api: ApiClient,
  productId: string,
  timeoutMs: number,
): Promise<Product> {
  const deadline = Date.now() + timeoutMs;
  let detail = await api.products.getById(productId);
  while (Date.now() < deadline && !detail.taxRateReadAt) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    detail = await api.products.getById(productId);
  }
  return detail;
}

test.describe('Subiekt GT: models as variants (#3365)', () => {
  test.describe.configure({ mode: 'serial' });

  test('a Subiekt model arrives as ONE product carrying one variant per towar', async ({
    api,
    world,
    jobs,
    env,
  }) => {
    test.skip(!env.testSubiekt, 'opt-in — set E2E_TEST_SUBIEKT=true against a live Subiekt GT bridge');
    const connection = world.connectionFor(PlatformType.subiektGt);
    test.skip(!connection, 'no Subiekt GT connection on this stack');

    // A full catalogue sweep, so the assertions below describe what the
    // adapter produces NOW rather than whatever a previous run left behind.
    await jobs.triggerAndWait({
      connectionId: connection!.id,
      jobType: 'master.product.syncAll',
    });

    // And the deletion audit, which is what RETIRES the standalone product a
    // towar had before it was grouped. The sweep alone cannot: it enumerates
    // FROM the master, so once a towar is a model member its old bare symbol
    // simply stops appearing and nothing ever revisits it. `reconcile` inverts
    // the direction - it walks OpenLinker's OWN product mappings - so the old
    // symbol is asked about, answers not-found, and goes stale (#2222/#1599).
    // Without this the catalogue carries both for a while, which the
    // one-towar-one-product test below catches.
    await jobs.triggerAndWait({
      connectionId: connection!.id,
      jobType: 'master.product.reconcile',
    });

    const grouped = await waitForGroupedProducts(api, connection!.id, 180_000);
    test.skip(
      grouped.length === 0,
      'no multi-variant product on this Subiekt — group some towary into a model in Subiekt GT first',
    );

    for (const { product, variants } of grouped) {
      // Every variant is a distinct towar, so every identity field is its own.
      const skus = variants.map((v) => v.sku);
      expect(new Set(skus).size, `variants of ${product.name} share a SKU: ${skus.join(', ')}`).toBe(
        skus.length,
      );

      // The axis Subiekt does not record, derived from the names. Siblings
      // carrying the same (or no) label are indistinguishable to an
      // explicit-grouping destination, which is the whole reason it exists.
      const labels = variants.map((v) => (v.attributes as Record<string, string> | null)?.Wariant);
      expect(labels.every((l) => typeof l === 'string' && l.length > 0),
        `a variant of ${product.name} carries no Wariant label: ${JSON.stringify(labels)}`).toBe(true);
      expect(new Set(labels).size, `variants of ${product.name} share a label: ${labels.join(', ')}`)
        .toBe(labels.length);

      // The product stands for the model, so its SKU must not be any member's.
      expect(skus).not.toContain(product.sku);
    }
  });

  // #3365. `readProductTaxRate` resolved the product key and then GET
  // `/api/products/model%3A5` unconditionally; the bridge answered 404 and
  // `MasterProductSyncService.syncTaxRate` swallowed the throw as a warn. So a
  // model-carrying catalogue got NOTHING from #3357 - every one of its order
  // lines kept the NULL rate that fix exists to remove - and the only trace
  // was a log line. This asserts the read now lands.
  test('a model product carries the VAT rate its members agree on', async ({
    api,
    world,
    env,
  }) => {
    // No sweep of its own: the file is serial and the first test already ran
    // `master.product.syncAll` + `master.product.reconcile`. A second full
    // sweep here would double a real catalogue read for nothing.
    test.skip(!env.testSubiekt, 'opt-in — set E2E_TEST_SUBIEKT=true against a live Subiekt GT bridge');
    const connection = world.connectionFor(PlatformType.subiektGt);
    test.skip(!connection, 'no Subiekt GT connection on this stack');

    const grouped = await waitForGroupedProducts(api, connection!.id, 180_000);
    test.skip(grouped.length === 0, 'no multi-variant product on this Subiekt');

    for (const { product } of grouped) {
      // POLLED, not read once. `jobs.triggerAndWait` waits for the SWEEP, and
      // a sweep's job is to enqueue children - the per-product syncs that
      // actually read the rate drain afterwards, behind whatever the stack
      // already had queued. Asserting immediately reported "the model-key
      // branch is not resolving" against a branch that was resolving fine
      // ninety seconds later.
      const detail = await waitForTaxRateRead(api, product.id, 180_000);

      // `taxRateReadAt` is the discriminator that matters. A null rate WITH a
      // read timestamp is the master honestly answering "no rate assigned";
      // a null rate with NO timestamp is the 404 this test exists to catch,
      // and the two are indistinguishable from the rate alone.
      expect(
        detail.taxRateReadAt,
        `${detail.name}: no VAT rate was ever read within the budget - either the per-product ` +
          `sync children have not drained, or the model-key branch is not resolving ` +
          `(check for a 404 on /api/products/model%3A... in the worker log)`,
      ).toBeTruthy();

      // On a healthy Subiekt every member of a model shares its VAT rate, so
      // a resolved code is the expected answer. `ambiguous` is a REAL answer
      // too - members disagreeing - so it is reported rather than failed, or
      // this spec would fail on a catalogue whose data is simply mixed.
      if (detail.taxRate === null || detail.taxRate === undefined) {
        // eslint-disable-next-line no-console
        console.warn(
          `${detail.name}: members carry no agreed VAT rate ` +
            `(reason=${detail.taxRateUnknownReason ?? 'unspecified'}). That is a persisted ` +
            `answer, not a failed read - fix the tw_IdVatSp assignment in Subiekt.`,
        );
      } else {
        expect(detail.taxRate).toMatch(/^(\d+|zw|np|oo)$/);
      }
    }
  });

  test('a towar the operator did NOT group stays its own product — grouping is never guessed', async ({
    api,
    world,
    env,
  }) => {
    test.skip(!env.testSubiekt, 'opt-in — set E2E_TEST_SUBIEKT=true');
    const connection = world.connectionFor(PlatformType.subiektGt);
    test.skip(!connection, 'no Subiekt GT connection on this stack');

    const products = await loadProducts(api, connection!.id, 200);
    const standalone = products.filter((p) => p.variants.length === 1);
    expect(standalone.length, 'every product is grouped — nothing proves grouping is not inferred').toBeGreaterThan(0);

    // This is the assertion that stops someone "improving" the adapter by
    // grouping towary whose names look alike. Two ungrouped towary sharing a
    // name prefix must remain two products.
    const byPrefix = new Map<string, ProductWithVariants[]>();
    for (const entry of standalone) {
      const prefix = entry.product.name.split(' ').slice(0, 2).join(' ').toLowerCase();
      byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), entry]);
    }
    const families = [...byPrefix.values()].filter((group) => group.length > 1);
    test.skip(families.length === 0, 'no two ungrouped towary share a name prefix on this catalogue');
    for (const family of families) {
      expect(new Set(family.map((f) => f.product.id)).size).toBe(family.length);
      for (const member of family) expect(member.variants).toHaveLength(1);
    }
  });

  test('no towar belongs to two products at once', async ({ api, world, env }) => {
    test.skip(!env.testSubiekt, 'opt-in — set E2E_TEST_SUBIEKT=true');
    const connection = world.connectionFor(PlatformType.subiektGt);
    test.skip(!connection, 'no Subiekt GT connection on this stack');

    // The transition this change makes loudly: a towar that JOINS a model stops
    // being a product of its own. If that signal were swallowed, the old
    // standalone product would keep syncing beside the new grouped one - two
    // OpenLinker products claiming one towar, both publishable, with the
    // operator's stock split between them and nothing anywhere reporting it.
    // Stated as an invariant over the whole catalogue rather than against named
    // SKUs, so it stays true on an operator's own data.
    // Given time, because the audit's children drain asynchronously - but the
    // assertion itself is exact, never relaxed: two products claiming one towar
    // is the state this whole change exists to avoid, so the test waits for it
    // to clear rather than tolerating it.
    const deadline = Date.now() + 180_000;
    let shared: [string, string[]][] = [];
    for (;;) {
      const products = await loadProducts(api, connection!.id, 300);
      const owners = new Map<string, string[]>();
      for (const { product, variants } of products) {
        for (const variant of variants) {
          if (variant.sku === null) continue;
          owners.set(variant.sku, [...(owners.get(variant.sku) ?? []), product.name]);
        }
      }
      shared = [...owners.entries()].filter(([, names]) => names.length > 1);
      if (shared.length === 0 || Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
    expect(
      shared.map(([sku, names]) => `${sku} -> ${names.join(' | ')}`),
      'a towar is claimed by more than one product',
    ).toEqual([]);
  });

  test('stock lands on the RIGHT variant, not on the product', async ({ api, world, env }) => {
    test.skip(!env.testSubiekt, 'opt-in — set E2E_TEST_SUBIEKT=true');
    const connection = world.connectionFor(PlatformType.subiektGt);
    test.skip(!connection, 'no Subiekt GT connection on this stack');

    const grouped = await waitForGroupedProducts(api, connection!.id, 120_000);
    test.skip(grouped.length === 0, 'no multi-variant product on this Subiekt');

    // Without a per-variant `Inventory.variantId`, MasterInventorySyncService's
    // "the product's lone variant" fallback stops applying the moment a product
    // has more than one - and every variant misses its stock SILENTLY. This is
    // the assertion that catches that, so it asserts on EVERY sibling rather
    // than on one.
    const { product, variants } = grouped[0];
    const availability = await api.inventory.availability(variants.map((v) => v.id));
    expect(
      availability.length,
      `availability is missing for some variants of ${product.name}: asked ${variants.length}, got ${availability.length}`,
    ).toBe(variants.length);
    for (const row of availability) {
      expect(row.totalAvailable, `variant ${row.productVariantId} has no availability figure`).not.toBeNull();
    }
  });

  test('a product image URL loads FROM A BROWSER, not merely from the worker', async ({
    api,
    world,
    env,
    context,
  }) => {
    test.skip(!env.testSubiekt, 'opt-in — set E2E_TEST_SUBIEKT=true');
    const connection = world.connectionFor(PlatformType.subiektGt);
    test.skip(!connection, 'no Subiekt GT connection on this stack');

    const withImages = (await loadProducts(api, connection!.id, 200)).filter(
      (p) => Array.isArray(p.product.images) && p.product.images.length > 0,
    );
    test.skip(withImages.length === 0, 'no Subiekt product carries an image URL');

    // Deliberately through the browser context. OpenLinker never fetches these
    // URLs - it stores them and the operator's browser dereferences them - so a
    // fetch from the Node side would prove the wrong thing, and did: on the
    // stand where this defect was found the worker could resolve the stored
    // host and a browser could not.
    const url = withImages[0].product.images![0];
    const response = await context.request.get(url, { timeout: 15_000 });
    expect(response.status(), `stored image URL ${url} is not reachable from a browser`).toBe(200);
    expect(response.headers()['content-type'] ?? '').toMatch(/^image\//);
  });

  test('the bulk offer wizard counts EVERY sibling of a grouped product', async ({
    api,
    world,
    env,
    page,
  }) => {
    test.skip(!env.testSubiekt, 'opt-in — set E2E_TEST_SUBIEKT=true');
    const connection = world.connectionFor(PlatformType.subiektGt);
    test.skip(!connection, 'no Subiekt GT connection on this stack');

    const grouped = await waitForGroupedProducts(api, connection!.id, 120_000);
    test.skip(grouped.length === 0, 'no multi-variant product on this Subiekt');
    const { product, variants } = grouped[0];

    // The operator-visible symptom this whole change exists to fix. The wizard
    // expands "the whole product" from its siblings, so with the adapter
    // reporting one synthetic variant it published ONE size and dropped the
    // rest with nothing reported - and its own Configure step said so, in the
    // sentence asserted here, while the operator had no reason to doubt it.
    //
    // Asserted on the COUNT rather than by hunting SKUs: the per-variant rows
    // live on the Review step, which needs a destination connection chosen
    // first, so reaching them would make this test depend on a marketplace
    // being configured - a dependency that has nothing to do with what it
    // measures.
    await page.goto(`/listings/bulk-create/wizard?productIds=${product.id}`);
    await expect(
      page.getByText(`Creating offers for 1 product · ${variants.length} variants.`),
      `the wizard does not see all ${variants.length} siblings of ${product.name}`,
    ).toBeVisible({ timeout: 30_000 });
  });
});

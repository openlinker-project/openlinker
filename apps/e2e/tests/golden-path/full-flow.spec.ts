/**
 * Golden path: full business flow (S0-S9)
 *
 * The complete attended golden path across all six systems — PrestaShop,
 * WooCommerce, Allegro, Erli, InPost, KSeF — verifying EVERY parameter and EVERY
 * amount (field-level + amount-level parity), not image pixels.
 *
 * Design (see docs/manual-testing/e2e-golden-path.md):
 *   - Headed, serial, workers:1, retries:0. Segments share module state and run
 *     in order in a single worker.
 *   - Determinism: every async checkpoint = trigger work explicitly (sync job or
 *     UI wizard) then `poll.until(...)` OL state. No blind sleeps.
 *   - Automated field/amount parity via OL REST + PS webservice + WC REST + OL
 *     adapter reads (getOffer / invoice content / shipment). External dashboards
 *     (Allegro / Erli / InPost / KSeF) get a light `manualCheckpoint` visual
 *     confirmation, plus the manual purchase pause.
 *
 * WARNING: MUTATING. Publishes products, creates offers, generates a label, and
 * issues an invoice. Run only in a coordinated attended session against a stack
 * you control — never unattended, never against a shared stack in active use.
 * Invoke explicitly: `--project=full-flow --headed`.
 *
 * @module tests/golden-path
 */
import { resolve } from 'node:path';
import type { TestInfo } from '@playwright/test';
import { test, expect } from '../../src/fixtures/test';
import { PlatformType, type KnownPlatformType, type World } from '../../src/world/world';
import type { E2eEnv } from '../../src/config/env';
import type { ApiClient } from '../../src/api/api-client';
import { ApiError } from '../../src/api/api-error';
import type { PageObjects } from '../../src/pages';
import type { Poller } from '../../src/support/poller';
import type {
  Connection,
  MarketplaceOffer,
  OfferMapping,
  OrderRecord,
  Product,
  ProductVariant,
  SubmittedOfferParameter,
} from '../../src/api/api.types';
import { PrestashopWebserviceClient } from '../../src/api/prestashop-webservice';
import { buildFreshProductImages } from '../../src/api/generate-image';
import { WooCommerceRestClient } from '../../src/api/woocommerce-rest';
import { captureStock, assertStockDelta, waitForStockDelta, type StockSnapshot } from '../../src/support/stock';
import { snapshotOrderIds, waitForOrder, type OrderIdSnapshot } from '../../src/support/orders';
import { narrowOrderSnapshot } from '../../src/support/order-snapshot';
import { manualCheckpoint, manualCheckpointFailures } from '../../src/support/manual-checkpoint';
import { assertTrackingBackfill, waitForTrackingBackfill } from '../../src/support/shipments';
import { PollTimeoutError, pollFailureCause } from '../../src/support/poller';
import {
  assertMarketplaceParameterRoundTrip,
  assertMoneyEqual,
  assertProductFieldParity,
  assertInvoiceAmounts,
  offerToParityView,
  toMinorUnits,
  type ProductParityView,
} from '../../src/support/parity';

const SOLD_QTY = 1;

/** Mutable state shared across the serial segments. */
interface FlowState {
  product?: Product;
  primaryVariant?: ProductVariant;
  variantIds: string[];
  olBaseline?: StockSnapshot;
  channelBaseline: Map<string, number>;
  /** One ingested order per purchase platform (keyed by platformType). */
  orders: Map<string, OrderRecord>;
  /** Pre-purchase order snapshot (ids + timestamp) per source connection id. */
  orderSnapshotByConnection: Map<string, OrderIdSnapshot>;
  shipmentIds: Map<string, string>;
  invoiceIds: Map<string, string>;
  /** WooCommerce product id of the published product, captured in S2 for the post-sale re-read. */
  wcProductId?: number;
}

const state: FlowState = {
  variantIds: [],
  channelBaseline: new Map(),
  orders: new Map(),
  orderSnapshotByConnection: new Map(),
  shipmentIds: new Map(),
  invoiceIds: new Map(),
};

test.describe.configure({ mode: 'serial' });

test.describe('golden path — full flow (S0-S9)', () => {
  // Belt-and-suspenders attended opt-in. The `test:e2e` default script already
  // excludes `full-flow`, and `test:e2e:full-flow` sets E2E_ATTENDED=1 — but a
  // bare `playwright test --project=full-flow` (or a developer running the whole
  // suite by hand) must not silently enter the 2h-per-purchase manual pause.
  // Set E2E_ATTENDED=1 to run this heavily-mutating, human-driven flow.
  test.skip(!process.env.E2E_ATTENDED, 'attended flow — set E2E_ATTENDED=1 to run');

  // Resume mode (`E2E_RESUME_FROM_ORDER`): seed everything S5 onward reads from
  // an order that already exists, so a run that only needs the post-purchase
  // half doesn't pay again for a fresh product, a fresh offer, the ~40-minute
  // wait for it to leave `szkic`, and a second human purchase. A worker hook
  // rather than a lazy seed inside S5, so a bad order id fails the whole group
  // up front instead of surfacing as a confusing mid-flow assertion.
  test.beforeAll(async ({ api, world, env }) => {
    if (!env.resumeFromOrder) return;
    await seedStateFromExistingOrder(api, world, env.resumeFromOrder);
  });

  test('S0 — baseline: sync master catalogue and snapshot stock', async ({ api, world, jobs, poll, env }) => {
    skipWhenResuming(env);
    const prestashop = world.connectionFor(PlatformType.prestashop);
    test.skip(!prestashop, 'no PrestaShop connection on this stack');

    // E3 (opt-in): provision a BRAND-NEW master product BEFORE the catalogue
    // sync, so `master.product.syncAll` imports it and the whole run creates
    // fresh offers/order rather than reusing existing state. The generated SKU
    // becomes the pin, so selection flows through the deterministic pin path.
    let pinnedSku = env.productSku;
    // The real PS category the fresh product lands in — resolved at provision
    // time so S0 can map exactly that category (not the Home default) to Allegro.
    let freshCategoryPsId: string | undefined;
    // Per-combination barcodes of the fresh product, asserted against OL's import
    // below so a silent fall-back to a single synthetic variant can't pass S0.
    let freshVariantEans: string[] = [];
    if (env.freshProduct) {
      const provisioned = await provisionFreshProduct(world, { variantCount: env.freshVariantCount });
      pinnedSku = provisioned.sku;
      freshCategoryPsId = provisioned.prestashopCategoryId;
      freshVariantEans = provisioned.variantEans;
    }

    const job = await jobs.triggerAndWait(
      { connectionId: prestashop!.id, jobType: 'master.product.syncAll' },
      { timeoutMs: 180_000 },
    );
    expect(job.status).toBe('succeeded');

    // Pick the driver product. Default (E1): the first EAN-complete multi-variant
    // product whose primary variant ALSO has an ACTIVE, mapped marketplace offer
    // on the purchase source — a draft/inactive offer would strand S3, the
    // purchase and S5. Falls back to the first EAN-complete multi-variant product
    // when none has an active offer yet (a fresh stack where S3/S4 create them).
    // The flow maps offers and resolves orders by barcode, so an EAN-less pick
    // (demo "Resin Ring") is never chosen. Override with E2E_PRODUCT_SKU to pin a
    // specific product by SKU (single-variant allowed) — the deterministic escape
    // hatch when the heuristic picks a non-purchasable product.
    const source = resolveSourceConnection(world, env.sourcePlatform);
    const product = (await poll.until<Product | undefined>(
      () => pickDriverProduct({ api, world, pinnedSku, source }),
      (p) => !!p,
      {
        message: pinnedSku
          ? `pinned product (SKU ${pinnedSku}) to appear after PrestaShop sync`
          : 'an EAN-complete multi-variant product with an active offer to appear after PrestaShop sync',
        timeoutMs: 60_000,
      },
    ))!;
    if (pinnedSku) {
      expect(product.sku, `pinned product SKU (E2E_PRODUCT_SKU=${pinnedSku})`).toBe(pinnedSku);
    }
    const variants = await world.variantsOf(product.id);
    const primary = variants.find((v) => v.ean ?? v.gtin);
    expect(primary, 'a primary variant with an EAN is required').toBeTruthy();

    // E3: the provisioned product is multi-variant, so OL must have imported one
    // variant per PrestaShop combination with that combination's own barcode.
    // Asserting the EAN SET (not just the count) catches the failure mode where
    // the adapter falls back to a single synthetic, parent-EAN variant.
    if (freshVariantEans.length > 0) {
      const importedEans = variants.map((v) => v.ean ?? v.gtin).filter((e): e is string => !!e);
      expect(
        importedEans.sort(),
        'OL imported one variant per fresh PrestaShop combination, each with its own EAN',
      ).toEqual([...freshVariantEans].sort());
    }

    state.product = product;
    state.primaryVariant = primary;
    state.variantIds = variants.map((v) => v.id);

    // E3: a brand-new product has NO master inventory row until an inventory sync
    // runs. `master.product.syncAll` imports the catalogue only, and
    // `master.inventory.syncAll` does NOT pick up a just-created product, so a
    // targeted `master.inventory.syncByExternalId` is required before the baseline
    // is meaningful (otherwise S1 sees OL master total 0 vs PS stock N).
    if (env.freshProduct) {
      // `product` came from the list endpoint, which omits externalIds — fetch
      // the detail to resolve the PrestaShop external id for the targeted sync.
      const detail = await api.products.getById(product.id);
      const psExternalId = externalIdFor(detail.externalIds, prestashop!.id);
      if (psExternalId) {
        await jobs.triggerAndWait(
          {
            connectionId: prestashop!.id,
            jobType: 'master.inventory.syncByExternalId',
            payload: { externalId: psExternalId, objectType: 'Product' },
          },
          { timeoutMs: 60_000 },
        );
        await poll.until(
          () => api.inventory.availability(state.variantIds),
          (rows) => rows.some((r) => r.totalAvailable > 0),
          {
            message: 'fresh product master availability after inventory sync',
            timeoutMs: 30_000,
          },
        );
      }

      // Operator's PS→Allegro category-mapping step, scripted: a brand-new
      // product lands in a PS category with no destination mapping, so S3's
      // bulk-offer wizard would flag "needs attention" and fail. Mapping that PS
      // category to an Allegro leaf lets S3 resolve the category and create the
      // offer. Erli borrows Allegro's taxonomy (#1045), so this one mapping
      // covers the Erli offer (S4) too.
      const allegroConn = world.connectionFor(PlatformType.allegro);
      if (allegroConn) {
        // Map the REAL category the product was provisioned into (the
        // `env.freshCategoryPsId` default '2'/Home is only an override fallback
        // for a product provisioned outside this flow).
        const sourceCategoryId = freshCategoryPsId ?? env.freshCategoryPsId;
        await api.mappings.upsertCategoryMapping(allegroConn.id, sourceCategoryId, {
          allegroCategoryId: env.freshAllegroCategoryId,
          allegroCategoryName: 'E2E golden-path category',
        });
      }
    }

    state.olBaseline = await captureStock(api, state.variantIds);

    // Every variant has a REAL master-sourced availability row.
    //
    // `>= 0` on the captured snapshot was unfalsifiable: `getAvailabilityByVariantIds`
    // zero-fills an unknown variant with `{totalAvailable: 0, locationCount: 0}` and
    // `captureStock` pre-seeds its map with 0 on top of that, so the old loop passed
    // with `inventory_items` empty - exactly the state the comment claimed to rule
    // out.
    //
    // `locationCount` is NOT the discriminator it appears to be: the repository
    // derives it as `COUNT(DISTINCT inv.locationId)` (`inventory.repository.ts:109`)
    // and the PrestaShop master writes rows with a NULL `locationId`, so a real
    // freshly-synced row reports `{totalAvailable: 25, locationCount: 0}` - this
    // assertion failed on exactly that, live, on 2026-07-30. Nothing this endpoint
    // returns separates "no row" from "a real row holding zero", so the falsifiable
    // check is a POSITIVE quantity: a variant whose inventory never synced reads 0,
    // and a driver product at zero stock cannot be bought by the segments below.
    const baselineRows = await api.inventory.availability(state.variantIds);
    expect(
      baselineRows.filter((row) => row.totalAvailable > 0).map((row) => row.productVariantId).sort(),
      'every variant carries a real (non-zero-filled) master availability row',
    ).toEqual([...state.variantIds].sort());
  });

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

  test('S3 — Allegro offers: create + field/amount parity via OL read', async ({ api, world, pages, poll, env }) => {
    skipWhenResuming(env);
    const testInfo = test.info();
    requireProduct();
    const allegro = world.connectionFor(PlatformType.allegro);
    test.skip(!allegro, 'no Allegro connection on this stack');

    const batchId = await createBulkOffers({ api, world, pages, poll, connectionId: allegro!.id, connectionName: allegro!.name, platform: PlatformType.allegro });
    const mapping = await resolvePrimaryMapping(api, poll, allegro!.id);
    const offer = await api.listings.getOffer(mapping.id);
    state.channelBaseline.set('allegro', offer.availableQuantity);

    // Field parity: price, currency, category id, available quantity via OL's adapter read.
    assertProductFieldParity({
      label: 'OL↔Allegro offer',
      expected: { price: state.product!.price ?? undefined, currency: state.product!.currency ?? 'PLN' },
      actual: offerToParityView(offer),
      // `required: ['price']` - `assertProductFieldParity` skips any field the
      // EXPECTED side does not carry, so a null `state.product.price` silently
      // reduced this parity check to a currency-string comparison. S1 already
      // declares its own `required`; these three call sites did not.
      required: ['price'],
    });

    // Value-level parameter parity (#8): the persisted creation-request snapshot
    // carries the SUBMITTED section-tagged parameter values (#1071 —
    // `request.overrides.parameters`; `platformParams` holds only policy knobs).
    // Only available when THIS run created the offer (batchId set); on the reuse
    // path there is no fresh creation record, so the submitted-side parity is
    // skipped and the marketplace-side round-trip below carries the load.
    let submitted: SubmittedOfferParameter[] = [];
    if (batchId) {
      const batch = await api.listings.getBulkBatch(batchId);
      const record =
        batch.records.find((r) => r.internalVariantId === state.primaryVariant!.id) ??
        batch.records[0];
      expect(record, 'bulk batch exposes a creation record').toBeTruthy();
      const creation = await api.listings.getOfferCreationRecord(allegro!.id, record.id);
      submitted = creation.request?.overrides?.parameters ?? [];

      if (offer.category?.id) {
        const directory = await api.listings.categoryParameters(allegro!.id, offer.category.id);
        expect(directory.length, 'Allegro category exposes parameters').toBeGreaterThan(0);

        const byId = new Map(directory.map((p) => [p.id, p]));
        const attributes = (state.primaryVariant!.attributes ?? {});
        for (const param of submitted) {
          const dirEntry = byId.get(param.id);
          expect(
            dirEntry,
            `submitted parameter ${param.id} exists in the Allegro category directory`,
          ).toBeTruthy();
          if (!dirEntry) continue;
          expect(param.section, `parameter "${dirEntry.name}" section`).toBe(dirEntry.section);
          const carriesValue =
            (param.values?.length ?? 0) > 0 ||
            (param.valuesIds?.length ?? 0) > 0 ||
            !!param.rangeValue;
          expect(carriesValue, `parameter "${dirEntry.name}" carries a submitted value`).toBe(true);
          const masterValue = attributes[dirEntry.name];
          if (typeof masterValue === 'string' && (param.values?.length ?? 0) > 0) {
            expect(
              param.values,
              `parameter "${dirEntry.name}" submitted value matches the master attribute`,
            ).toContain(masterValue);
          }
        }
      }
      if (submitted.length === 0) {
        testInfo.annotations.push({
          type: 'parameter-parity',
          description:
            'creation-request snapshot carries no operator-submitted parameters — value-level ' +
            'parity not applicable for this record (builder-projected values are confirmed via ' +
            'the Allegro manual checkpoint)',
        });
      }
    } else {
      testInfo.annotations.push({
        type: 'reuse',
        description:
          'reused an existing Allegro offer for the driver product (create-if-missing, else ' +
          'reuse) — submitted-parameter parity skipped; marketplace-side round-trip still runs',
      });
    }

    // Marketplace-side round-trip (#1482): the live offer read now carries the
    // parameter values Allegro ACCEPTED. Assert submitted == accepted; on a
    // stack whose API predates #1482 the field is absent — annotate and fall
    // back to the manual checkpoint instead of failing.
    if (offer.parameters !== undefined) {
      expect(
        offer.parameters.length,
        'live Allegro offer carries filled parameters',
      ).toBeGreaterThan(0);
      if (submitted.length > 0) {
        assertMarketplaceParameterRoundTrip('OL↔Allegro', submitted, offer.parameters);
      }
      const condition = offer.parameters.find(
        (p) => p.section === 'offer' && (p.values?.length ?? 0) > 0,
      );
      expect(
        condition,
        'live offer carries at least one filled offer-section parameter (e.g. condition)',
      ).toBeTruthy();
    } else {
      testInfo.annotations.push({
        type: 'parameter-parity',
        description:
          'running API does not expose MarketplaceOffer.parameters (#1482 not deployed) — ' +
          'marketplace-side value parity degraded to the Allegro manual checkpoint',
      });
    }

    await manualCheckpoint(
      testInfo,
      {
        dashboard: 'Allegro seller panel',
        url: 'https://allegro.pl.allegrosandbox.pl/moje-allegro/sprzedaz/oferty',
        expect: [
          'The offer for the primary variant is listed/active',
          'Price, category and every parameter (Brand/Model/condition) match',
          'Available quantity equals the OL baseline',
        ],
        values: {
          offerId: offer.externalId,
          price: `${offer.price.amount} ${offer.price.currency}`,
          availableQuantity: offer.availableQuantity,
          categoryId: offer.category?.id ?? '(unresolved)',
        },
      },
    );
  });

  test('S4 — Erli offers: create + mapping-level assertions (no OfferReader)', async ({ api, world, pages, poll, env }) => {
    skipWhenResuming(env);
    const testInfo = test.info();
    requireProduct();
    const erli = world.connectionFor(PlatformType.erli);
    test.skip(!erli, 'no Erli connection on this stack');
    // Creating Erli offers is only worth its ~5 min and its failure surface when
    // somebody is going to BUY on Erli — the offers exist to be purchased at the
    // pause, and S5-S9 only track the platforms in `purchasePlatforms`. Without
    // this an `E2E_PURCHASE_PLATFORMS=allegro` run still lists on Erli and dies
    // there whenever the sandbox shop is unavailable (Erli disabled it outright
    // on 2026-07-30), taking down a flow that had no Erli assertion to make.
    test.skip(
      !env.purchasePlatforms.includes(PlatformType.erli),
      `Erli is not in E2E_PURCHASE_PLATFORMS (${env.purchasePlatforms.join(', ')}) — nothing would buy these offers`,
    );

    await createBulkOffers({ api, world, pages, poll, connectionId: erli!.id, connectionName: erli!.name, platform: PlatformType.erli, erliCategoryPath: env.freshAllegroCategoryPath });
    const mapping = await resolvePrimaryMapping(api, poll, erli!.id);

    // Mapping-level assertions: the offer was created and mapped to the primary
    // variant with a marketplace-native external id.
    expect(mapping.externalId, 'Erli mapping carries the marketplace offer id').toBeTruthy();
    expect(mapping.internalId, 'Erli mapping targets the primary variant').toBe(
      state.primaryVariant!.id,
    );

    // Capability-guarded live read: the Erli adapter ships no `OfferReader`, so
    // `GET /listings/:id/offer` 422s — degrade to the mapping-level assertions
    // above instead of failing. (Adapter-side OfferReader is a backend follow-up.)
    const offer = await readLiveOfferOrNull(api, mapping.id);
    if (offer) {
      state.channelBaseline.set('erli', offer.availableQuantity);
      assertProductFieldParity({
        label: 'OL↔Erli offer',
        expected: { price: state.product!.price ?? undefined, currency: state.product!.currency ?? 'PLN' },
        actual: offerToParityView(offer),
      // `required: ['price']` - `assertProductFieldParity` skips any field the
      // EXPECTED side does not carry, so a null `state.product.price` silently
      // reduced this parity check to a currency-string comparison. S1 already
      // declares its own `required`; these three call sites did not.
        required: ['price'],
      });
    } else {
      testInfo.annotations.push({
        type: 'capability-degrade',
        description:
          'Erli adapter has no OfferReader — live-offer parity degraded to mapping-level ' +
          'assertions; price/qty/category confirmed via the Erli manual checkpoint',
      });
    }

    const masterAvailability = state.olBaseline!.get(state.primaryVariant!.id);
    await manualCheckpoint(testInfo, {
      dashboard: 'Erli seller panel / storefront',
      expect: [
        'The offer is published (borrowed Allegro taxonomy)',
        'Price and category match the master',
        'Available quantity equals the OL master availability below',
      ],
      values: {
        offerId: mapping.externalId,
        expectedPrice: `${state.product!.price ?? '(master)'} ${state.product!.currency ?? 'PLN'}`,
        expectedAvailability: masterAvailability ?? '(unknown)',
      },
    });
  });

  test('PAUSE — operator buys the named offer (one stop per purchase platform)', async ({ api, world, env }) => {
    skipWhenResuming(env);
    const testInfo = test.info();
    requireProduct();
    const sources = resolvePurchaseSources(world, env.purchasePlatforms);
    test.skip(sources.length === 0, 'no marketplace source connection to buy from');

    // Snapshot BEFORE the first purchase so each source's "new order"
    // detection is clean regardless of when the operator checks out.
    for (const source of sources) {
      state.orderSnapshotByConnection.set(source.id, await snapshotOrderIds(api, source.id));
    }

    for (const source of sources) {
      await manualCheckpoint(testInfo, {
        dashboard: `MANUAL PURCHASE — ${source.platformType}`,
        expect: [
          `Buy exactly ${SOLD_QTY} unit of the primary-variant offer on ${source.platformType}`,
          'If the offer shows as draft/inactive on the marketplace, activate it in the seller panel first ' +
            '(a fresh Allegro offer may finish sandbox verification inactive, #1520)',
          'At checkout choose InPost Paczkomat (pickup point) delivery — S6 dispatches the label with pickup_point intent',
          'Pick a locker that EXISTS in the InPost sandbox — Allegro-sandbox lockers often do not; ' +
            'if the buyer-selected point turns out unusable, set E2E_PACZKOMAT_ID to a real ' +
            'InPost-sandbox APM before S6 runs',
          'Complete checkout so the order reaches the marketplace',
          '[OPTIONAL, #1574] To exercise non-trivial-order coverage, feel free to add a second ' +
            'line item and/or a discount to ONE purchase, and/or check out as a company buyer ' +
            'with a NIP — see extensionMultiLineOrDiscount/extensionNipBuyer below for details',
          'Then resume — the next purchase stop (if any) follows immediately',
        ],
        values: {
          marketplace: source.platformType,
          product: state.product!.name,
          primaryVariantSku: state.primaryVariant!.sku,
          primaryVariantEan: state.primaryVariant!.ean ?? state.primaryVariant!.gtin,
          quantity: SOLD_QTY,
          delivery: 'InPost Paczkomat (pickup point)',
          paczkomatOverride: env.paczkomatId ?? '(none — E2E_PACZKOMAT_ID unset)',
          // #1574 extension hints — optional, do not change the required
          // purchase count/quantity above. See the bullets below.
          extensionMultiLineOrDiscount:
            'OPTIONAL (#1574): add a second line item and/or apply a marketplace ' +
            'discount/coupon on ONE of the purchases to exercise buyer-paid pricing ' +
            '(ADR-014) end-to-end for a non-trivial order — S5x/S7/S8 assert generically ' +
            'over however many lines the order actually has, no extra purchase needed',
          extensionNipBuyer:
            'OPTIONAL (#1574): check out as a company/business buyer with a tax id (NIP) ' +
            'on ONE of the purchases — S8x reads the issued invoice\'s buyer tax id back',
        },
        // Genuinely fatal: nothing downstream (S5-S9) can run without the purchase.
        severity: 'fatal',
        // A manual storefront purchase routinely exceeds the default 30-minute
        // window (a prior run expired mid-checkout) — give the operator 2 hours.
        timeoutMs: 120 * 60_000,
      });
    }
  });

  test('S5 — orders ready in OL + channel stock down', async ({ api, world, jobs, poll, env }) => {
    const testInfo = test.info();
    requireProduct();
    // A resumed run is scoped to the ONE order it was handed, so the purchase
    // sources are whatever that order actually came from — NOT the configured
    // `E2E_PURCHASE_PLATFORMS` list, which describes a purchase this run never
    // made and would strand the loop waiting on a second, non-existent order.
    const sources = env.resumeFromOrder
      ? resolveResumedSources(world)
      : resolvePurchaseSources(world, env.purchasePlatforms);
    expect(sources.length, 'a marketplace source connection is required').toBeGreaterThan(0);

    for (const source of sources) {
      let order: OrderRecord;
      if (env.resumeFromOrder) {
        // The order exists by definition here, so there is no arrival to
        // detect: re-read and VERIFY the one this run was handed rather than
        // burning `waitForOrder`'s 15-minute budget on an event already fired.
        order = await api.orders.getById(state.orders.get(source.platformType)!.internalOrderId);
        assertResumedOrderUsable(order, source, env, testInfo);
      } else {
        // Nudge ingestion, then wait for a new ready order (webhook or poll heals it).
        await jobs.trigger({ connectionId: source.id, jobType: 'marketplace.orders.poll' }).catch(() => undefined);
        order = await waitForOrder(api, {
          sourceConnectionId: source.id,
          snapshot: state.orderSnapshotByConnection.get(source.id),
        });
      }
      state.orders.set(source.platformType, order);

      // Amount parity: order line price/qty + totals + shipping.
      const snapshot = readOrderSnapshot(order);
      const currency = snapshot.totals.currency;
      const soldLine = requireDriverLine(snapshot, source.platformType);
      expect(soldLine.quantity, `sold quantity (${source.platformType})`).toBe(SOLD_QTY);

      // The per-line `lineTotal === price * qty` check that used to live here was
      // an identity between two spellings of the same expression - no order field
      // was read on the right-hand side, so a source adapter emitting a
      // mis-multiplied or double-discounted line total passed it. The subtotal
      // fold below is the real check: it derives the subtotal from the lines and
      // compares it against the total the ORDER reports.
      const computedSubtotal = snapshot.items.reduce(
        (sum, i) => sum + toMinorUnits(i.price, currency) * i.quantity,
        0,
      );

      // Total identity is tax-treatment-aware: with `inclusive` line prices the
      // computed subtotal already carries the tax, so adding `totals.tax` again
      // would double-count it; with `exclusive` prices the tax is additive.
      // (Absent treatment defaults to inclusive — both source adapters emit
      // buyer-paid gross prices.)
      const treatment = snapshot.totals.taxTreatment ?? 'inclusive';
      const taxMinor = toMinorUnits(snapshot.totals.tax ?? 0, currency);
      const shippingMinor = toMinorUnits(snapshot.totals.shipping ?? 0, currency);
      const expectedTotalMinor =
        treatment === 'exclusive'
          ? computedSubtotal + taxMinor + shippingMinor
          : computedSubtotal + shippingMinor;
      expect(
        toMinorUnits(snapshot.totals.total, currency),
        `order total identity (${treatment} tax treatment, ${source.platformType})`,
      ).toBe(expectedTotalMinor);

      // Channel stock delta: the SOURCE marketplace offer went down by SOLD_QTY.
      // This is the marketplace's OWN native decrement (it sold a unit) read
      // back through OL — NOT OL propagating a stock change to it. OL-driven
      // cross-channel write-back to the OTHER marketplaces is what S9's
      // propagation step exercises; here we only observe the selling channel
      // reflecting its own sale.
      const sourceKey = source.platformType;
      const channelBefore = state.channelBaseline.get(sourceKey);
      if (channelBefore !== undefined) {
        const mapping = await resolvePrimaryMapping(api, poll, source.id);
        // Poll for `<=` (not strict equality): on a dual-purchase run, ambient
        // inventory propagation can fold the OTHER marketplace's sale into this
        // channel before S9 runs, so `===` could never converge and would burn
        // the whole 120 s timeout. The exact value is asserted afterwards, so
        // any unexpected overshoot fails FAST with the observed quantity — only
        // the documented dual-purchase fold-in is tolerated (and annotated).
        const target = channelBefore - SOLD_QTY;
        const floor = channelBefore - SOLD_QTY * sources.length;
        const settled = await poll.until(
          () => api.listings.getOffer(mapping.id),
          (o) => o.availableQuantity <= target,
          {
            message: `${sourceKey} offer quantity to drop to at most ${target}`,
            timeoutMs: 120_000,
          },
        );
        if (settled.availableQuantity !== target) {
          expect(
            settled.availableQuantity,
            `${sourceKey} offer quantity after the sale (observed ${settled.availableQuantity}; ` +
              `only the dual-purchase cross-channel fold-in to ${floor} is tolerated before S9)`,
          ).toBe(floor);
          testInfo.annotations.push({
            type: 'channel-stock',
            description:
              `${sourceKey} offer already reflects every purchase (${settled.availableQuantity} = ` +
              `baseline ${channelBefore} - total sold) — ambient propagation folded in the other ` +
              'marketplace sale before S9',
          });
        }
      } else if (env.resumeFromOrder) {
        // Only annotate on the resume path: a full run legitimately reaches
        // here with no baseline too (Erli ships no OfferReader, so S4 captures
        // none), and adding an annotation there would change its report.
        testInfo.annotations.push({
          type: 'resume-degrade',
          description:
            `${sourceKey}: channel stock delta NOT CHECKED — the offer quantity BEFORE the sale ` +
            'is a pre-purchase reading a resumed run cannot observe, and the marketplace has ' +
            'already decremented it, so no honest delta is derivable after the fact',
        });
      }
    }
  });

  test('S6 — InPost labels: routing, tracking, PDF, dispatched (per order)', async ({ api, world, env, poll, jobs }) => {
    const testInfo = test.info();
    requireOrder();
    const inpost = world.connectionFor(PlatformType.inpost);
    test.skip(!inpost, 'no InPost connection on this stack');

    const shipmentSummaries: string[] = [];
    for (const [platform, order] of state.orders) {
      const source = world.connectionFor(platform);
      expect(source, `source connection for the ${platform} order`).toBeTruthy();

      // Ensure a routing rule maps the source delivery method to OL-managed InPost.
      const snapshot = readOrderSnapshot(order);
      const deliveryMethodId = snapshot.shipping?.methodId ?? 'default';
      // Deliberately unguarded: the PUT below is a full replace and this read
      // supplies the rules it preserves, so swallowing a transient failure into
      // `[]` would silently delete the operator's whole routing matrix for this
      // source connection - with no visible symptom, since a rule-less order
      // just routes to the `omp_fulfilled` default. Same reasoning as
      // `ensureCarrierRouting` in `src/support/shipments.ts`.
      const existing = await api.routingRules.list(source!.id);
      if (!existing.some((r) => r.sourceDeliveryMethodId === deliveryMethodId)) {
        await api.routingRules.replace(source!.id, [
          ...existing.map((r) => ({
            sourceDeliveryMethodId: r.sourceDeliveryMethodId,
            processorKind: r.processorKind,
            processorConnectionId: r.processorConnectionId,
          })),
          { sourceDeliveryMethodId: deliveryMethodId, processorKind: 'ol_managed_carrier', processorConnectionId: inpost!.id },
        ]);
      }

      // `E2E_PACZKOMAT_ID` overrides the buyer-selected pickup point when it is
      // unusable (Allegro-sandbox lockers are known not to exist in the InPost
      // sandbox); otherwise the point resolved from the order is used.
      //
      // `recipient` and `parcel.template` are mandatory in practice: the dispatch
      // service forwards both verbatim to the carrier mapper with no server-side
      // derivation from the order, and omitting either 500s (TypeError) or 502s
      // (preflight) instead of being defaulted (#1518). Derive the recipient from
      // the order snapshot the way an operator-facing UI would.
      const recipientAddress = snapshot.shippingAddress ?? {};
      const dispatch = await api.shipments.generateLabel({
        sourceConnectionId: source!.id,
        sourceDeliveryMethodId: deliveryMethodId,
        orderId: order.internalOrderId,
        deliveryIntent: 'pickup_point',
        recipient: {
          firstName: recipientAddress.firstName,
          lastName: recipientAddress.lastName,
          email: snapshot.customerEmail,
          phone: recipientAddress.phone,
        },
        parcel: { template: 'small' },
        // Same "no server-side derivation" rule as `recipient` / `parcel` above:
        // OL ingests the buyer-selected locker onto the order
        // (`orderSnapshot.pickupPoint.id`) but the dispatch preflight does NOT
        // read it, so a caller that omits `paczkomatId` gets
        // `502 preflight.missing-paczkomat-id` even though OL knows the locker.
        // Derive it from the order the way an operator-facing UI would, and let
        // `E2E_PACZKOMAT_ID` override when the buyer's point is unusable
        // (Allegro-sandbox lockers are not always real InPost-sandbox APMs).
        ...(env.paczkomatId ?? snapshot.pickupPoint?.id
          ? { paczkomatId: env.paczkomatId ?? snapshot.pickupPoint!.id! }
          : {}),
      });
      const shipment = dispatch.shipment ?? (await api.shipments.active(order.internalOrderId));
      expect(shipment, `a shipment was created for the ${platform} order`).toBeTruthy();
      state.shipmentIds.set(platform, shipment!.id);

      // ShipX renders the label document asynchronously — a fetch immediately
      // after create can fail even though the shipment is already `generated`,
      // so poll briefly instead of asserting the first response.
      await poll.until(
        () => api.shipments.getLabel(shipment!.id),
        (l) => l.ok && l.byteLength > 0,
        { message: `label PDF to become retrievable (${platform})`, timeoutMs: 60_000, intervalMs: 5_000 },
      );

      await api.shipments.notifyDispatched(shipment!.id).catch(() => undefined);
      const dispatched = await api.shipments.getById(shipment!.id);
      expect(['dispatched', 'in-transit', 'delivered']).toContain(dispatched.status);

      // Tracking-number backfill (#1521). The ShipX sandbox mints the tracking
      // number only once the shipment is confirmed and the carrier-generic
      // `marketplace.shipment.statusSync` poll (#838) has run — it is NOT present
      // right after label creation. Drive that poll and wait, with a bounded
      // budget, for OL to backfill `Shipment.trackingNumber` (the #1426 path).
      //
      // The classification lives in `assertTrackingBackfill` (shared with
      // tests/shipping/tracking-backfill.spec.ts): a timeout while the carrier
      // has ALREADY moved the parcel is a backfill regression and throws; only
      // the documented not-yet-confirmed sandbox state degrades to an
      // annotation, so an attended run is not failed by a sandbox-side delay
      // (see docs/manual-testing/e2e-golden-path.md).
      const backfill = await waitForTrackingBackfill(
        api,
        jobs,
        { shipmentId: shipment!.id, inpostConnectionId: inpost!.id },
        { timeoutMs: 120_000, intervalMs: 5_000 },
      );
      const unverifiedTracking = assertTrackingBackfill(backfill, platform);
      if (unverifiedTracking) {
        testInfo.annotations.push({ type: 'tracking', description: unverifiedTracking });
      }

      // Writeback to the marketplace is best-effort in code (annotated) and
      // asserted by the operator at the checkpoint below.
      testInfo.annotations.push({
        type: 'writeback',
        description: `${platform}: tracking ${backfill.trackingNumber ?? '(pending)'} — marketplace writeback verified via checkpoint`,
      });
      shipmentSummaries.push(
        `${platform}: shipment ${shipment!.id}, tracking ${backfill.trackingNumber ?? '(pending)'}, status ${dispatched.status}`,
      );
    }

    await manualCheckpoint(testInfo, {
      dashboard: 'InPost / ShipX manager + source marketplace orders',
      expect: [
        'Each shipment below exists with its tracking number',
        'Labels are downloadable and statuses are dispatched',
        'Each source order shows the shipped status and/or its tracking number (status/tracking writeback)',
      ],
      values: { shipments: shipmentSummaries.join(' | ') },
    });
  });

  test('S7 — orders created in PrestaShop + master stock down', async ({ api, world, jobs, poll, env }) => {
    const testInfo = test.info();
    requireOrder();
    const prestashop = world.connectionFor(PlatformType.prestashop);
    test.skip(!prestashop, 'no PrestaShop destination connection');

    // Wait for the destination sync to PrestaShop to complete — one PS order
    // per marketplace purchase. PS-side line/total parity per order runs below.
    const psSyncByPlatform = new Map<string, { externalOrderId: string | null }>();
    for (const [platform, order] of state.orders) {
      // A resumed run inherits whatever destination-sync verdict the order
      // already carries, and OL never retries a failed one on its own — so a
      // stale failure (a since-fixed connection URL, an expired secret) would
      // make the poll below burn its full budget waiting for a state that can
      // no longer change. Re-drive ingestion first: `syncOrderFromSource` is
      // idempotent per (order, destination) under a lock (#906/#909), so this
      // re-attempts the destination write without duplicating the order. A
      // normal run needs no nudge — the sync it is waiting for is the one that
      // ingestion just kicked off.
      if (env.resumeFromOrder) {
        const source = world.connections.find((c) => c.id === order.sourceConnectionId);
        const externalOrderId = readOrderSnapshot(order).orderNumber;
        if (source && externalOrderId) {
          await jobs
            .triggerAndWait({
              connectionId: source.id,
              jobType: 'marketplace.order.sync',
              payload: { externalOrderId },
            })
            .catch(() => undefined);
        }
      }
      const synced = await poll.until(
        () => api.orders.getById(order.internalOrderId),
        (o) => o.syncStatus.some((s) => s.destinationConnectionId === prestashop!.id && s.status === 'synced'),
        { message: `the ${platform} order to sync to PrestaShop`, timeoutMs: 180_000 },
      );
      const psSync = synced.syncStatus.find((s) => s.destinationConnectionId === prestashop!.id);
      expect(psSync?.externalOrderId, `PrestaShop external order id (${platform} order)`).toBeTruthy();
      psSyncByPlatform.set(platform, { externalOrderId: psSync!.externalOrderId ?? null });
    }

    // Drive the master-stock refresh explicitly (PS decremented on order
    // create; OL only sees it after a master inventory sync) instead of waiting
    // on ambient scheduling, then wait for the delta.
    await jobs.triggerAndWait(
      { connectionId: prestashop!.id, jobType: 'master.inventory.syncAll' },
    );
    // The master delta is the SUM of every marketplace sale (one PS order each).
    // A resumed run has no pre-purchase baseline to subtract from (see
    // `E2E_RESUME_FROM_ORDER`), and the only value it could invent — the
    // post-sale reading plus the sold quantity — would make this assertion
    // compare a number against itself. Record what went unchecked instead.
    if (state.olBaseline) {
      await waitForStockDelta(api, state.olBaseline, {
        variantId: state.primaryVariant!.id,
        soldQty: SOLD_QTY * state.orders.size,
      });
    } else {
      const observed = await captureStock(api, [state.primaryVariant!.id]);
      testInfo.annotations.push({
        type: 'resume-degrade',
        description:
          'OL master stock delta NOT CHECKED — the pre-purchase master availability is ' +
          'unobservable in a resumed run; the PrestaShop order parity below still runs ' +
          `(observed availability for ${state.primaryVariant!.id}: ` +
          `${observed.get(state.primaryVariant!.id) ?? '(none)'})`,
      });
    }

    // PrestaShop order parity (webservice), when the key is available: totals,
    // shipping, and the sold line (qty + buyer-paid unit price, ADR-014).
    const ps = buildPrestashopClient(world);
    if (ps) {
      for (const [platform, order] of state.orders) {
        const psExternalOrderId = psSyncByPlatform.get(platform)?.externalOrderId;
        if (!psExternalOrderId) continue;
        const psOrder = await ps.getOrder(psExternalOrderId);
        const snapshot = readOrderSnapshot(order);
        const currency = snapshot.totals.currency;

        // Fail loudly when PS omits the paid total — a silent skip here would
        // pass the segment without ever comparing an amount.
        expect(
          psOrder.totalPaidTaxIncl,
          `PrestaShop order exposes total_paid_tax_incl (${platform})`,
        ).toBeTruthy();
        assertMoneyEqual(
          snapshot.totals.total,
          psOrder.totalPaidTaxIncl!,
          currency,
          `PS order total (tax incl) vs OL order total (${platform})`,
        );
        assertMoneyEqual(
          snapshot.totals.shipping ?? 0,
          psOrder.totalShippingTaxIncl ?? 0,
          currency,
          `PS order shipping (tax incl) vs OL order shipping (${platform})`,
        );

        // Line items: the sold line exists with matching quantity and the
        // buyer-paid unit price.
        expect(psOrder.rows.length, `PS order carries line rows (${platform})`).toBeGreaterThan(0);
        const soldLine = requireDriverLine(snapshot, platform);
        const soldEan = state.primaryVariant!.ean ?? state.primaryVariant!.gtin;
        // Fall back to `rows[0]` ONLY when no PS row carries a barcode at all
        // (an older order, or a product whose combinations predate EAN entry).
        // Falling back while other rows DO carry barcodes would compare the
        // driver line against an unrelated product's row and still pass.
        const matchedRow = soldEan
          ? psOrder.rows.find((r) => r.productEan13 === soldEan)
          : undefined;
        const anyRowCarriesEan = psOrder.rows.some((r) => !!r.productEan13);
        if (soldEan && anyRowCarriesEan) {
          expect(
            matchedRow,
            `PS order carries a row for the driver EAN ${soldEan} (${platform}) - ` +
              `rows present: ${JSON.stringify(psOrder.rows.map((r) => r.productEan13))}`,
          ).toBeTruthy();
        }
        const psRow = matchedRow ?? psOrder.rows[0];
        expect(psRow.productQuantity, `PS line quantity (${platform})`).toBe(soldLine.quantity);
        if (psRow.unitPriceTaxIncl !== null) {
          assertMoneyEqual(
            soldLine.price,
            psRow.unitPriceTaxIncl,
            currency,
            `PS line unit price (buyer-paid source price, ADR-014, ${platform})`,
          );
        }
      }
    }
  });

  test('S8 — KSeF: issue → reconcile → accepted, number, UPO, FA(3) XML', async ({ api, world, jobs, poll }) => {
    const testInfo = test.info();
    requireOrder();
    const ksef = world.connectionFor(PlatformType.ksef);
    test.skip(!ksef, 'no KSeF connection on this stack');

    // Issue one invoice per marketplace order via POST /invoices (the server
    // assembles lines/buyer from the order). Idempotent — reuse if already issued.
    for (const [platform, order] of state.orders) {
      let invoice = await api.invoices.getForOrder(order.internalOrderId, ksef!.id).catch(() => null);
      if (!invoice) {
        await api.invoices.issue({
          connectionId: ksef!.id,
          orderId: order.internalOrderId,
        });
        invoice = await poll.until(
          () => api.invoices.getForOrder(order.internalOrderId, ksef!.id),
          (r) => r.status === 'issued' || r.status === 'issuing',
          { message: `invoice to be issued (${platform} order)`, timeoutMs: 180_000 },
        );
      }
      state.invoiceIds.set(platform, invoice.id);
    }

    // Reconcile clearance until accepted with a KSeF number. The reconcile
    // handler is schema-strict: it throws (job retries to dead) unless the
    // payload carries `schemaVersion: 1`. KSeF clearance is asynchronous and a
    // single reconcile pass right after issue routinely runs BEFORE the
    // authority clears the document, so re-trigger the (idempotent) reconcile
    // on every poll iteration instead of relying on the 30-minute cron.
    const invoiceSummaries: string[] = [];
    for (const [platform, order] of state.orders) {
      const invoiceId = state.invoiceIds.get(platform)!;
      const cleared = await poll.until(
        async () => {
          await jobs
            .trigger({
              connectionId: ksef!.id,
              jobType: 'invoicing.regulatoryStatus.reconcile',
              payload: { schemaVersion: 1 },
            })
            .catch(() => undefined);
          return api.invoices.getById(invoiceId);
        },
        (r) => r.regulatoryStatus === 'accepted' && !!r.clearanceReference,
        { message: `invoice to reach accepted + KSeF number (${platform})`, timeoutMs: 300_000, intervalMs: 10_000 },
      );
      expect(cleared.clearanceReference, `KSeF number (${platform})`).toBeTruthy();
      expect(cleared.documentType, `invoice document type recorded (${platform})`).toBeTruthy();

      // Amount parity: expected per-line gross derived from the ORDER snapshot
      // (buyer-paid price × qty) — matched by gross containment. Totals gross
      // should equal the order total, but the invoice currently omits the
      // order's shipping line (#1517, OPEN) — when the mismatch is EXACTLY the
      // shipping amount, annotate the known gap and still assert the item
      // lines; any other mismatch fails.
      const content = await api.invoices.getContent(invoiceId);
      const snapshot = readOrderSnapshot(order);
      const currency = snapshot.totals.currency;
      const treatment = snapshot.totals.taxTreatment ?? 'inclusive';
      const expectedLines =
        treatment === 'inclusive'
          ? snapshot.items.map((i) => ({ gross: Number(i.price) * i.quantity }))
          : undefined; // exclusive line prices are net — gross per line is not derivable here
      const shippingMinor = toMinorUnits(snapshot.totals.shipping ?? 0, currency);
      const grossGapMinor =
        toMinorUnits(snapshot.totals.total, currency) - toMinorUnits(content.totals.gross, currency);
      if (shippingMinor > 0 && grossGapMinor === shippingMinor) {
        testInfo.annotations.push({
          type: 'known-gap',
          description:
            `#1517 (${platform}): invoice gross ${content.totals.gross} omits the order shipping ` +
            `${snapshot.totals.shipping} (order total ${snapshot.totals.total})`,
        });
        assertInvoiceAmounts(
          { currency, ...(expectedLines ? { lines: expectedLines } : {}) },
          content,
        );
      } else {
        assertInvoiceAmounts(
          {
            currency,
            ...(expectedLines ? { lines: expectedLines } : {}),
            totals: { gross: snapshot.totals.total },
          },
          content,
        );
      }
      expect(content.lines.length, `invoice has lines (${platform})`).toBeGreaterThan(0);

      // UPO + source FA(3) XML retrievable.
      const upo = await api.invoices.getUpo(invoiceId);
      expect(upo.ok && upo.byteLength > 0, `UPO retrievable (${platform})`).toBe(true);
      const xml = await api.invoices.getSourceDocument(invoiceId);
      expect(xml.ok && xml.byteLength > 0, `FA(3) source XML retrievable (${platform})`).toBe(true);

      invoiceSummaries.push(
        `${platform}: ${cleared.clearanceReference} (${cleared.documentType}, gross ${content.totals.gross} ${content.currency})`,
      );
    }

    await manualCheckpoint(testInfo, {
      dashboard: 'KSeF test environment',
      expect: ['Each invoice is visible with its KSeF number below', 'Amounts (net/VAT/gross) match the orders'],
      values: { invoices: invoiceSummaries.join(' | ') },
    });
  });

  test('S9 — final reconciliation: stock, cross-channel propagation, statuses', async ({ api, world, jobs, poll, env }) => {
    const testInfo = test.info();
    requireOrder();
    const totalSold = SOLD_QTY * state.orders.size;
    // OL master stock delta holds — the SUM of every marketplace sale. Absent
    // on the resume path for the same reason as S7: there is no pre-purchase
    // baseline to subtract from, and inventing one from the post-sale reading
    // would assert a number against itself.
    const current = await captureStock(api, state.variantIds);
    if (state.olBaseline) {
      assertStockDelta(state.olBaseline, current, { variantId: state.primaryVariant!.id, soldQty: totalSold });
    } else {
      testInfo.annotations.push({
        type: 'resume-degrade',
        description:
          'OL master stock delta NOT CHECKED — no pre-purchase baseline exists in a resumed ' +
          `run (observed availability for ${state.primaryVariant!.id}: ` +
          `${current.get(state.primaryVariant!.id) ?? '(none)'})`,
      });
    }

    // Every order is ready and synced to at least one destination.
    for (const [platform, tracked] of state.orders) {
      const order = await api.orders.getById(tracked.internalOrderId);
      expect(order.recordStatus, `${platform} order record status`).toBe('ready');
      expect(
        order.syncStatus.some((s) => s.status === 'synced'),
        `${platform} order synced to a destination`,
      ).toBe(true);
    }

    // Cross-channel propagation (#14): push the post-sale master availability
    // to EVERY mapped marketplace offer — buying on one channel must drop the
    // other channels too — then verify each channel that OL can read back.
    const anchor = world.connections.find((c) => c.status === 'active') ?? world.connections[0];
    expect(anchor, 'a connection to anchor the propagation job on').toBeTruthy();
    await jobs.triggerAndWait(
      {
        connectionId: anchor.id,
        jobType: 'inventory.propagateToMarketplaces',
        payload: {
          productId: state.product!.id,
          variantId: state.primaryVariant!.id,
          inventoryUpdatedAt: new Date().toISOString(),
        },
      },
    );

    const expectedChannelQty = new Map<string, number>();
    for (const [platform, baseline] of state.channelBaseline) {
      if (platform !== 'woocommerce') expectedChannelQty.set(platform, baseline - totalSold);
    }
    for (const platform of [PlatformType.allegro, PlatformType.erli]) {
      const connection = world.connectionFor(platform);
      if (!connection) continue;
      // S4 only lists on a destination that someone will buy from
      // (`E2E_PURCHASE_PLATFORMS`), so a platform outside that set has no offer
      // for this product and `resolvePrimaryMapping` would poll a mapping that
      // was never going to exist. Skipping costs real coverage — propagating a
      // sale to a channel that did NOT sell is the point of this check — so say
      // so on the report rather than passing quietly.
      if (!env.purchasePlatforms.includes(platform)) {
        testInfo.annotations.push({
          type: 'cross-channel',
          description:
            `${platform} has no offer this run (not in E2E_PURCHASE_PLATFORMS) — ` +
            'post-sale propagation to a non-selling channel went UNVERIFIED',
        });
        continue;
      }
      const mapping = await resolvePrimaryMapping(api, poll, connection.id);
      const offer = await readLiveOfferOrNull(api, mapping.id);
      const expectedQty = expectedChannelQty.get(platform);
      if (offer === null) {
        testInfo.annotations.push({
          type: 'cross-channel',
          description:
            `${platform} offer ${mapping.externalId} is not readable through OL (no OfferReader) — ` +
            'verify the post-sale quantity on the marketplace dashboard manually',
        });
        continue;
      }
      if (expectedQty === undefined) {
        testInfo.annotations.push({
          type: 'cross-channel',
          description: `${platform}: no pre-sale baseline captured — observed quantity ${offer.availableQuantity}`,
        });
        continue;
      }
      // Poll for `<=` then assert exact: an overshoot below the fully-converged
      // value is a genuine error and must fail fast with the observed quantity,
      // not burn the 120 s timeout on a predicate that can never hold.
      const settled = await poll.until(
        () => api.listings.getOffer(mapping.id),
        (o) => o.availableQuantity <= expectedQty,
        {
          message: `${platform} offer quantity to reach at most ${expectedQty} after cross-channel propagation`,
          timeoutMs: 120_000,
        },
      );
      expect(
        settled.availableQuantity,
        `${platform} offer quantity after cross-channel propagation`,
      ).toBe(expectedQty);
    }

    // WooCommerce stock re-check after the purchase (#14): the S2 baseline is
    // read back through the WC REST API. #1498 added base-port quantity
    // write-back on woocommerce.restapi.v3 (WooCommerceOfferManagerAdapter,
    // OfferManager) via ShopProduct mappings — but it is default-OFF on new
    // connections and mutually exclusive with InventoryMaster per connection.
    // In the golden path the WC connection is the master catalogue
    // (InventoryMaster), so write-back is not active on it and a stale value is
    // annotated as expected rather than failed. Exercising the write-back delta
    // needs a dedicated non-master WC connection with write-back enabled — a
    // Phase-2 follow-up, not part of this master-catalogue flow.
    const wc = buildWooClient(world);
    const wcBaseline = state.channelBaseline.get('woocommerce');
    if (wc && wcBaseline !== undefined && state.wcProductId !== undefined) {
      // Re-read by the WC product id captured in S2 — a stable handle that holds
      // regardless of whether the publisher set a SKU on this stack.
      const wcProduct = await wc.getProduct(state.wcProductId);
      const wcAfter = wcProduct?.stockQuantity ?? null;
      // Expected against the run's TOTAL sold (one sale per purchase platform),
      // not a single SOLD_QTY — a dual-purchase run drops WC stock twice once a
      // write-back path exists.
      const wcExpected = wcBaseline - totalSold;
      testInfo.annotations.push({
        type: 'cross-channel',
        description:
          wcAfter === wcExpected
            ? `WooCommerce stock reflects the sale: ${wcAfter} (baseline ${wcBaseline} - sold ${totalSold})`
            : `WooCommerce stock after sale: ${wcAfter ?? '(unknown)'} (baseline ${wcBaseline}, ` +
              `expected ${wcExpected}) - WC quantity write-back (#1498) is default-OFF and ` +
              'mutually exclusive with InventoryMaster, so it is not active on this master-catalogue ' +
              'WC connection; not a failure (write-back delta is a Phase-2 follow-up)',
      });
    } else if (env.resumeFromOrder) {
      testInfo.annotations.push({
        type: 'resume-degrade',
        description:
          'WooCommerce post-sale stock NOT CHECKED — S2 (which publishes the product, records ' +
          'its WC id and reads the pre-sale quantity) does not run in a resumed run, so there ' +
          'is neither a WC product handle nor a baseline to compare against',
      });
    }
  });

  // ── #1574 extensions ────────────────────────────────────────────────────
  // Everything below is an ADDITIVE extension for issue #1574. Each step is a
  // clearly-named, standalone test that reuses S0-S9 state (`state.orders`,
  // `state.shipmentIds`, …) and the same local helpers — none of it edits the
  // S0-S9 bodies above. See the PAUSE step's `extensionMultiLineOrDiscount` /
  // `extensionNipBuyer` operator hints for how S5x/S8x get real content to
  // check without staging an extra purchase.

  test('S6x — ADR-027 status writeback: explicit source-marketplace checkpoint (extension, #1574)', async ({
    world,
  }, testInfo) => {
    requireOrder();
    // S6 already prompts for this as one bullet among several; this step
    // exists so the writeback confirmation is its own auditable checkpoint
    // (own pass/fail annotation) rather than folded into S6's broader label
    // confirmation. No OL API can read an Allegro/Erli order's status back —
    // the relay (`OrderLifecycleRelayService`, ADR-027) is fire-and-forget
    // with no queryable result surface, so this stays an operator
    // confirmation against the real marketplace order pages.
    const summaries: string[] = [];
    for (const [platform] of state.orders) {
      const source = world.connectionFor(platform);
      const shipmentId = state.shipmentIds.get(platform);
      summaries.push(`${platform}: source connection ${source?.id ?? '(unknown)'}, shipment ${shipmentId ?? '(none)'}`);
    }
    await manualCheckpoint(testInfo, {
      dashboard: 'Source marketplace order pages (Allegro / Erli)',
      expect: [
        'Open each source order listed below on its OWN marketplace (not PrestaShop)',
        'The order shows a SHIPPED/DISPATCHED status (or equivalent)',
        'The order shows the InPost tracking number recorded in S6',
      ],
      values: { orders: summaries.join(' | ') },
    });
  });

  test('S8x — buyer tax id (NIP) on the invoice, best-effort (extension, #1574)', async ({ api }, testInfo) => {
    requireOrder();
    let checked = 0;
    for (const [platform, invoiceId] of state.invoiceIds) {
      const content = await api.invoices.getContent(invoiceId);
      if (content.buyer.taxId && content.buyer.taxId.value.trim().length > 0) {
        checked += 1;
        expect(content.buyer.taxId.scheme, `${platform} invoice buyer tax id scheme`).toBeTruthy();
        testInfo.annotations.push({
          type: 'buyer-tax-id',
          description: `${platform}: buyer tax id present (${content.buyer.taxId.scheme}: ${content.buyer.taxId.value})`,
        });
      }
    }
    if (checked === 0) {
      testInfo.annotations.push({
        type: 'buyer-tax-id',
        description:
          'no purchase in this run carried a buyer tax id (NIP) — this is expected unless the ' +
          'operator opted into the PAUSE step\'s extensionNipBuyer hint; not a failure',
      });
    }
  });

  test('S5x — multi-line / discount order note (extension, #1574)', ({}, testInfo) => {
    requireOrder();
    // S5/S7/S8 already assert amount identity GENERICALLY over however many
    // lines an order has (they sum `snapshot.items`, never hardcode a single
    // line) — ADR-014 buyer-paid pricing is exercised for real whenever the
    // operator's purchase has more than one line and/or a discount. This step
    // adds no new assertions; it records whether that happened, so the report
    // is honest about whether non-trivial-order coverage actually ran.
    for (const [platform, order] of state.orders) {
      const snapshot = narrowOrderSnapshot<{ items?: unknown[] }>(order);
      const lineCount = Array.isArray(snapshot.items) ? snapshot.items.length : 0;
      testInfo.annotations.push({
        type: 'multi-line-coverage',
        description:
          lineCount > 1
            ? `${platform}: order has ${lineCount} lines — multi-line pricing parity exercised by S5/S7/S8`
            : `${platform}: order has a single line — multi-line/discount coverage NOT exercised this run ` +
              '(opt into the PAUSE step\'s extensionMultiLineOrDiscount hint for a future run)',
      });
    }
  });

  test('S10 — cancellation + stock restore (extension, #1574)', async ({ api, world, jobs, poll }, testInfo) => {
    requireOrder();
    // No scriptable marketplace-side cancel exists in this suite (no Allegro/
    // Erli REST client) — per the issue's own Assumptions, cancellation
    // degrades to an attended checkpoint. `severity: 'observational'` — this
    // is the last segment, so a failure here must not mask the rest of the
    // run's pass/fail.
    const entries = [...state.orders.entries()];
    test.skip(entries.length === 0, 'no purchased order to cancel');
    const [platform, order] = entries[0];

    const source = world.connectionFor(platform);
    const mapping = source ? await resolvePrimaryMapping(api, poll, source.id) : null;
    const preCancel = mapping ? await readLiveOfferOrNull(api, mapping.id) : null;

    const verdict = await manualCheckpoint(testInfo, {
      dashboard: `${platform} seller panel — MANUAL CANCELLATION`,
      expect: [
        `Cancel the ${platform} order placed in this run (product: ${state.product?.name ?? '(unknown)'})`,
        'Confirm the cancellation is accepted on the marketplace',
        'Then resume',
      ],
      values: {
        platform,
        preCancelOfferQuantity: preCancel?.availableQuantity ?? '(unreadable — no OfferReader)',
      },
      severity: 'observational',
      timeoutMs: 30 * 60_000,
    });
    if (!verdict.passed) {
      // Nothing was cancelled on the marketplace, so there is no ingestion or
      // stock restore to observe - but say so on the report. A bare `return`
      // left every assertion below unrun with no trace, and the checkpoint's
      // `observational` severity meant the segment reported green. (The verdict
      // itself is now on the terminal gate's ledger, which fails the run.)
      testInfo.annotations.push({
        type: 'cancellation-unverified',
        description:
          `${platform}: the cancellation checkpoint was ${verdict.timedOut ? 'never answered' : 'FAILED'}` +
          ` - cancelled-order ingestion and OfferStockRestorer stock restore both went UNVERIFIED`,
      });
      return;
    }

    // Nudge ingestion (webhook + poll both converge here per #1512/#1574),
    // then wait for the order's snapshot status to flip to 'cancelled'.
    //
    // The poll IS the assertion: it throws `PollTimeoutError` if the status
    // never flips. Re-asserting its own predicate on the returned value
    // afterwards (which this used to do) can never fail by construction.
    if (source) {
      await jobs.trigger({ connectionId: source.id, jobType: 'marketplace.orders.poll' }).catch(() => undefined);
    }
    await poll.until(
      () => api.orders.getById(order.internalOrderId),
      (o) => narrowOrderSnapshot<{ status?: string }>(o).status === 'cancelled',
      { message: `${platform} order to be ingested as cancelled`, timeoutMs: 180_000, intervalMs: 5_000 },
    );

    // Offer-stock restore (`OfferStockRestorer`, #1146): the channel quantity
    // should recover by SOLD_QTY. Degrades to an annotation when the channel
    // has no live OfferReader (Erli) or no restore capability.
    if (mapping && preCancel) {
      const restoreTarget = preCancel.availableQuantity + SOLD_QTY;
      try {
        // Poll for `>=` then assert EXACT, the pattern S5/S9 use: an overshoot
        // past the restored value is a real error and must be reported with the
        // observed quantity, not folded into the `>=` predicate that let it in.
        const restored = await poll.until(
          () => api.listings.getOffer(mapping.id),
          (o) => o.availableQuantity >= restoreTarget,
          { message: `${platform} offer quantity to be restored after cancellation`, timeoutMs: 120_000 },
        );
        expect(
          restored.availableQuantity,
          `${platform} offer quantity restored after cancellation (expected the pre-cancel ` +
            `${preCancel.availableQuantity} + ${SOLD_QTY})`,
        ).toBe(restoreTarget);
      } catch (error) {
        // Only a genuine non-convergence degrades. A bare `catch` also
        // swallowed the exact-value mismatch above and every transport error
        // the probe raised, so the one reachable failure in this segment could
        // not turn it red.
        if (!(error instanceof PollTimeoutError)) throw error;
        const cause = pollFailureCause(error);
        if (cause instanceof ApiError && cause.status >= 500) throw error;
        testInfo.annotations.push({
          type: 'stock-restore-degrade',
          description: `${platform}: offer quantity did not visibly restore within the timeout — verify manually (OfferStockRestorer may not be implemented for this adapter, or restore timing exceeded the budget)`,
        });
      }
    } else {
      testInfo.annotations.push({
        type: 'stock-restore-degrade',
        description: `${platform}: no live OfferReader — stock-restore verified via the checkpoint only`,
      });
    }
  });

  /**
   * Terminal gate for the attended half of the run.
   *
   * Every external-dashboard checkpoint is `observational` on purpose: this
   * describe is `serial`, so a checkpoint that failed its own test would skip
   * every downstream segment. The cost of that choice is that nothing else can
   * turn the run red - start the run, walk away, and each checkpoint waits out
   * its 30 minutes, records a FAIL, and S3/S4/S6/S8/S10 all report green while
   * nobody looked at Allegro, Erli, InPost or KSeF. This test is the missing
   * consequence, and it is LAST so it costs no downstream coverage.
   */
  test('every manual checkpoint was confirmed by the operator', () => {
    const failures = manualCheckpointFailures();
    expect(
      failures.map((f) => `${f.dashboard}: ${f.timedOut ? 'UNANSWERED' : 'FAILED'}${f.note ? ` - ${f.note}` : ''}`),
      `${failures.length} manual checkpoint(s) were failed or never answered - the surfaces they ` +
        'guard are unverified, so this attended run is not a pass',
    ).toEqual([]);
  });
});

// ── local helpers ───────────────────────────────────────────────────────────

function requireProduct(): void {
  expect(state.product, 'S0 must run first to pick the driver product').toBeTruthy();
  expect(state.primaryVariant, 'a primary variant is required').toBeTruthy();
}

function requireOrder(): void {
  requireProduct();
  expect(
    state.orders.size,
    'the manual purchase + S5 must have produced at least one order',
  ).toBeGreaterThan(0);
}

/**
 * Skip a PRE-purchase segment when the run resumes from an existing order. The
 * reason names the mode AND the order id, so a resumed report can never be
 * mistaken for a full run that happened to pass every segment.
 */
function skipWhenResuming(env: E2eEnv): void {
  test.skip(
    env.resumeFromOrder !== null,
    `resume mode (E2E_RESUME_FROM_ORDER=${env.resumeFromOrder ?? ''}) — pre-purchase segment ` +
      'skipped; S5 onward run against that already-existing order',
  );
}

/**
 * Seed the flow state from an order that already exists (`E2E_RESUME_FROM_ORDER`).
 *
 * Everything is derived from the order itself — its source connection, its sold
 * line, and that line's product/variants — so a resumed run is anchored to what
 * was ACTUALLY bought, not to a re-run of S0's driver-product heuristic (which
 * on a mutated stack can legitimately pick a different product).
 *
 * The two stock baselines are deliberately NOT seeded. They are pre-purchase
 * readings and the purchase has already happened; see the guarded call sites in
 * S5/S7/S9, which annotate what they could not check rather than assert a
 * reconstructed value against itself.
 */
async function seedStateFromExistingOrder(
  api: ApiClient,
  world: World,
  orderId: string,
): Promise<void> {
  const order = await api.orders.getById(orderId).catch((error: unknown) => {
    throw new Error(
      `E2E_RESUME_FROM_ORDER=${orderId} could not be read from this stack: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  });
  const source = world.connections.find((c) => c.id === order.sourceConnectionId);
  if (!source) {
    throw new Error(
      `E2E_RESUME_FROM_ORDER=${orderId} was ingested from connection ${order.sourceConnectionId}, ` +
        'which does not exist on this stack — resume against the stack that ingested the order',
    );
  }

  const snapshot = readOrderSnapshot(order);
  // Prefer the variant-bearing line: it is the one every later segment keys on
  // (S5's line parity, S7's PrestaShop row match by EAN, S9's propagation
  // payload), and a resumed run has no other way to learn the driver variant.
  const soldLine = snapshot.items.find((item) => !!item.variantId) ?? snapshot.items[0];
  if (!soldLine) {
    throw new Error(
      `Resumed order ${orderId} carries no line items — there is nothing for S5-S9 to assert on`,
    );
  }
  const product = await api.products.getById(soldLine.productId);
  const variants = await world.variantsOf(product.id);
  const primaryVariant =
    variants.find((v) => v.id === soldLine.variantId) ??
    (soldLine.sku ? variants.find((v) => v.sku === soldLine.sku) : undefined) ??
    variants.find((v) => v.ean ?? v.gtin);
  if (!primaryVariant) {
    throw new Error(
      `Resumed order ${orderId}: could not resolve the sold variant on product ${product.id} ` +
        `(line variantId=${soldLine.variantId ?? '(none)'}, sku=${soldLine.sku ?? '(none)'})`,
    );
  }

  state.orders.set(source.platformType, order);
  state.product = product;
  state.primaryVariant = primaryVariant;
  state.variantIds = variants.map((v) => v.id);
}

/**
 * The source connections a resumed run covers — exactly the ones the seeded
 * orders came from. `resolvePurchaseSources` cannot stand in here: it reads
 * `E2E_PURCHASE_PLATFORMS`, which describes purchases this run never made.
 */
function resolveResumedSources(world: World): Connection[] {
  const sources: Connection[] = [];
  for (const order of state.orders.values()) {
    // By id, not by platformType: a stack can carry two connections of the same
    // platform, and `connectionFor` would return whichever is active first —
    // which is not necessarily the one that ingested this order.
    const connection = world.connections.find((c) => c.id === order.sourceConnectionId);
    if (connection) sources.push(connection);
  }
  return sources;
}

/**
 * Verify the order a resumed run was handed actually carries what S5-S9 read
 * out of it. A normal run gets this evidence for free — it watched the order
 * arrive — so these assertions are the resume path's stand-in for that arrival.
 */
function assertResumedOrderUsable(
  order: OrderRecord,
  source: Connection,
  env: E2eEnv,
  testInfo: TestInfo,
): void {
  const platform = source.platformType;
  expect(order.recordStatus, `resumed ${platform} order is ready`).toBe('ready');
  expect(order.sourceConnectionId, `resumed ${platform} order's source connection`).toBe(source.id);

  const snapshot = readOrderSnapshot(order);
  expect(snapshot.items.length, `resumed ${platform} order carries line items`).toBeGreaterThan(0);
  expect(snapshot.totals.currency, `resumed ${platform} order totals carry a currency`).toBeTruthy();
  expect(snapshot.totals.total, `resumed ${platform} order carries a paid total`).toBeTruthy();
  // S6 builds the label recipient out of the buyer fields; without one, the
  // dispatch call fails deep inside the carrier mapper rather than here (#1518).
  expect(
    order.customerId ?? snapshot.customerEmail,
    `resumed ${platform} order identifies a buyer`,
  ).toBeTruthy();

  // S6 dispatches with `pickup_point` intent, so the order must name a locker —
  // unless the operator supplied the documented override (Allegro-sandbox
  // lockers routinely don't exist in the InPost sandbox).
  const pickupPointId = snapshot.pickupPoint?.id;
  if (!pickupPointId) {
    expect(
      env.paczkomatId,
      `resumed ${platform} order carries a pickup point, or E2E_PACZKOMAT_ID supplies one for S6`,
    ).toBeTruthy();
  }
  testInfo.annotations.push({
    type: 'resume',
    description:
      `${platform}: resumed from order ${order.internalOrderId} — product "${state.product?.name ?? '(unknown)'}", ` +
      `variant ${state.primaryVariant?.sku ?? state.primaryVariant?.id ?? '(unknown)'}, ` +
      `${snapshot.items.length} line(s), total ${String(snapshot.totals.total)} ${snapshot.totals.currency}, ` +
      `pickup point ${pickupPointId ?? `(none on the order; using E2E_PACZKOMAT_ID=${env.paczkomatId ?? ''})`}`,
  });
}

/**
 * Resolve the distinct source connections the operator buys on — one attended
 * purchase stop each (`E2E_PURCHASE_PLATFORMS`). Order follows the env list.
 */
function resolvePurchaseSources(world: World, platforms: string[]): Connection[] {
  const seen = new Map<string, Connection>();
  for (const platform of platforms) {
    const connection = world.connectionFor(platform);
    if (connection) seen.set(connection.id, connection);
  }
  return [...seen.values()];
}

function externalIdFor(
  externalIds: Product['externalIds'],
  connectionId: string,
): string | undefined {
  return externalIds?.find((e) => e.connectionId === connectionId)?.externalId;
}

/**
 * Resolve the purchase-source marketplace connection (E6). Prefers the configured
 * `E2E_SOURCE_PLATFORM` (allegro | erli), falling back to whichever marketplace
 * connection the stack has so an unconfigured run still resolves a source.
 */
function resolveSourceConnection(world: World, sourcePlatform: string): Connection | undefined {
  return (
    world.connectionFor(sourcePlatform) ??
    world.connectionFor(PlatformType.allegro) ??
    world.connectionFor(PlatformType.erli)
  );
}

/**
 * Whether the primary variant has an ACTIVE, OL-mapped marketplace offer on the
 * source connection (E1). Erli ships no OfferReader (`getOffer` 422s), so a
 * present mapping is the strongest available signal and counts as active.
 */
async function hasActiveMappedOffer(
  api: ApiClient,
  connectionId: string,
  variantId: string,
): Promise<boolean> {
  const page = await api.listings.list({ connectionId, internalId: variantId, limit: 5 });
  const mapping = page.items.find((m) => m.internalId === variantId);
  if (!mapping) return false;
  try {
    const offer = await api.listings.getOffer(mapping.id);
    return offer.status.toLowerCase() === 'active';
  } catch (error) {
    // 422 = the adapter ships no OfferReader (Erli) — the mapping itself is the
    // strongest available signal, so count it as active. 404 = the mapped offer
    // no longer exists on the marketplace — definitively not active. Anything
    // else is an unexpected failure: rethrow so a flaky pick fails loudly
    // instead of being silently classified as "no active offer".
    if (error instanceof ApiError && error.status === 422) return true;
    if (error instanceof ApiError && error.status === 404) return false;
    throw error;
  }
}

/**
 * Choose the driver product for the run (E1 / E7).
 *
 * Pin path (E7): when `pinnedSku` is set, select that exact product by SKU — the
 * deterministic escape hatch (single-variant allowed).
 *
 * Heuristic (E1): the first EAN-complete multi-variant product whose primary
 * variant ALSO has an ACTIVE, mapped marketplace offer on the source connection.
 * Falls back to the first EAN-complete multi-variant product when none has an
 * active offer yet (a fresh stack where S3/S4 will create the offers), so a clean
 * run is never blocked. Returns undefined while the catalogue is still empty, so
 * the caller can poll.
 */
async function pickDriverProduct(ctx: {
  api: ApiClient;
  world: World;
  pinnedSku: string | null;
  source: Connection | undefined;
}): Promise<Product | undefined> {
  const { api, world, pinnedSku, source } = ctx;
  if (pinnedSku) {
    // Exact-match ONLY: the pin is the deterministic escape hatch, so a fuzzy
    // search hit must never be silently accepted (the run would mutate and
    // assert against the wrong product). No match → undefined, so the caller's
    // poll keeps waiting and times out loudly naming the pinned SKU.
    const page = await api.products.list({ search: pinnedSku, limit: 20 });
    return page.items.find((p) => p.sku === pinnedSku);
  }

  const products = await world.listProducts(50);
  let fallback: Product | undefined;
  for (const summary of products) {
    const variants = await world.variantsOf(summary.id);
    if (variants.length < 2) continue;
    if (!variants.every((v) => !!(v.ean ?? v.gtin))) continue;
    const candidate: Product = { ...summary, variants };
    fallback ??= candidate;
    const primary = variants.find((v) => v.ean ?? v.gtin);
    if (source && primary && (await hasActiveMappedOffer(api, source.id, primary.id))) {
      return candidate;
    }
  }
  return fallback;
}

/**
 * Deterministic name of the real source category a fresh product lands in.
 * Reused across runs (looked up by name before creating) so the store doesn't
 * accumulate a duplicate category per run.
 */
const FRESH_PRODUCT_CATEGORY_NAME = 'E2E Golden Path Category';

/**
 * The attribute axis a fresh multi-variant product varies along. `Size` with
 * `S`/`M`/`L`/… already exists on a stock PrestaShop install, so the reuse-first
 * lookup in `ensureAttributeValues` normally performs no writes and the shop
 * never accumulates one throwaway attribute group per run.
 */
const FRESH_PRODUCT_ATTRIBUTE_GROUP = 'Size';
const FRESH_PRODUCT_ATTRIBUTE_VALUES = ['S', 'M', 'L', 'XL'] as const;

/**
 * Provision a BRAND-NEW PrestaShop product (E3) and return its unique reference
 * (== SKU) plus the id of the real source category it lands in, so S0 can pin the
 * run to it and map that category to Allegro. Requires the PS webservice key.
 *
 * MULTI-VARIANT by default (`variantCount` combinations, each with its own SKU,
 * EAN-13 and stock). A long-lived sandbox eventually has every variant of every
 * seed product already listed, and the bulk-offer submit correctly rejects a
 * submit whose variants are all listed (#1741 duplicate guard) — so reusing
 * catalogue fixtures makes S3/S4 "work once, then stop working". A fresh
 * multi-variant product per run removes that class of flakiness at the source.
 * `variantCount: 1` provisions a SIMPLE product instead (no combinations, a
 * parent-level EAN — the pre-#1741 behaviour, kept reachable).
 *
 * The product is created in a REAL (non-Home) category with an explicit category
 * ASSOCIATION — not just `id_category_default`. OL's `getProductCategories`
 * excludes Root/Home as pseudo-categories (#1502) and reads the source category
 * from `associations.categories`, so a Home-only product has no resolvable source
 * category and S3's Allegro bulk-wizard category picker comes up empty. The
 * category is created once and reused across runs (looked up by name first).
 *
 * Tax-group control remains a documented TODO — see
 * `PrestashopWebserviceClient.createProduct` and the golden-path docs.
 */
async function provisionFreshProduct(
  world: World,
  options: { variantCount?: number } = {},
): Promise<{ sku: string; prestashopCategoryId: string; variantEans: string[] }> {
  // Matches `env.freshVariantCount`'s default deliberately: a caller that omits
  // the option must not silently get a product Allegro can only half-list (see
  // the synthetic-barcode / catalogue-card note on `freshVariantCount`).
  const variantCount = options.variantCount ?? 1;
  if (variantCount < 1 || variantCount > FRESH_PRODUCT_ATTRIBUTE_VALUES.length) {
    throw new Error(
      `provisionFreshProduct: variantCount must be 1..${FRESH_PRODUCT_ATTRIBUTE_VALUES.length}, got ${variantCount}`,
    );
  }
  const ps = buildPrestashopClient(world);
  if (!ps) {
    throw new Error(
      'E2E_FRESH_PRODUCT requires OL_PS_WEBSERVICE_KEY (+ a resolvable PS base URL) to create a product',
    );
  }
  const prestashopCategoryId =
    (await ps.getCategoryIdByName(FRESH_PRODUCT_CATEGORY_NAME)) ??
    (await ps.createCategory({ name: FRESH_PRODUCT_CATEGORY_NAME })).id;
  const suffix = Date.now().toString();
  const reference = `E2E-${suffix}`;

  // A multi-variant product needs the distinguishing option values resolved
  // BEFORE the combinations that reference them.
  const valueNames = FRESH_PRODUCT_ATTRIBUTE_VALUES.slice(0, variantCount);
  const attributes =
    variantCount > 1
      ? await ps.ensureAttributeValues(FRESH_PRODUCT_ATTRIBUTE_GROUP, [...valueNames])
      : null;

  const created = await ps.createProduct({
    name: `E2E Golden Path ${suffix}`,
    reference,
    // GS1 prefix `590` (Poland) — a valid, non-restricted GTIN prefix. The old
    // `20…` seed produced a barcode in the GS1 restricted-distribution range
    // (`020–029`, `200–299`, reserved for in-store use), which Allegro's offer
    // validator rejects as an invalid GTIN, stranding S3. Still synthetic (not a
    // registered product), but structurally a valid public GTIN. (#1481)
    ean13: freshParentEan(suffix),
    price: '19.99',
    quantity: 25,
    idCategoryDefault: prestashopCategoryId,
    ...(attributes
      ? {
          combinations: attributes.valueIds.map((valueId, index) => ({
            reference: `${reference}-${valueNames[index]}`,
            ean13: freshVariantEan(suffix, index),
            // Distinct per variant, so the per-variant master-inventory read
            // (#823) is provably per-variant and not a copied parent total.
            quantity: 20 + index * 5,
            optionValueIds: [valueId],
          })),
        }
      : {}),
  });
  // Attach several DISTINCT photos: Allegro rejects a photo-less offer ("Wymagane
  // jest co najmniej 1 zdjęcie"). Images are synthesized offline (no network) and
  // uploaded BEFORE the master sync so OL imports them onto the product. (#1481)
  for (const image of buildFreshProductImages()) {
    await ps.addProductImage(created.id, image);
  }
  return {
    sku: created.reference,
    prestashopCategoryId,
    variantEans: created.combinations.map((c) => c.ean13),
  };
}

/**
 * Per-variant EAN-13 under the GS1 `590` (Poland) prefix.
 *
 * `computeEan13` truncates its seed to 12 data digits, so a naive
 * `590{Date.now()}{index}` seed would drop the trailing digits — including the
 * per-variant discriminator — and hand every sibling combination the SAME
 * barcode. The seed is therefore assembled to exactly 12 digits: prefix (3) +
 * the run suffix's low 7 digits + a 2-digit variant index.
 */
function freshVariantEan(suffix: string, index: number): string {
  return computeEan13(`590${suffix.slice(-7)}${String(index).padStart(2, '0')}`);
}

/**
 * Parent-level EAN-13 under the same GS1 `590` (Poland) prefix, assembled to
 * exactly 12 digits for the same reason `freshVariantEan` is. The naive
 * `590${Date.now()}` seed was truncated by `computeEan13` to `590` + the
 * timestamp's leading 9 digits, i.e. a 10-SECOND resolution: two
 * `E2E_FRESH_PRODUCT` runs inside one bucket minted distinct SKUs carrying an
 * IDENTICAL parent EAN, and offer barcode linking links only on a UNIQUE match,
 * so it would quietly decline to link rather than fail. Slot `99` is reserved
 * for the parent so it can never collide with a sibling's `00`..`nn` index.
 */
function freshParentEan(suffix: string): string {
  return computeEan13(`590${suffix.slice(-7)}99`);
}

/** Build a valid EAN-13 (12 data digits + check digit) from a numeric seed. */
function computeEan13(seed: string): string {
  const digits = seed.replace(/\D/g, '').slice(0, 12).padStart(12, '0');
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    const digit = Number(digits[i]);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  const check = (10 - (sum % 10)) % 10;
  return `${digits}${check}`;
}

interface OrderLine {
  id: string;
  productId: string;
  variantId?: string;
  quantity: number;
  price: number | string;
  sku?: string;
  name?: string;
}
interface OrderTotals {
  subtotal: number | string;
  tax?: number | string;
  shipping?: number | string;
  total: number | string;
  currency: string;
  /** Whether line prices/subtotal include tax (default inclusive/gross). */
  taxTreatment?: 'inclusive' | 'exclusive';
}
interface OrderSnapshotShape {
  items: OrderLine[];
  totals: OrderTotals;
  shipping?: { methodId: string; methodName?: string };
  shippingAddress?: { firstName?: string; lastName?: string; phone?: string };
  customerEmail?: string;
  /** Source-native order id (Allegro checkout-form id, PS order reference). */
  orderNumber?: string;
  /**
   * Locker reference (#952) — present on an order shipped to a pickup point.
   * Read only by the resume path, which has no other evidence that the order it
   * was handed is the Paczkomat purchase S6 expects.
   */
  pickupPoint?: { id?: string; name?: string };
}

/**
 * The order line for THIS run's driver variant - never "whatever line came
 * first".
 *
 * `waitForOrder` returns the next new `ready` order on the source connection,
 * which is only unambiguous while nothing else can produce one. During a
 * multi-hour attended purchase pause that assumption is thin: a second tester's
 * order, or an OL destination write-back re-ingested through the same
 * connection, lands in the same window. The old `?? snapshot.items[0]` fallback
 * absorbed that silently - `quantity === 1` happens to hold, the total identity
 * is self-consistent for ANY order, and S5 through S9 then ran labels,
 * PrestaShop parity and the KSeF invoice against a stranger's product, green
 * throughout.
 *
 * Matching is by variant id, then SKU / EAN, then - only when no line carries a
 * variant identity at all - the driver PRODUCT id, because not every source
 * adapter stamps `variantId` or a SKU onto an ingested line. Nothing matches ⇒
 * this is not our order, and that must be loud.
 */
function requireDriverLine(snapshot: OrderSnapshotShape, platform: string): OrderLine {
  const primary = state.primaryVariant!;
  const barcode = primary.ean ?? primary.gtin;
  const describeLines = (): string =>
    JSON.stringify(
      snapshot.items.map((i) => ({
        productId: i.productId,
        variantId: i.variantId,
        sku: i.sku,
        name: i.name,
      })),
    );

  const byVariant = snapshot.items.find(
    (item) =>
      item.variantId === primary.id ||
      (!!primary.sku && item.sku === primary.sku) ||
      (!!barcode && item.sku === barcode),
  );
  if (byVariant) return byVariant;

  // Product-level fallback: still ties the order to the driver, which is the
  // whole point - but only when it is unambiguous. Two sibling lines with no
  // variant identity cannot be told apart, and guessing is how the old
  // `?? items[0]` produced parity results for the wrong line.
  const byProduct = snapshot.items.filter((item) => item.productId === state.product!.id);
  expect(
    byProduct.length,
    `the ${platform} order contains exactly one line for the driver product ${state.product!.id} ` +
      `(no line identified variant id ${primary.id} / sku ${primary.sku ?? '(none)'} / ean ` +
      `${barcode ?? '(none)'}). Lines present: ${describeLines()}. Zero means this run picked up ` +
      "somebody else's order - during the multi-hour purchase pause another tester's order, or an " +
      'OL write-back re-ingested through the same connection, lands in the same window.',
  ).toBe(1);
  return byProduct[0];
}

function readOrderSnapshot(order: OrderRecord): OrderSnapshotShape {
  const snapshot = narrowOrderSnapshot<Partial<OrderSnapshotShape>>(order);
  expect(Array.isArray(snapshot.items), 'order snapshot has items').toBe(true);
  expect(snapshot.totals, 'order snapshot has totals').toBeTruthy();
  return {
    items: snapshot.items as OrderLine[],
    totals: snapshot.totals as OrderTotals,
    shipping: snapshot.shipping,
    shippingAddress: snapshot.shippingAddress,
    customerEmail: snapshot.customerEmail,
    orderNumber: snapshot.orderNumber,
    pickupPoint: snapshot.pickupPoint,
  };
}

function buildPrestashopClient(world: World): PrestashopWebserviceClient | null {
  const connection = world.connectionFor(PlatformType.prestashop);
  const key = process.env.OL_PS_WEBSERVICE_KEY?.trim();
  const baseUrl = process.env.OL_PS_ADMIN_URL?.trim() || readConfigString(connection?.config, 'baseUrl');
  if (!connection || !key || !baseUrl) return null;
  return new PrestashopWebserviceClient({ baseUrl, apiKey: key });
}

function buildWooClient(world: World): WooCommerceRestClient | null {
  const connection = world.connectionFor(PlatformType.woocommerce);
  const consumerKey = process.env.OL_WC_CONSUMER_KEY?.trim();
  const consumerSecret = process.env.OL_WC_CONSUMER_SECRET?.trim();
  const siteUrl = readConfigString(connection?.config, 'siteUrl');
  if (!connection || !consumerKey || !consumerSecret || !siteUrl) return null;
  return new WooCommerceRestClient({ siteUrl, consumerKey, consumerSecret });
}

function readConfigString(config: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = config?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Live-offer read guarded by capability: `GET /listings/:id/offer` 422s when the
 * connection's adapter ships no `OfferReader` (Erli today) — return null so the
 * caller degrades to mapping-level assertions instead of failing.
 */
async function readLiveOfferOrNull(
  api: ApiClient,
  mappingId: string,
): Promise<MarketplaceOffer | null> {
  try {
    return await api.listings.getOffer(mappingId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 422) {
      return null;
    }
    throw error;
  }
}

/**
 * Resolve the offer mapping for the PRIMARY variant on a connection, polling
 * until it appears. Fails loudly when it never does — silently asserting on an
 * arbitrary sibling offer would make every downstream parity check meaningless.
 */
async function resolvePrimaryMapping(
  api: ApiClient,
  poll: Poller,
  connectionId: string,
): Promise<OfferMapping> {
  const primaryId = state.primaryVariant!.id;
  // Filter by internalId so the lookup is EXACT — it returns the primary
  // variant's mapping directly instead of scanning a page and risking a miss on
  // connections with many offers (E4). On the reuse path the mapping already
  // exists, so this resolves on the first poll rather than waiting out a long
  // budget.
  const page = await poll.until(
    () => api.listings.list({ connectionId, internalId: primaryId, limit: 5 }),
    (p) => p.items.some((m) => m.internalId === primaryId),
    {
      message: `offer mapping for primary variant ${primaryId} on connection ${connectionId}`,
      timeoutMs: 60_000,
    },
  );
  const mapping = page.items.find((m) => m.internalId === primaryId);
  if (!mapping) {
    throw new Error(
      `No offer mapping for primary variant ${primaryId} on connection ${connectionId} ` +
        `(found ${page.items.length} other mapping(s)) — refusing to fall back to an arbitrary offer`,
    );
  }
  return mapping;
}

/**
 * Publish the driver product to a shop destination.
 *
 * Since #1754/#1829 the shop path is no longer a bespoke dialog: `/listings`
 * has ONE "Publish products" CTA that opens the unified product picker, and
 * Continue routes a `ProductPublisher` destination into the SAME bulk wizard
 * the marketplace path uses — Config → Review → publish, ending on the in-page
 * `ShopPublishTracker` rather than a batch-progress route.
 */
async function publishToShop(
  pages: PageObjects,
  api: ApiClient,
  connectionName: string,
  productName: string,
): Promise<void> {
  await pages.listingsList.goto();
  const picker = await pages.listingsList.openPublishProducts();
  // Row-scoped selection (search → named product row → expand → variant
  // checkbox) — immune to the debounced-search race.
  await picker.selectFirstVariantOf(productName);
  await picker.chooseDestination(connectionName);
  await picker.continueToWizard();

  await pages.bulkOfferWizard.expectOnConfigStep();
  await pages.bulkOfferWizard.publishToShop({ visibility: 'published' });
  // Sanity: the product exists in OL (defensive — S0 guarantees it).
  expect((await api.products.list({ limit: 1 })).items.length).toBeGreaterThan(0);
}

/** Drive the bulk wizard for the driver product; returns the created batch id. */
async function createBulkOffers(ctx: {
  api: ApiClient;
  world: World;
  pages: PageObjects;
  poll: Poller;
  connectionId: string;
  connectionName: string;
  platform: KnownPlatformType;
  /**
   * Explicit destination category id for a BORROWS-taxonomy marketplace (Erli).
   * Its editor ships no category browser — only an "Allegro category ID" text
   * field — so a breadcrumb cannot be walked there (#1045/#1096).
   */
  /** Breadcrumb to the Allegro leaf an Erli row is filed under. */
  erliCategoryPath?: string[];
}): Promise<string | null> {
  const { api, pages, poll, connectionId, connectionName, platform, erliCategoryPath } = ctx;
  const primaryId = state.primaryVariant!.id;

  // Create-if-missing, else reuse (approved design #1): reuse when the driver
  // product's primary variant already has an offer mapping on this connection —
  // this avoids duplicate offers on a re-run and sidesteps the fresh-creation
  // category prerequisite. The reuse check is EXACT (filtered by internalId): a
  // page scan missed mappings past the window on connections with many offers,
  // silently re-running the wizard and then blocking the full create-wait on an
  // offer that already existed (E4). Returns null on reuse (no creation batch),
  // so the caller skips the creation-snapshot parity.
  const existing = await api.listings.list({ connectionId, internalId: primaryId, limit: 5 });
  if (existing.items.some((m) => m.internalId === primaryId)) {
    return null;
  }

  await pages.productsList.goto();
  // Disambiguate by SKU, not name — see the same fix in
  // `golden-path/operator-setup.spec.ts`'s `runBulkOfferSegment`: this stack
  // can carry same-named products from different masters, and `hasText` is a
  // substring match that resolves to more than one row on a bare name.
  await pages.productsList.selectProduct(state.product!.sku ?? state.product!.name);
  const wizard = await pages.productsList.startBulkOfferCreation(connectionName);
  await wizard.selectConnectionIfPresent(connectionName);
  // Config ("Proceed →") → auto-advancing Resolve → Review ("Create offers (N)"),
  // failing fast when any review row needs attention.
  await wizard.advanceToConfirmModal({
    requiresDeliveryPolicy: platform === PlatformType.allegro,
    // A buyable Erli offer needs the batch-default delivery price list (#1530)
    // + responsible producer (#1531) picked on the config step — without them
    // the created product lands "niekupowalny" (no delivery method / producer).
    requiresErliBuyabilityFields: platform === PlatformType.erli,
    // Stamp the driver variant's REAL barcode into the category's GTIN/EAN
    // parameter — Allegro's validator rejects a placeholder GTIN (#1481).
    gtin: state.primaryVariant!.ean ?? state.primaryVariant!.gtin ?? undefined,
    // Erli's editor opens the category BROWSER, not the plain "Allegro category
    // ID" field this used to assume — that field only appears for a destination
    // with no category browser at all, and Erli ships one. A `categoryId` is
    // therefore ignored here, the picker falls back to "first reachable leaf",
    // and the arbitrary leaf it lands on may never resolve a parameter schema
    // ("the bulk edit modal never surfaced a category parameter schema"). Drive
    // the breadcrumb to the SAME leaf the Allegro row maps to instead, which is
    // what golden-path parity means in the first place.
    categoryPath: platform === PlatformType.erli ? erliCategoryPath : undefined,
  });
  const progress = await wizard.confirmCreation();
  expect(progress.batchId).toBeTruthy();

  // Wait for the PRIMARY variant's mapping specifically (exact, by internalId) —
  // more precise than "total went up" and consistent with the reuse check above.
  await poll.until(
    () => api.listings.list({ connectionId, internalId: primaryId, limit: 5 }),
    (page) => page.items.some((m) => m.internalId === primaryId),
    {
      message: `offer mapping for the primary variant to appear for ${connectionName}`,
      timeoutMs: 180_000,
    },
  );
  return progress.batchId;
}

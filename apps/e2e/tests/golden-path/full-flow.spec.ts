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
import { test, expect } from '../../src/fixtures/test';
import { PlatformType, type KnownPlatformType, type World } from '../../src/world/world';
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
} from '../../src/api/api.types';
import { PrestashopWebserviceClient } from '../../src/api/prestashop-webservice';
import { buildFreshProductImages } from '../../src/api/generate-image';
import { WooCommerceRestClient } from '../../src/api/woocommerce-rest';
import { captureStock, assertStockDelta, waitForStockDelta, type StockSnapshot } from '../../src/support/stock';
import { snapshotOrderIds, waitForOrder } from '../../src/support/orders';
import { manualCheckpoint } from '../../src/support/manual-checkpoint';
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
  /** Pre-purchase order-id snapshot per source connection id. */
  knownOrderIdsByConnection: Map<string, ReadonlySet<string>>;
  shipmentIds: Map<string, string>;
  invoiceIds: Map<string, string>;
  /** WooCommerce product id of the published product, captured in S2 for the post-sale re-read. */
  wcProductId?: number;
}

const state: FlowState = {
  variantIds: [],
  channelBaseline: new Map(),
  orders: new Map(),
  knownOrderIdsByConnection: new Map(),
  shipmentIds: new Map(),
  invoiceIds: new Map(),
};

test.describe.configure({ mode: 'serial' });

test.describe('golden path — full flow (S0-S9)', () => {
  test('S0 — baseline: sync master catalogue and snapshot stock', async ({ api, world, jobs, poll, env }) => {
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
    if (env.freshProduct) {
      const provisioned = await provisionFreshProduct(world);
      pinnedSku = provisioned.sku;
      freshCategoryPsId = provisioned.prestashopCategoryId;
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
    const variants = await world.variantsOf(product.id);
    const primary = variants.find((v) => v.ean ?? v.gtin);
    expect(primary, 'a primary variant with an EAN is required').toBeTruthy();

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
          () => api.inventory.availability(state.variantIds!),
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

    // Every variant has a master-sourced availability row.
    for (const id of state.variantIds) {
      expect(state.olBaseline.get(id), `baseline availability for ${id}`).toBeGreaterThanOrEqual(0);
    }
  });

  test('S1 — PrestaShop parity: OL product matches master (webservice)', async ({ api, world }) => {
    const testInfo = test.info();
    requireProduct();
    const prestashop = world.requireConnection(PlatformType.prestashop);
    const primary = state.primaryVariant!;
    const olProduct = await api.products.getById(state.product!.id);

    const ps = buildPrestashopClient(world);
    if (!ps) {
      testInfo.annotations.push({
        type: 'skip-note',
        description: 'PS webservice key not set (OL_PS_WEBSERVICE_KEY) — OL-only assertion',
      });
      expect(olProduct.name, 'OL product has a name').toBeTruthy();
      return;
    }

    const externalProductId = externalIdFor(olProduct.externalIds, prestashop.id);
    test.skip(!externalProductId, 'no PrestaShop external id mapped for the product');
    const psProduct = await ps.getProduct(externalProductId!);

    // PrestaShop stores barcodes on COMBINATIONS for multi-variant products —
    // the parent's `ean13` is empty there. Variant-level EAN parity compares
    // the OL variant EAN set against the PS combination EAN set; a simple
    // product falls back to the parent-level field.
    const psCombEans = await ps.getCombinationEans(externalProductId!);
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
    // EAN + price are load-bearing — fail loudly if the master read is missing
    // them rather than silently skipping the comparison. For the multi-variant
    // case the EAN slot is satisfied by the set assertion above (the primary
    // variant's EAN stands in on both sides so the required-field gate holds).
    assertProductFieldParity({
      label: 'OL↔PS product',
      expected,
      actual,
      required: ['ean', 'price'],
    });

    // Master stock: OL master availability totals the PS stock_availables.
    const psStock = await ps.getStockForProduct(externalProductId!);
    const olTotal = [...state.olBaseline!.values()].reduce((a, b) => a + b, 0);
    expect(olTotal, `OL master total (${olTotal}) matches PS stock (${psStock})`).toBe(psStock);
  });

  test('S2 — WooCommerce publish + REST parity', async ({ api, world, pages, poll, env }) => {
    const testInfo = test.info();
    requireProduct();
    const shop = world.connectionsWithCapability('ProductPublisher')[0] ?? world.connectionFor(PlatformType.woocommerce);
    test.skip(!shop, 'no WooCommerce/ProductPublisher connection on this stack');

    await publishToShop(pages, api, shop!.name, state.product!.name);

    // WooCommerce is a ProductPublisher, not an OfferManager — publishing
    // creates a PRODUCT on the shop (async, via the shop.product.publish
    // worker job), NOT an `/listings` offer mapping (which stays empty for a
    // shop connection). The real end-to-end signal is the product landing on
    // WooCommerce, read back over its REST API by name.
    const wc = buildWooClient(world);
    if (wc) {
      // Prefer SKU lookup (the shop publisher now carries the variant SKU, #1485),
      // falling back to name for products published before that landed. Name-only
      // matching is fragile for names with punctuation (e.g. "Drill / Driver"),
      // where the exact-name match misses and the search fallback picks the wrong row.
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
      assertProductFieldParity({
        label: 'OL↔WC product',
        expected: { name: state.product!.name, price: state.product!.price ?? undefined },
        actual: { name: wcProduct!.name, price: wcProduct!.price ?? undefined },
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
    } else {
      // No WC creds on this stack — the WC-REST proof (the real end-to-end
      // signal) can't run. There is no list endpoint for shop-publish records
      // to poll by variant, so this degrades to an annotated OL-only check.
      // Provide OL_WC_CONSUMER_KEY/SECRET for full publish verification.
      testInfo.annotations.push({
        type: 'skip-note',
        description:
          'WC consumer key/secret not set — WooCommerce publish landed only OL-side; ' +
          'set OL_WC_CONSUMER_KEY/SECRET to verify the product on WooCommerce',
      });
      expect((await api.products.list({ limit: 1 })).items.length).toBeGreaterThan(0);
    }

    // Light visual confirmation in wp-admin (own login + storageState).
    await pages.woocommerceAdmin.login(env.wcAdminUrl, env.wcAdminUser, env.wcAdminPass);
    await pages.woocommerceAdmin.saveStorageState(resolve('.auth/woocommerce.json'));
  });

  test('S3 — Allegro offers: create + field/amount parity via OL read', async ({ api, world, pages, poll }) => {
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
    });

    // Value-level parameter parity (#8): the persisted creation-request snapshot
    // carries the SUBMITTED section-tagged parameter values (#1071 —
    // `request.overrides.parameters`; `platformParams` holds only policy knobs).
    // Only available when THIS run created the offer (batchId set); on the reuse
    // path there is no fresh creation record, so the submitted-side parity is
    // skipped and the marketplace-side round-trip below carries the load.
    let submitted: import('../../src/api/api.types').SubmittedOfferParameter[] = [];
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
        const attributes = (state.primaryVariant!.attributes ?? {}) as Record<string, unknown>;
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
    const testInfo = test.info();
    requireProduct();
    const erli = world.connectionFor(PlatformType.erli);
    test.skip(!erli, 'no Erli connection on this stack');

    await createBulkOffers({ api, world, pages, poll, connectionId: erli!.id, connectionName: erli!.name, platform: PlatformType.erli, categoryPath: env.freshAllegroCategoryPath });
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
    const testInfo = test.info();
    requireProduct();
    const sources = resolvePurchaseSources(world, env.purchasePlatforms);
    test.skip(sources.length === 0, 'no marketplace source connection to buy from');

    // Snapshot BEFORE the first purchase so each source's "new order"
    // detection is clean regardless of when the operator checks out.
    for (const source of sources) {
      state.knownOrderIdsByConnection.set(source.id, await snapshotOrderIds(api, source.id));
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
    requireProduct();
    const sources = resolvePurchaseSources(world, env.purchasePlatforms);
    expect(sources.length, 'a marketplace source connection is required').toBeGreaterThan(0);

    for (const source of sources) {
      // Nudge ingestion, then wait for a new ready order (webhook or poll heals it).
      await jobs.trigger({ connectionId: source.id, jobType: 'marketplace.orders.poll' }).catch(() => undefined);
      const order = await waitForOrder(api, {
        sourceConnectionId: source.id,
        knownOrderIds: state.knownOrderIdsByConnection.get(source.id),
      });
      state.orders.set(source.platformType, order);

      // Amount parity: order line price/qty/line-total + totals + shipping.
      const snapshot = readOrderSnapshot(order);
      const currency = snapshot.totals.currency;
      const soldLine = snapshot.items.find((i) => i.variantId === state.primaryVariant!.id) ?? snapshot.items[0];
      expect(soldLine, `order has a line item (${source.platformType})`).toBeTruthy();
      expect(soldLine.quantity, `sold quantity (${source.platformType})`).toBe(SOLD_QTY);

      const lineTotal = toMinorUnits(soldLine.price, currency) * soldLine.quantity;
      const computedSubtotal = snapshot.items.reduce(
        (sum, i) => sum + toMinorUnits(i.price, currency) * i.quantity,
        0,
      );
      expect(lineTotal, `line total = price * qty (${source.platformType})`).toBe(
        toMinorUnits(soldLine.price, currency) * SOLD_QTY,
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

      // Channel stock delta: the source marketplace offer went down by SOLD_QTY.
      // Each source only sees its OWN sale here — the cross-channel push to the
      // other marketplaces happens in S9's propagation step.
      const sourceKey = source.platformType;
      const channelBefore = state.channelBaseline.get(sourceKey);
      if (channelBefore !== undefined) {
        const mapping = await resolvePrimaryMapping(api, poll, source.id);
        await poll.until(
          () => api.listings.getOffer(mapping.id),
          (o) => o.availableQuantity === channelBefore - SOLD_QTY,
          {
            message: `${sourceKey} offer quantity to drop to ${channelBefore - SOLD_QTY}`,
            timeoutMs: 120_000,
          },
        );
      }
    }
  });

  test('S6 — InPost labels: routing, tracking, PDF, dispatched (per order)', async ({ api, world, env, poll }) => {
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
      const existing = await api.routingRules.list(source!.id).catch(() => []);
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
        ...(env.paczkomatId ? { paczkomatId: env.paczkomatId } : {}),
      });
      const shipment = dispatch.shipment ?? (await api.shipments.active(order.internalOrderId));
      expect(shipment, `a shipment was created for the ${platform} order`).toBeTruthy();
      state.shipmentIds.set(platform, shipment!.id);

      // The ShipX sandbox often assigns the tracking number asynchronously —
      // annotate instead of failing when it is still null right after create (#1521).
      if (!shipment!.trackingNumber) {
        testInfo.annotations.push({
          type: 'tracking',
          description: `${platform}: tracking number not yet assigned right after label create (ShipX sandbox timing, #1521)`,
        });
      }
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

      // Writeback to the marketplace is best-effort in code (annotated) and
      // asserted by the operator at the checkpoint below.
      testInfo.annotations.push({
        type: 'writeback',
        description: `${platform}: tracking ${dispatched.trackingNumber} — marketplace writeback verified via checkpoint`,
      });
      shipmentSummaries.push(
        `${platform}: shipment ${shipment!.id}, tracking ${dispatched.trackingNumber ?? '(pending)'}, status ${dispatched.status}`,
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

  test('S7 — orders created in PrestaShop + master stock down', async ({ api, world, jobs, poll }) => {
    requireOrder();
    const prestashop = world.connectionFor(PlatformType.prestashop);
    test.skip(!prestashop, 'no PrestaShop destination connection');

    // Wait for the destination sync to PrestaShop to complete — one PS order
    // per marketplace purchase. PS-side line/total parity per order runs below.
    const psSyncByPlatform = new Map<string, { externalOrderId: string | null }>();
    for (const [platform, order] of state.orders) {
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
      { timeoutMs: 120_000 },
    );
    // The master delta is the SUM of every marketplace sale (one PS order each).
    await waitForStockDelta(api, state.olBaseline!, {
      variantId: state.primaryVariant!.id,
      soldQty: SOLD_QTY * state.orders.size,
    });

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
        const soldLine =
          snapshot.items.find((i) => i.variantId === state.primaryVariant!.id) ?? snapshot.items[0];
        const soldEan = state.primaryVariant!.ean ?? state.primaryVariant!.gtin;
        const psRow =
          (soldEan ? psOrder.rows.find((r) => r.productEan13 === soldEan) : undefined) ??
          psOrder.rows[0];
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

  test('S9 — final reconciliation: stock, cross-channel propagation, statuses', async ({ api, world, jobs, poll }) => {
    const testInfo = test.info();
    requireOrder();
    const totalSold = SOLD_QTY * state.orders.size;
    // OL master stock delta holds — the SUM of every marketplace sale.
    const current = await captureStock(api, state.variantIds);
    assertStockDelta(state.olBaseline!, current, { variantId: state.primaryVariant!.id, soldQty: totalSold });

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
        connectionId: anchor!.id,
        jobType: 'inventory.propagateToMarketplaces',
        payload: {
          productId: state.product!.id,
          variantId: state.primaryVariant!.id,
          inventoryUpdatedAt: new Date().toISOString(),
        },
      },
      { timeoutMs: 120_000 },
    );

    const expectedChannelQty = new Map<string, number>();
    for (const [platform, baseline] of state.channelBaseline) {
      if (platform !== 'woocommerce') expectedChannelQty.set(platform, baseline - totalSold);
    }
    for (const platform of [PlatformType.allegro, PlatformType.erli]) {
      const connection = world.connectionFor(platform);
      if (!connection) continue;
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
      await poll.until(
        () => api.listings.getOffer(mapping.id),
        (o) => o.availableQuantity === expectedQty,
        {
          message: `${platform} offer quantity to reach ${expectedQty} after cross-channel propagation`,
          timeoutMs: 120_000,
        },
      );
    }

    // WooCommerce stock re-check after the purchase (#14): the S2 baseline is
    // read back through the WC REST API. OL ships no WC quantity write-back
    // today (woocommerce.restapi.v3 has no OfferManager), so a stale value is
    // annotated as a known cross-channel gap rather than failed.
    const wc = buildWooClient(world);
    const wcBaseline = state.channelBaseline.get('woocommerce');
    if (wc && wcBaseline !== undefined && state.wcProductId !== undefined) {
      // Re-read by the WC product id captured in S2 — a stable handle that holds
      // regardless of whether the publisher set a SKU on this stack.
      const wcProduct = await wc.getProduct(state.wcProductId);
      const wcAfter = wcProduct?.stockQuantity ?? null;
      if (wcAfter === wcBaseline - SOLD_QTY) {
        expect(wcAfter, 'WooCommerce stock reflects the sale').toBe(wcBaseline - SOLD_QTY);
      } else {
        testInfo.annotations.push({
          type: 'cross-channel',
          description:
            `WooCommerce stock after sale: ${wcAfter ?? '(unknown)'} (baseline ${wcBaseline}, ` +
            `expected ${wcBaseline - SOLD_QTY}) — OL has no WC quantity write-back path ` +
            '(no OfferManager on woocommerce.restapi.v3); known cross-channel gap',
        });
      }
    }
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
    if (error instanceof ApiError && error.status === 422) return true;
    return false;
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
    const page = await api.products.list({ search: pinnedSku, limit: 20 });
    return page.items.find((p) => p.sku === pinnedSku) ?? page.items[0];
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
 * Provision a BRAND-NEW simple PrestaShop product (E3) and return its unique
 * reference (== SKU) plus the id of the real source category it lands in, so S0
 * can pin the run to it and map that category to Allegro. Requires the PS
 * webservice key.
 *
 * The product is created in a REAL (non-Home) category with an explicit category
 * ASSOCIATION — not just `id_category_default`. OL's `getProductCategories`
 * excludes Root/Home as pseudo-categories (#1502) and reads the source category
 * from `associations.categories`, so a Home-only product has no resolvable source
 * category and S3's Allegro bulk-wizard category picker comes up empty. The
 * category is created once and reused across runs (looked up by name first).
 *
 * Creates a SIMPLE (single-variant) product. Multi-variant fresh provisioning
 * (combinations + per-combination EAN/stock) and tax-group control are documented
 * TODOs — see `PrestashopWebserviceClient.createProduct` and the golden-path docs.
 */
async function provisionFreshProduct(
  world: World,
): Promise<{ sku: string; prestashopCategoryId: string }> {
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
  const created = await ps.createProduct({
    name: `E2E Golden Path ${suffix}`,
    reference,
    // GS1 prefix `590` (Poland) — a valid, non-restricted GTIN prefix. The old
    // `20…` seed produced a barcode in the GS1 restricted-distribution range
    // (`020–029`, `200–299`, reserved for in-store use), which Allegro's offer
    // validator rejects as an invalid GTIN, stranding S3. Still synthetic (not a
    // registered product), but structurally a valid public GTIN. (#1481)
    ean13: computeEan13(`590${suffix}`),
    price: '19.99',
    quantity: 25,
    idCategoryDefault: prestashopCategoryId,
  });
  // Attach several DISTINCT photos: Allegro rejects a photo-less offer ("Wymagane
  // jest co najmniej 1 zdjęcie"). Images are synthesized offline (no network) and
  // uploaded BEFORE the master sync so OL imports them onto the product. (#1481)
  for (const image of buildFreshProductImages()) {
    await ps.addProductImage(created.id, image);
  }
  return { sku: created.reference, prestashopCategoryId };
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
}

function readOrderSnapshot(order: OrderRecord): OrderSnapshotShape {
  const snapshot = order.orderSnapshot as unknown as Partial<OrderSnapshotShape>;
  expect(Array.isArray(snapshot.items), 'order snapshot has items').toBe(true);
  expect(snapshot.totals, 'order snapshot has totals').toBeTruthy();
  return {
    items: snapshot.items as OrderLine[],
    totals: snapshot.totals as OrderTotals,
    shipping: snapshot.shipping,
    shippingAddress: snapshot.shippingAddress,
    customerEmail: snapshot.customerEmail,
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

async function publishToShop(
  pages: PageObjects,
  api: ApiClient,
  connectionName: string,
  productName: string,
): Promise<void> {
  await pages.listingsList.goto();
  const dialog = await pages.listingsList.openPublishToShop();
  await dialog.chooseConnection(connectionName);
  // Row-scoped selection (search → named product row → expand → variant
  // checkbox) — immune to the debounced-search race.
  await dialog.selectFirstVariantOf(productName);
  await dialog.continueWithSelectionButton.click();
  if (await dialog.reviewButton.count()) {
    await dialog.reviewButton.click();
  }
  await dialog.confirmPublishButton.click();
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
  categoryPath?: string[];
}): Promise<string | null> {
  const { api, pages, poll, connectionId, connectionName, platform, categoryPath } = ctx;
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
  await pages.productsList.selectProduct(state.product!.name);
  const wizard = await pages.productsList.startBulkOfferCreation(connectionName);
  await wizard.selectConnectionIfPresent(connectionName);
  // Config ("Proceed →") → auto-advancing Resolve → Review ("Approve all (N)"),
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
    // A borrows-taxonomy destination (Erli) resolves no category in the wizard
    // preview, so its edit modal shows the browsable tree with nothing selected.
    // Drive it to the SAME leaf the Allegro row mapped to (golden-path parity)
    // so the picked category + its parameter schema match. Allegro prefills its
    // category, so the path is ignored there.
    categoryPath: platform === PlatformType.erli ? categoryPath : undefined,
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

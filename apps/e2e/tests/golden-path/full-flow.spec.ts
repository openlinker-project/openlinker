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
  MarketplaceOffer,
  OfferMapping,
  OrderRecord,
  Product,
  ProductVariant,
} from '../../src/api/api.types';
import { PrestashopWebserviceClient } from '../../src/api/prestashop-webservice';
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
  order?: OrderRecord;
  knownOrderIds?: ReadonlySet<string>;
  shipmentId?: string;
  invoiceId?: string;
  /** WooCommerce product id of the published product (SKU is unset in MVP). */
  wcProductId?: number;
}

const state: FlowState = { variantIds: [], channelBaseline: new Map() };

test.describe.configure({ mode: 'serial' });

test.describe('golden path — full flow (S0-S9)', () => {
  test('S0 — baseline: sync master catalogue and snapshot stock', async ({ api, world, jobs, poll }) => {
    const prestashop = world.connectionFor(PlatformType.prestashop);
    test.skip(!prestashop, 'no PrestaShop connection on this stack');

    const job = await jobs.triggerAndWait(
      { connectionId: prestashop!.id, jobType: 'master.product.syncAll' },
      { timeoutMs: 180_000 },
    );
    expect(job.status).toBe('succeeded');

    // Pick the driver product: a multi-variant product where EVERY variant
    // carries an EAN — the flow maps offers and resolves orders by barcode, so
    // an EAN-less pick (demo "Resin Ring") would strand every later segment.
    const product = (await poll.until<Product | undefined>(
      () => world.findMultiVariantProduct(2, { requireEans: true }),
      (p) => !!p,
      {
        message: 'an EAN-complete multi-variant product to appear after PrestaShop sync',
        timeoutMs: 60_000,
      },
    ))!;
    const variants = await world.variantsOf(product.id);
    const primary = variants.find((v) => v.ean ?? v.gtin);
    expect(primary, 'a primary variant with an EAN is required').toBeTruthy();

    state.product = product;
    state.primaryVariant = primary;
    state.variantIds = variants.map((v) => v.id);
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
      // Match by NAME, not SKU: the OL WooCommerce publisher (MVP) creates the
      // product without a SKU, so a SKU lookup never resolves.
      const wcProduct = await poll.until(
        () => wc.getProductByName(state.product!.name),
        (p) => p !== null,
        {
          message: `the published product "${state.product!.name}" to appear on WooCommerce`,
          timeoutMs: 120_000,
        },
      );
      state.wcProductId = wcProduct!.id;
      state.channelBaseline.set('woocommerce', wcProduct!.stockQuantity ?? 0);
      // Name + price are the fields the MVP publisher actually maps. SKU and
      // category are known WooCommerce-publish MVP gaps (the neutral
      // PublishProductCommand carries no sku; categories are "not implemented in
      // MVP") — record them rather than fail, so the report stays honest.
      assertProductFieldParity({
        label: 'OL↔WC product',
        expected: { name: state.product!.name, price: state.product!.price ?? undefined },
        actual: { name: wcProduct!.name, price: wcProduct!.price ?? undefined },
      });
      if (!wcProduct!.sku) {
        testInfo.annotations.push({
          type: 'wc-publish-gap',
          description:
            'WooCommerce product published without a SKU (PublishProductCommand carries no sku) — ' +
            'SKU-level parity + stock reconciliation by SKU not possible; see MASTER follow-up',
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
    // Assert each submitted parameter against the category directory and, where
    // it mirrors a master variant attribute, against the master value.
    // Directory presence stays as the secondary assertion.
    const batch = await api.listings.getBulkBatch(batchId);
    const record =
      batch.records.find((r) => r.internalVariantId === state.primaryVariant!.id) ??
      batch.records[0];
    expect(record, 'bulk batch exposes a creation record').toBeTruthy();
    const creation = await api.listings.getOfferCreationRecord(allegro!.id, record.id);
    const submitted = creation.request?.overrides?.parameters ?? [];

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

  test('S4 — Erli offers: create + mapping-level assertions (no OfferReader)', async ({ api, world, pages, poll }) => {
    const testInfo = test.info();
    requireProduct();
    const erli = world.connectionFor(PlatformType.erli);
    test.skip(!erli, 'no Erli connection on this stack');

    await createBulkOffers({ api, world, pages, poll, connectionId: erli!.id, connectionName: erli!.name, platform: PlatformType.erli });
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

  test('PAUSE — operator buys the named offer', async ({ api, world, env }) => {
    const testInfo = test.info();
    requireProduct();
    const source = world.connectionFor(PlatformType.allegro) ?? world.connectionFor(PlatformType.erli);
    test.skip(!source, 'no marketplace source connection to buy from');
    state.knownOrderIds = await snapshotOrderIds(api, source!.id);

    await manualCheckpoint(testInfo, {
      dashboard: 'MANUAL PURCHASE',
      expect: [
        `Buy exactly ${SOLD_QTY} unit of the primary-variant offer on ${source!.platformType}`,
        'At checkout choose InPost Paczkomat (pickup point) delivery — S6 dispatches the label with pickup_point intent',
        'Pick a locker that EXISTS in the InPost sandbox — Allegro-sandbox lockers often do not; ' +
          'if the buyer-selected point turns out unusable, set E2E_PACZKOMAT_ID to a real ' +
          'InPost-sandbox APM before S6 runs',
        'Complete checkout so the order reaches the marketplace',
        'Then resume — the run will wait for the order to land in OL',
      ],
      values: {
        product: state.product!.name,
        primaryVariantSku: state.primaryVariant!.sku,
        primaryVariantEan: state.primaryVariant!.ean ?? state.primaryVariant!.gtin,
        quantity: SOLD_QTY,
        delivery: 'InPost Paczkomat (pickup point)',
        paczkomatOverride: env.paczkomatId ?? '(none — E2E_PACZKOMAT_ID unset)',
      },
      fatal: true,
    });
  });

  test('S5 — order ready in OL + channel stock down', async ({ api, world, jobs, poll }) => {
    requireProduct();
    const source = world.connectionFor(PlatformType.allegro) ?? world.requireConnection(PlatformType.erli);

    // Nudge ingestion, then wait for a new ready order (webhook or poll heals it).
    await jobs.trigger({ connectionId: source.id, jobType: 'marketplace.orders.poll' }).catch(() => undefined);
    const order = await waitForOrder(api, {
      sourceConnectionId: source.id,
      knownOrderIds: state.knownOrderIds,
    });
    state.order = order;

    // Amount parity: order line price/qty/line-total + totals + shipping.
    const snapshot = readOrderSnapshot(order);
    const currency = snapshot.totals.currency;
    const soldLine = snapshot.items.find((i) => i.variantId === state.primaryVariant!.id) ?? snapshot.items[0];
    expect(soldLine, 'order has a line item').toBeTruthy();
    expect(soldLine.quantity, 'sold quantity').toBe(SOLD_QTY);

    const lineTotal = toMinorUnits(soldLine.price, currency) * soldLine.quantity;
    const computedSubtotal = snapshot.items.reduce(
      (sum, i) => sum + toMinorUnits(i.price, currency) * i.quantity,
      0,
    );
    expect(lineTotal, 'line total = price * qty').toBe(
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
      `order total identity (${treatment} tax treatment)`,
    ).toBe(expectedTotalMinor);

    // Channel stock delta: the source marketplace offer went down by SOLD_QTY.
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
  });

  test('S6 — InPost label: routing, tracking, PDF, dispatched', async ({ api, world, env }) => {
    const testInfo = test.info();
    requireOrder();
    const inpost = world.connectionFor(PlatformType.inpost);
    test.skip(!inpost, 'no InPost connection on this stack');
    const source = world.connectionFor(PlatformType.allegro) ?? world.requireConnection(PlatformType.erli);

    // Ensure a routing rule maps the source delivery method to OL-managed InPost.
    const snapshot = readOrderSnapshot(state.order!);
    const deliveryMethodId = snapshot.shipping?.methodId ?? 'default';
    const existing = await api.routingRules.list(source.id).catch(() => []);
    if (!existing.some((r) => r.sourceDeliveryMethodId === deliveryMethodId)) {
      await api.routingRules.replace(source.id, [
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
    const dispatch = await api.shipments.generateLabel({
      sourceConnectionId: source.id,
      sourceDeliveryMethodId: deliveryMethodId,
      orderId: state.order!.internalOrderId,
      deliveryIntent: 'pickup_point',
      ...(env.paczkomatId ? { paczkomatId: env.paczkomatId } : {}),
    });
    const shipment = dispatch.shipment ?? (await api.shipments.active(state.order!.internalOrderId));
    expect(shipment, 'a shipment was created').toBeTruthy();
    state.shipmentId = shipment!.id;

    expect(shipment!.trackingNumber, 'tracking number present').toBeTruthy();
    const label = await api.shipments.getLabel(shipment!.id);
    expect(label.ok && label.byteLength > 0, 'label PDF retrievable').toBe(true);

    await api.shipments.notifyDispatched(shipment!.id).catch(() => undefined);
    const dispatched = await api.shipments.getById(shipment!.id);
    expect(['dispatched', 'in-transit', 'delivered']).toContain(dispatched.status);

    // Writeback to the marketplace is best-effort in code (annotated) and
    // asserted by the operator at the checkpoint below.
    testInfo.annotations.push({
      type: 'writeback',
      description: `tracking ${dispatched.trackingNumber} — marketplace writeback verified via checkpoint`,
    });

    await manualCheckpoint(testInfo, {
      dashboard: 'InPost / ShipX manager + source marketplace order',
      expect: [
        'The shipment exists with the tracking number below',
        'Label is downloadable and status is dispatched',
        `The ${source.platformType} order shows the shipped status and/or the tracking number below (status/tracking writeback)`,
      ],
      values: { trackingNumber: dispatched.trackingNumber, status: dispatched.status, carrier: dispatched.carrier },
    });
  });

  test('S7 — order created in PrestaShop + master stock down', async ({ api, world, jobs, poll }) => {
    requireOrder();
    const prestashop = world.connectionFor(PlatformType.prestashop);
    test.skip(!prestashop, 'no PrestaShop destination connection');

    // Wait for the destination sync to PrestaShop to complete.
    const synced = await poll.until(
      () => api.orders.getById(state.order!.internalOrderId),
      (o) => o.syncStatus.some((s) => s.destinationConnectionId === prestashop!.id && s.status === 'synced'),
      { message: 'order to sync to PrestaShop', timeoutMs: 180_000 },
    );
    const psSync = synced.syncStatus.find((s) => s.destinationConnectionId === prestashop!.id);
    expect(psSync?.externalOrderId, 'PrestaShop external order id').toBeTruthy();

    // Drive the master-stock refresh explicitly (PS decremented on order
    // create; OL only sees it after a master inventory sync) instead of waiting
    // on ambient scheduling, then wait for the delta.
    await jobs.triggerAndWait(
      { connectionId: prestashop!.id, jobType: 'master.inventory.syncAll' },
      { timeoutMs: 120_000 },
    );
    await waitForStockDelta(api, state.olBaseline!, {
      variantId: state.primaryVariant!.id,
      soldQty: SOLD_QTY,
    });

    // PrestaShop order parity (webservice), when the key is available: totals,
    // shipping, and the sold line (qty + buyer-paid unit price, ADR-014).
    const ps = buildPrestashopClient(world);
    if (ps && psSync?.externalOrderId) {
      const psOrder = await ps.getOrder(psSync.externalOrderId);
      const snapshot = readOrderSnapshot(state.order!);
      const currency = snapshot.totals.currency;

      // Fail loudly when PS omits the paid total — a silent skip here would
      // pass the segment without ever comparing an amount.
      expect(
        psOrder.totalPaidTaxIncl,
        'PrestaShop order exposes total_paid_tax_incl',
      ).toBeTruthy();
      assertMoneyEqual(
        snapshot.totals.total,
        psOrder.totalPaidTaxIncl!,
        currency,
        'PS order total (tax incl) vs OL order total',
      );
      assertMoneyEqual(
        snapshot.totals.shipping ?? 0,
        psOrder.totalShippingTaxIncl ?? 0,
        currency,
        'PS order shipping (tax incl) vs OL order shipping',
      );

      // Line items: the sold line exists with matching quantity and the
      // buyer-paid unit price.
      expect(psOrder.rows.length, 'PS order carries line rows').toBeGreaterThan(0);
      const soldLine =
        snapshot.items.find((i) => i.variantId === state.primaryVariant!.id) ?? snapshot.items[0];
      const soldEan = state.primaryVariant!.ean ?? state.primaryVariant!.gtin;
      const psRow =
        (soldEan ? psOrder.rows.find((r) => r.productEan13 === soldEan) : undefined) ??
        psOrder.rows[0];
      expect(psRow.productQuantity, 'PS line quantity').toBe(soldLine.quantity);
      if (psRow.unitPriceTaxIncl !== null) {
        assertMoneyEqual(
          soldLine.price,
          psRow.unitPriceTaxIncl,
          currency,
          'PS line unit price (buyer-paid source price, ADR-014)',
        );
      }
    }
  });

  test('S8 — KSeF: issue → reconcile → accepted, number, UPO, FA(3) XML', async ({ api, world, jobs, poll }) => {
    const testInfo = test.info();
    requireOrder();
    const ksef = world.connectionFor(PlatformType.ksef);
    test.skip(!ksef, 'no KSeF connection on this stack');

    // Issue the invoice for the order via POST /invoices (the server assembles
    // lines/buyer from the order). Idempotent — reuse if already issued.
    let invoice = await api.invoices.getForOrder(state.order!.internalOrderId, ksef!.id).catch(() => null);
    if (!invoice) {
      await api.invoices.issue({
        connectionId: ksef!.id,
        orderId: state.order!.internalOrderId,
      });
      invoice = await poll.until(
        () => api.invoices.getForOrder(state.order!.internalOrderId, ksef!.id),
        (r) => r.status === 'issued' || r.status === 'issuing',
        { message: 'invoice to be issued', timeoutMs: 180_000 },
      );
    }
    state.invoiceId = invoice.id;

    // Reconcile clearance until accepted with a KSeF number. The reconcile
    // handler is schema-strict: it throws (job retries to dead) unless the
    // payload carries `schemaVersion: 1`.
    await jobs
      .trigger({
        connectionId: ksef!.id,
        jobType: 'invoicing.regulatoryStatus.reconcile',
        payload: { schemaVersion: 1 },
      })
      .catch(() => undefined);
    const cleared = await poll.until(
      () => api.invoices.getById(invoice!.id),
      (r) => r.regulatoryStatus === 'accepted' && !!r.clearanceReference,
      { message: 'invoice to reach accepted + KSeF number', timeoutMs: 300_000, intervalMs: 5_000 },
    );
    expect(cleared.clearanceReference, 'KSeF number').toBeTruthy();
    expect(cleared.documentType, 'invoice document type recorded').toBeTruthy();

    // Amount parity: expected per-line gross derived from the ORDER snapshot
    // (buyer-paid price × qty) — matched by gross containment (the provider may
    // add a shipping line). Totals gross must equal the order total. Every
    // invoice line is also checked for internal net+VAT=gross consistency.
    const content = await api.invoices.getContent(invoice.id);
    const snapshot = readOrderSnapshot(state.order!);
    const treatment = snapshot.totals.taxTreatment ?? 'inclusive';
    const expectedLines =
      treatment === 'inclusive'
        ? snapshot.items.map((i) => ({ gross: Number(i.price) * i.quantity }))
        : undefined; // exclusive line prices are net — gross per line is not derivable here
    assertInvoiceAmounts(
      {
        currency: snapshot.totals.currency,
        ...(expectedLines ? { lines: expectedLines } : {}),
        totals: { gross: snapshot.totals.total },
      },
      content,
    );
    expect(content.lines.length, 'invoice has lines').toBeGreaterThan(0);

    // UPO + source FA(3) XML retrievable.
    const upo = await api.invoices.getUpo(invoice.id);
    expect(upo.ok && upo.byteLength > 0, 'UPO retrievable').toBe(true);
    const xml = await api.invoices.getSourceDocument(invoice.id);
    expect(xml.ok && xml.byteLength > 0, 'FA(3) source XML retrievable').toBe(true);

    await manualCheckpoint(testInfo, {
      dashboard: 'KSeF test environment',
      expect: ['The invoice is visible with the KSeF number below', 'Amounts (net/VAT/gross) match the order'],
      values: {
        ksefNumber: cleared.clearanceReference,
        documentType: cleared.documentType,
        gross: `${content.totals.gross} ${content.currency}`,
      },
    });
  });

  test('S9 — final reconciliation: stock, cross-channel propagation, statuses', async ({ api, world, jobs, poll }) => {
    const testInfo = test.info();
    requireOrder();
    // OL master stock delta holds.
    const current = await captureStock(api, state.variantIds);
    assertStockDelta(state.olBaseline!, current, { variantId: state.primaryVariant!.id, soldQty: SOLD_QTY });

    // Order is ready and synced to at least one destination.
    const order = await api.orders.getById(state.order!.internalOrderId);
    expect(order.recordStatus).toBe('ready');
    expect(order.syncStatus.some((s) => s.status === 'synced'), 'order synced to a destination').toBe(true);

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
      if (platform !== 'woocommerce') expectedChannelQty.set(platform, baseline - SOLD_QTY);
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
      // Re-read by the WC product id captured in S2 (the MVP publisher sets no
      // SKU, so a SKU lookup is not an option).
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
  expect(state.order, 'the manual purchase + S5 must have produced an order').toBeTruthy();
}

function externalIdFor(
  externalIds: Product['externalIds'],
  connectionId: string,
): string | undefined {
  return externalIds?.find((e) => e.connectionId === connectionId)?.externalId;
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
}

function readOrderSnapshot(order: OrderRecord): OrderSnapshotShape {
  const snapshot = order.orderSnapshot as unknown as Partial<OrderSnapshotShape>;
  expect(Array.isArray(snapshot.items), 'order snapshot has items').toBe(true);
  expect(snapshot.totals, 'order snapshot has totals').toBeTruthy();
  return {
    items: snapshot.items as OrderLine[],
    totals: snapshot.totals as OrderTotals,
    shipping: snapshot.shipping,
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
  const page = await poll.until(
    () => api.listings.list({ connectionId, limit: 50 }),
    (p) => p.items.some((m) => m.internalId === primaryId),
    {
      message: `offer mapping for primary variant ${primaryId} on connection ${connectionId}`,
      timeoutMs: 120_000,
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
}): Promise<string> {
  const { api, pages, poll, connectionId, connectionName, platform } = ctx;
  const before = (await api.listings.list({ connectionId, limit: 1 })).total;

  await pages.productsList.goto();
  await pages.productsList.selectProduct(state.product!.name);
  const wizard = await pages.productsList.startBulkOfferCreation(connectionName);
  await wizard.selectConnectionIfPresent(connectionName);
  // Config ("Proceed →") → auto-advancing Resolve → Review ("Approve all (N)"),
  // failing fast when any review row needs attention.
  await wizard.advanceToConfirmModal({ requiresDeliveryPolicy: platform === PlatformType.allegro });
  const progress = await wizard.confirmCreation();
  expect(progress.batchId).toBeTruthy();

  await poll.until(
    () => api.listings.list({ connectionId, limit: 25 }),
    (page) => page.total > before,
    { message: `offer mappings to appear for ${connectionName}`, timeoutMs: 180_000 },
  );
  return progress.batchId;
}

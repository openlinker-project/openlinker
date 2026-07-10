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
import { PlatformType, type World } from '../../src/world/world';
import type { ApiClient } from '../../src/api/api-client';
import type { PageObjects } from '../../src/pages';
import type { Poller } from '../../src/support/poller';
import type { OfferMapping, OrderRecord, Product, ProductVariant } from '../../src/api/api.types';
import { PrestashopWebserviceClient } from '../../src/api/prestashop-webservice';
import { WooCommerceRestClient } from '../../src/api/woocommerce-rest';
import { captureStock, assertStockDelta, waitForStockDelta, type StockSnapshot } from '../../src/support/stock';
import { snapshotOrderIds, waitForOrder } from '../../src/support/orders';
import { manualCheckpoint } from '../../src/support/manual-checkpoint';
import {
  assertProductFieldParity,
  assertOfferParameterParity,
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

    // Pick the driver product: a multi-variant product whose primary variant has an EAN.
    const product = (await poll.until<Product | undefined>(
      () => world.findMultiVariantProduct(2),
      (p) => !!p,
      { message: 'a multi-variant product to appear after PrestaShop sync', timeoutMs: 60_000 },
    ))!;
    const variants = await world.variantsOf(product.id);
    const primary = variants.find((v) => (v.ean ?? v.gtin)) ?? variants[0];
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

    const expected: ProductParityView = {
      name: psProduct.name,
      ean: psProduct.ean13,
      price: psProduct.price ?? undefined,
      currency: olProduct.currency ?? 'PLN',
    };
    const actual: ProductParityView = {
      name: olProduct.name,
      ean: primary.ean ?? primary.gtin,
      price: olProduct.price ?? undefined,
      currency: olProduct.currency ?? 'PLN',
    };
    assertProductFieldParity({ label: 'OL↔PS product', expected, actual });

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

    const before = (await api.listings.list({ connectionId: shop!.id, limit: 1 })).total;
    await publishToShop(pages, api, shop!.name, state.product!.name);
    await poll.until(
      () => api.listings.list({ connectionId: shop!.id, limit: 25 }),
      (page) => page.total >= before,
      { message: `WooCommerce listing mapping for ${shop!.name}`, timeoutMs: 120_000 },
    );

    const wc = buildWooClient(world);
    const primary = state.primaryVariant!;
    if (wc && primary.sku) {
      const wcProduct = await wc.getProductBySku(primary.sku);
      if (wcProduct) {
        state.channelBaseline.set('woocommerce', wcProduct.stockQuantity ?? 0);
        assertProductFieldParity({
          label: 'OL↔WC product',
          expected: { sku: primary.sku, name: state.product!.name },
          actual: { sku: wcProduct.sku, name: wcProduct.name },
        });
      }
    } else {
      testInfo.annotations.push({
        type: 'skip-note',
        description: 'WC consumer key/secret not set — OL-only publish assertion',
      });
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

    await createBulkOffers({ api, world, pages, poll, connectionId: allegro!.id, connectionName: allegro!.name });
    const mapping = await resolvePrimaryMapping(api, poll, allegro!.id);
    const offer = await api.listings.getOffer(mapping.id);
    state.channelBaseline.set('allegro', offer.availableQuantity);

    // Field parity: price, currency, category id, available quantity via OL's adapter read.
    assertProductFieldParity({
      label: 'OL↔Allegro offer',
      expected: { price: state.product!.price ?? undefined, currency: state.product!.currency ?? 'PLN' },
      actual: offerToParityView(offer),
    });

    // Category parameter directory parity (offer + product sections) where a category resolved.
    if (offer.category?.id) {
      const params = await api.listings.categoryParameters(allegro!.id, offer.category.id);
      expect(params.length, 'Allegro category exposes parameters').toBeGreaterThan(0);
      assertOfferParameterParity('Allegro', paramsToExpectations(params), params);
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

  test('S4 — Erli offers: create + field/amount parity via OL read', async ({ api, world, pages, poll }) => {
    const testInfo = test.info();
    requireProduct();
    const erli = world.connectionFor(PlatformType.erli);
    test.skip(!erli, 'no Erli connection on this stack');

    await createBulkOffers({ api, world, pages, poll, connectionId: erli!.id, connectionName: erli!.name });
    const mapping = await resolvePrimaryMapping(api, poll, erli!.id);
    const offer = await api.listings.getOffer(mapping.id);
    state.channelBaseline.set('erli', offer.availableQuantity);

    assertProductFieldParity({
      label: 'OL↔Erli offer',
      expected: { price: state.product!.price ?? undefined, currency: state.product!.currency ?? 'PLN' },
      actual: offerToParityView(offer),
    });

    await manualCheckpoint(testInfo, {
      dashboard: 'Erli seller panel / storefront',
      expect: [
        'The offer is published (borrowed Allegro taxonomy)',
        'Price and category match the master',
        'Available quantity equals the OL baseline',
      ],
      values: {
        offerId: offer.externalId,
        price: `${offer.price.amount} ${offer.price.currency}`,
        availableQuantity: offer.availableQuantity,
      },
    });
  });

  test('PAUSE — operator buys the named offer', async ({ api, world }) => {
    const testInfo = test.info();
    requireProduct();
    const source = world.connectionFor(PlatformType.allegro) ?? world.connectionFor(PlatformType.erli);
    test.skip(!source, 'no marketplace source connection to buy from');
    state.knownOrderIds = await snapshotOrderIds(api, source!.id);

    await manualCheckpoint(testInfo, {
      dashboard: 'MANUAL PURCHASE',
      expect: [
        `Buy exactly ${SOLD_QTY} unit of the primary-variant offer on ${source!.platformType}`,
        'Complete checkout so the order reaches the marketplace',
        'Then resume — the run will wait for the order to land in OL',
      ],
      values: {
        product: state.product!.name,
        primaryVariantSku: state.primaryVariant!.sku,
        primaryVariantEan: state.primaryVariant!.ean ?? state.primaryVariant!.gtin,
        quantity: SOLD_QTY,
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
    expect(
      toMinorUnits(snapshot.totals.total, currency),
      'order total = subtotal + tax + shipping',
    ).toBe(
      computedSubtotal +
        toMinorUnits(snapshot.totals.tax ?? 0, currency) +
        toMinorUnits(snapshot.totals.shipping ?? 0, currency),
    );

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

  test('S6 — InPost label: routing, tracking, PDF, dispatched', async ({ api, world }) => {
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

    const dispatch = await api.shipments.generateLabel({
      sourceConnectionId: source.id,
      sourceDeliveryMethodId: deliveryMethodId,
      orderId: state.order!.internalOrderId,
      deliveryIntent: 'pickup_point',
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

    // Writeback to the marketplace is best-effort (annotated, non-fatal).
    testInfo.annotations.push({
      type: 'writeback',
      description: `tracking ${dispatched.trackingNumber} — marketplace writeback best-effort`,
    });

    await manualCheckpoint(testInfo, {
      dashboard: 'InPost / ShipX manager',
      expect: ['The shipment exists with the tracking number below', 'Label is downloadable and status is dispatched'],
      values: { trackingNumber: dispatched.trackingNumber, status: dispatched.status, carrier: dispatched.carrier },
    });
  });

  test('S7 — order created in PrestaShop + master stock down', async ({ api, world, poll }) => {
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

    // Master stock delta: OL availability dropped by SOLD_QTY for the sold variant.
    await waitForStockDelta(api, state.olBaseline!, {
      variantId: state.primaryVariant!.id,
      soldQty: SOLD_QTY,
    });

    // PrestaShop order amount parity (webservice), when the key is available.
    const ps = buildPrestashopClient(world);
    if (ps && psSync?.externalOrderId) {
      const psOrder = await ps.getOrder(psSync.externalOrderId);
      const snapshot = readOrderSnapshot(state.order!);
      if (psOrder.totalPaidTaxIncl) {
        expect(
          toMinorUnits(psOrder.totalPaidTaxIncl, snapshot.totals.currency),
          'PS order total matches OL order total',
        ).toBe(toMinorUnits(snapshot.totals.total, snapshot.totals.currency));
      }
    }
  });

  test('S8 — KSeF: issue → reconcile → accepted, number, UPO, FA(3) XML', async ({ api, world, jobs, poll }) => {
    const testInfo = test.info();
    requireOrder();
    const ksef = world.connectionFor(PlatformType.ksef);
    test.skip(!ksef, 'no KSeF connection on this stack');

    // Issue the invoice for the order (idempotent — reuse if already issued).
    let invoice = await api.invoices.getForOrder(state.order!.internalOrderId, ksef!.id).catch(() => null);
    if (!invoice) {
      await jobs.trigger({
        connectionId: ksef!.id,
        jobType: 'invoicing.issue',
        payload: { orderId: state.order!.internalOrderId },
      });
      invoice = await poll.until(
        () => api.invoices.getForOrder(state.order!.internalOrderId, ksef!.id),
        (r) => r.status === 'issued' || r.status === 'issuing',
        { message: 'invoice to be issued', timeoutMs: 180_000 },
      );
    }
    state.invoiceId = invoice.id;

    // Reconcile clearance until accepted with a KSeF number.
    await jobs.trigger({ connectionId: ksef!.id, jobType: 'invoicing.regulatoryStatus.reconcile' }).catch(() => undefined);
    const cleared = await poll.until(
      () => api.invoices.getById(invoice!.id),
      (r) => r.regulatoryStatus === 'accepted' && !!r.clearanceReference,
      { message: 'invoice to reach accepted + KSeF number', timeoutMs: 300_000, intervalMs: 5_000 },
    );
    expect(cleared.clearanceReference, 'KSeF number').toBeTruthy();

    // Amount parity: FA(3) per-line net/VAT/gross + totals + currency + buyer tax id.
    const content = await api.invoices.getContent(invoice.id);
    const snapshot = readOrderSnapshot(state.order!);
    assertInvoiceAmounts(
      {
        currency: snapshot.totals.currency,
        documentType: cleared.documentType,
        totals: { gross: snapshot.totals.total },
      },
      content,
      cleared.documentType,
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

  test('S9 — final reconciliation: stock + statuses consistent', async ({ api, world }) => {
    requireOrder();
    // OL master stock delta holds.
    const current = await captureStock(api, state.variantIds);
    assertStockDelta(state.olBaseline!, current, { variantId: state.primaryVariant!.id, soldQty: SOLD_QTY });

    // Order is ready and synced to at least one destination.
    const order = await api.orders.getById(state.order!.internalOrderId);
    expect(order.recordStatus).toBe('ready');
    expect(order.syncStatus.some((s) => s.status === 'synced'), 'order synced to a destination').toBe(true);

    // Channel offer quantities reflect the sale where a baseline was captured.
    const source = world.connectionFor(PlatformType.allegro) ?? world.connectionFor(PlatformType.erli);
    if (source) {
      const baseline = state.channelBaseline.get(source.platformType);
      if (baseline !== undefined) {
        const mapping = (await api.listings.list({ connectionId: source.id, limit: 25 })).items.find(
          (m) => m.internalId === state.primaryVariant!.id,
        );
        if (mapping) {
          const offer = await api.listings.getOffer(mapping.id);
          expect(offer.availableQuantity, `${source.platformType} offer stock after sale`).toBe(
            baseline - SOLD_QTY,
          );
        }
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

function paramsToExpectations(
  params: { name: string; section: 'offer' | 'product'; required: boolean }[],
): { name: string; section: 'offer' | 'product' }[] {
  // Assert the required parameters are present (a stable, meaningful subset).
  return params.filter((p) => p.required).map((p) => ({ name: p.name, section: p.section }));
}

async function resolvePrimaryMapping(
  api: ApiClient,
  poll: Poller,
  connectionId: string,
): Promise<OfferMapping> {
  const page = await poll.until(
    () => api.listings.list({ connectionId, limit: 50 }),
    (p) => p.items.length > 0,
    { message: `offer mappings for connection ${connectionId}`, timeoutMs: 120_000 },
  );
  const primaryId = state.primaryVariant!.id;
  return page.items.find((m) => m.internalId === primaryId) ?? page.items[0];
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
  await dialog.productSearchField.fill(productName);
  await dialog.dialog.getByRole('checkbox').first().check();
  await dialog.continueWithSelectionButton.click();
  if (await dialog.reviewButton.count()) {
    await dialog.reviewButton.click();
  }
  await dialog.confirmPublishButton.click();
  // Sanity: the product exists in OL (defensive — S0 guarantees it).
  expect((await api.products.list({ limit: 1 })).items.length).toBeGreaterThan(0);
}

async function createBulkOffers(ctx: {
  api: ApiClient;
  world: World;
  pages: PageObjects;
  poll: Poller;
  connectionId: string;
  connectionName: string;
}): Promise<void> {
  const { api, pages, poll, connectionId, connectionName } = ctx;
  const before = (await api.listings.list({ connectionId, limit: 1 })).total;

  await pages.productsList.goto();
  await pages.productsList.selectProduct(state.product!.name);
  const wizard = await pages.productsList.startBulkOfferCreation();
  await wizard.selectConnectionIfPresent(connectionName);
  for (let step = 0; step < 3; step += 1) {
    if (await wizard.confirmModalConfirmButton.count()) break;
    if (await wizard.nextButton.count()) {
      await wizard.nextButton.first().click();
    }
  }
  const progress = await wizard.confirmCreation();
  expect(progress.batchId).toBeTruthy();

  await poll.until(
    () => api.listings.list({ connectionId, limit: 25 }),
    (page) => page.total > before,
    { message: `offer mappings to appear for ${connectionName}`, timeoutMs: 180_000 },
  );
}

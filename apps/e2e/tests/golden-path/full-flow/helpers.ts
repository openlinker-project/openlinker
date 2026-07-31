/**
 * Golden path full-flow: shared segment helpers
 *
 * The local helpers the S0-S10 segment specs share — resume seeding, driver-
 * product selection and fresh-product provisioning, order-snapshot narrowing,
 * platform REST clients, and the two wizard drivers. Moved out of the single
 * spec file when it was split per segment; the bodies are unchanged.
 *
 * @module tests/golden-path/full-flow
 */
import type { TestInfo } from '@playwright/test';
import { test, expect } from '../../../src/fixtures/test';
import { PlatformType, type KnownPlatformType, type World } from '../../../src/world/world';
import type { E2eEnv } from '../../../src/config/env';
import type { ApiClient } from '../../../src/api/api-client';
import { ApiError } from '../../../src/api/api-error';
import type { PageObjects } from '../../../src/pages';
import type { Connection, MarketplaceOffer, OfferMapping, OrderRecord, Product } from '../../../src/api/api.types';
import { PrestashopWebserviceClient } from '../../../src/api/prestashop-webservice';
import { buildFreshProductImages } from '../../../src/api/generate-image';
import { WooCommerceRestClient } from '../../../src/api/woocommerce-rest';
import { narrowOrderSnapshot } from '../../../src/support/order-snapshot';
import type { Poller } from '../../../src/support/poller';
import { state } from './flow-state';

export function requireProduct(): void {
  expect(state.product, 'S0 must run first to pick the driver product').toBeTruthy();
  expect(state.primaryVariant, 'a primary variant is required').toBeTruthy();
}

export function requireOrder(): void {
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
export function skipWhenResuming(env: E2eEnv): void {
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
export async function seedStateFromExistingOrder(
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
export function resolveResumedSources(world: World): Connection[] {
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
export function assertResumedOrderUsable(
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
export function resolvePurchaseSources(world: World, platforms: string[]): Connection[] {
  const seen = new Map<string, Connection>();
  for (const platform of platforms) {
    const connection = world.connectionFor(platform);
    if (connection) seen.set(connection.id, connection);
  }
  return [...seen.values()];
}

export function externalIdFor(
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
export function resolveSourceConnection(world: World, sourcePlatform: string): Connection | undefined {
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
export async function hasActiveMappedOffer(
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
export async function pickDriverProduct(ctx: {
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
export const FRESH_PRODUCT_CATEGORY_NAME = 'E2E Golden Path Category';

/**
 * The attribute axis a fresh multi-variant product varies along. `Size` with
 * `S`/`M`/`L`/… already exists on a stock PrestaShop install, so the reuse-first
 * lookup in `ensureAttributeValues` normally performs no writes and the shop
 * never accumulates one throwaway attribute group per run.
 */
export const FRESH_PRODUCT_ATTRIBUTE_GROUP = 'Size';
export const FRESH_PRODUCT_ATTRIBUTE_VALUES = ['S', 'M', 'L', 'XL'] as const;

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
export async function provisionFreshProduct(
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
export function freshVariantEan(suffix: string, index: number): string {
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
export function freshParentEan(suffix: string): string {
  return computeEan13(`590${suffix.slice(-7)}99`);
}

/** Build a valid EAN-13 (12 data digits + check digit) from a numeric seed. */
export function computeEan13(seed: string): string {
  const digits = seed.replace(/\D/g, '').slice(0, 12).padStart(12, '0');
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    const digit = Number(digits[i]);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  const check = (10 - (sum % 10)) % 10;
  return `${digits}${check}`;
}

export interface OrderLine {
  id: string;
  productId: string;
  variantId?: string;
  quantity: number;
  price: number | string;
  sku?: string;
  name?: string;
}
export interface OrderTotals {
  subtotal: number | string;
  tax?: number | string;
  shipping?: number | string;
  total: number | string;
  currency: string;
  /** Whether line prices/subtotal include tax (default inclusive/gross). */
  taxTreatment?: 'inclusive' | 'exclusive';
}
export interface OrderSnapshotShape {
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
export function requireDriverLine(snapshot: OrderSnapshotShape, platform: string): OrderLine {
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

export function readOrderSnapshot(order: OrderRecord): OrderSnapshotShape {
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

export function buildPrestashopClient(world: World): PrestashopWebserviceClient | null {
  const connection = world.connectionFor(PlatformType.prestashop);
  const key = process.env.OL_PS_WEBSERVICE_KEY?.trim();
  const baseUrl = process.env.OL_PS_ADMIN_URL?.trim() || readConfigString(connection?.config, 'baseUrl');
  if (!connection || !key || !baseUrl) return null;
  return new PrestashopWebserviceClient({ baseUrl, apiKey: key });
}

export function buildWooClient(world: World): WooCommerceRestClient | null {
  const connection = world.connectionFor(PlatformType.woocommerce);
  const consumerKey = process.env.OL_WC_CONSUMER_KEY?.trim();
  const consumerSecret = process.env.OL_WC_CONSUMER_SECRET?.trim();
  const siteUrl = readConfigString(connection?.config, 'siteUrl');
  if (!connection || !consumerKey || !consumerSecret || !siteUrl) return null;
  return new WooCommerceRestClient({ siteUrl, consumerKey, consumerSecret });
}

export function readConfigString(config: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = config?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Live-offer read guarded by capability: `GET /listings/:id/offer` 422s when the
 * connection's adapter ships no `OfferReader` (Erli today) — return null so the
 * caller degrades to mapping-level assertions instead of failing.
 */
export async function readLiveOfferOrNull(
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
export async function resolvePrimaryMapping(
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
export async function publishToShop(
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
export async function createBulkOffers(ctx: {
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

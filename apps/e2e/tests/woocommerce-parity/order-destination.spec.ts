/**
 * WooCommerce parity — scenarios 2-4: WooCommerce as order destination,
 * customer/address reuse, and variant mapping
 *
 * Unattended substitute for a live buyer purchase (#1571): a native order is
 * created directly on the WooCommerce store via REST (`WooCommerceRestClient
 * .createOrder`), ingested into OL through the WC connection's `OrderSource`
 * capability (mirrors `WooCommerceOrderSourceAdapter`'s `date_upd` poll), and
 * then fanned out by `OrderSyncService` to every connection carrying
 * `OrderProcessorManager` — asserted generically by scanning `syncStatus` for
 * a WooCommerce-platform destination.
 *
 * Requires a genuinely DISTINCT destination WooCommerce connection (not the
 * source connection itself): `OrderSyncService` never syncs an order back to
 * its own source (verified live — pushing an order back into the shop it
 * came from would be nonsensical), so a same-connection topology never
 * produces a WooCommerce syncStatus entry at all. The destination connection
 * must also already have the ordered product published to it (a real
 * `ProductPublisher` publish, or its own master-catalogue mapping) — the
 * order-processor adapter deliberately refuses to create "silent partial
 * orders" for an unmapped product.
 *
 * Requires the catalogue to already be WC-mastered (run
 * `master-catalog.spec.ts` first, or in the same serial run) so the ordered
 * product/variant already carries a WC external-id mapping the destination
 * adapter can resolve into `line_items`.
 *
 * Self-configuring: skips with a clear reason when the stack has no
 * WooCommerce OrderSource connection with a DISTINCT WooCommerce
 * OrderProcessorManager connection, or no WC REST credentials.
 *
 * @module tests/woocommerce-parity
 */
import { randomUUID } from 'node:crypto';
import { test, expect } from '../../src/fixtures/test';
import type { ApiClient } from '../../src/api/api-client';
import type { World } from '../../src/world/world';
import type { Connection, OrderRecord } from '../../src/api/api.types';
import { buildWooCommerceClient } from '../../src/support/woocommerce-client';
import { externalIdFor } from '../../src/support/external-ids';
import { waitForOrderByExternalId } from '../../src/support/orders';
import { toMinorUnits } from '../../src/support/parity';
import type { WooCommerceAddressInput } from '../../src/api/woocommerce-rest';
import type { SyncJobs } from '../../src/support/jobs';
import type { WooCommerceRestClient } from '../../src/api/woocommerce-rest';

test.describe.configure({ mode: 'serial' });

const ADDRESS_A: WooCommerceAddressInput = {
  firstName: 'E2E',
  lastName: 'Buyer',
  address1: 'ul. Testowa 1',
  city: 'Warszawa',
  postcode: '00-001',
  country: 'PL',
};

const ADDRESS_B: WooCommerceAddressInput = {
  firstName: 'E2E',
  lastName: 'Buyer',
  address1: 'ul. Inna 42',
  city: 'Krakow',
  postcode: '30-001',
  country: 'PL',
};

test.describe('WooCommerce as order destination', () => {
  // Spec-owned destination connection: created (or adopted) once for this
  // file, disabled again on the way out so the order fan-out returns to its
  // normal shape for every other spec and for manual use of the stack.
  let destination: Connection | null = null;

  test.beforeAll(async ({ api, world }) => {
    const wcSource = pickWooCommerceConnection(world, 'OrderSource');
    if (!wcSource) return;
    destination = await ensureDestinationConnection(api, world, wcSource).catch(() => null);
  });

  test.afterAll(async ({ api }) => {
    if (destination) {
      await releaseDestinationConnection(api, destination.id);
    }
  });

  test('an order sourced from WooCommerce is created in a WooCommerce destination with correct lines, price and status', async ({
    api,
    world,
    jobs,
  }) => {
    const ctx = resolveContext(world, destination);
    test.skip(!ctx, 'no WooCommerce OrderSource connection + a DISTINCT WooCommerce OrderProcessorManager connection, or missing REST credentials');
    const { wcSource, wc } = ctx!;

    const mapped = await findProductMappedToBoth(api, world, wcSource.id, ctx!.wcDestination.id);
    test.skip(
      !mapped,
      'no OL product mapped to BOTH the WooCommerce source and the destination connection — ' +
        'run master-catalog.spec.ts for the source half, and seed the destination mapping ' +
        '(same-store topology cannot publish a duplicate SKU to create it)',
    );
    const { wcProductId } = mapped!;
    const quantity = 1;

    const email = `e2e-${randomUUID().slice(0, 8)}@example-e2e.invalid`;
    const sourceOrder = await wc.createOrder({
      status: 'processing',
      billing: { ...ADDRESS_A, email },
      lineItems: [{ productId: wcProductId, quantity }],
    });

    const order = await waitForOrderByExternalId(api, {
      sourceConnectionId: wcSource.id,
      externalOrderId: String(sourceOrder.id),
      timeoutMs: 120_000,
      retriggerPoll: () => jobs.trigger({ connectionId: wcSource.id, jobType: 'marketplace.orders.poll' }),
    });

    const synced = await pollWcDestinationSync(api, world, order.internalOrderId, { timeoutMs: 120_000 });
    expect(synced.status, 'destination sync status').toBe('synced');
    expect(synced.externalOrderId, 'destination WC order id present').toBeTruthy();

    const destinationOrder = await wc.getOrder(synced.externalOrderId!);
    expect(destinationOrder.lineItems.length, 'destination WC order has line items').toBeGreaterThan(0);
    const line = destinationOrder.lineItems.find((l) => l.productId === wcProductId);
    expect(line, `destination WC order line references product ${wcProductId}`).toBeTruthy();
    expect(line!.quantity, 'destination WC order line quantity matches source').toBe(quantity);

    // PRICE - the half this test's name promised and never read. #895 / ADR-014:
    // destination lines MUST be priced at the buyer-paid SOURCE price, never
    // recomputed from the destination shop's own catalogue. Without this
    // comparison a destination order created at 0.00, or re-priced from the
    // shop's list price, passed a test titled "with correct lines, price and
    // status". Both sides read the same WC field on the same store, so the
    // comparison is apples-to-apples; minor units so no float drift can fail it.
    const sourceLine = sourceOrder.lineItems.find((l) => l.productId === wcProductId);
    expect(sourceLine, `source WC order line references product ${wcProductId}`).toBeTruthy();
    const currency = destinationOrder.currency ?? sourceOrder.currency ?? 'PLN';
    expect(sourceLine!.total, 'source WC order line carries a total to compare against').toBeTruthy();
    expect(line!.total, 'destination WC order line carries a total').toBeTruthy();
    expect(
      toMinorUnits(line!.total!, currency),
      `destination line is priced at the buyer-paid source price (#895/ADR-014): source ` +
        `${sourceLine!.total} ${currency}, destination ${line!.total} ${currency}`,
    ).toBe(toMinorUnits(sourceLine!.total!, currency));

    // STATUS: `toBeTruthy()` was unfalsifiable - a WC order always has one. What
    // is falsifiable is that the order landed in a LIVE state: a destination
    // order created straight into `cancelled`/`failed`/`trash` is a real defect
    // that the old check waved through.
    expect(
      destinationOrder.status,
      `destination WC order landed in a live state, not ${destinationOrder.status}`,
    ).not.toMatch(/^(?:cancelled|failed|trash|refunded)$/);
    expect(destinationOrder.status, 'destination WC order status is set').toBeTruthy();
  });

  test('two orders from the same buyer produce exactly one WC customer; a changed address does not break reuse', async ({
    api,
    world,
    jobs,
  }) => {
    const ctx = resolveContext(world, destination);
    test.skip(!ctx, 'no WooCommerce OrderSource connection + a DISTINCT WooCommerce OrderProcessorManager connection, or missing REST credentials');
    const { wcSource, wc } = ctx!;

    const mapped = await findProductMappedToBoth(api, world, wcSource.id, ctx!.wcDestination.id);
    test.skip(
      !mapped,
      'no OL product mapped to BOTH the WooCommerce source and the order-destination connection (run master-catalog.spec.ts, then publish to the destination)',
    );
    const { wcProductId } = mapped!;

    const email = `e2e-reuse-${randomUUID().slice(0, 8)}@example-e2e.invalid`;

    const firstDestination = await createAndSyncWcOrder(api, world, jobs, wc, wcSource.id, {
      billing: { ...ADDRESS_A, email },
      lineItems: [{ productId: wcProductId, quantity: 1 }],
    });
    const secondDestination = await createAndSyncWcOrder(api, world, jobs, wc, wcSource.id, {
      billing: { ...ADDRESS_A, email },
      lineItems: [{ productId: wcProductId, quantity: 1 }],
    });
    // Same buyer, a DIFFERENT address — must still reuse the same WC customer.
    const thirdDestination = await createAndSyncWcOrder(api, world, jobs, wc, wcSource.id, {
      billing: { ...ADDRESS_B, email },
      lineItems: [{ productId: wcProductId, quantity: 1 }],
    });

    const first = await wc.getOrder(firstDestination.externalOrderId!);
    const second = await wc.getOrder(secondDestination.externalOrderId!);
    const third = await wc.getOrder(thirdDestination.externalOrderId!);

    expect(first.customerId, 'first synced order has a WC customer').toBeTruthy();
    expect(second.customerId, 'second synced order reuses the same WC customer').toBe(first.customerId);
    expect(third.customerId, 'third synced order (changed address) still reuses the same WC customer').toBe(
      first.customerId,
    );

    // Each synced order carries ITS OWN inline address - the claim this comment
    // has always made and `expect(third.lineItems.length).toBeGreaterThan(0)`
    // never checked. WooCommerce copies the address onto the order rather than
    // referencing the customer record, so the destination orders' own billing
    // addresses ARE the observable proof that reuse tracking did not
    // cross-contaminate: the third order was placed with a DIFFERENT address and
    // must not have inherited the first two's.
    //
    // Compared between orders, never against the `ADDRESS_A`/`ADDRESS_B`
    // literals: OL and WC each normalise the address on the way through, so an
    // exact-format assertion would be brittle without testing anything extra.
    // The differential is the whole claim.
    expect(
      second.billingAddressKey,
      'the second order (same buyer, SAME address) carries the same inline address as the first',
    ).toBe(first.billingAddressKey);
    expect(
      third.billingAddressKey,
      "the third order (same buyer, CHANGED address) carries its OWN inline address - inheriting " +
        'the first order\'s would mean address reuse cross-contaminated it',
    ).not.toBe(first.billingAddressKey);
    // Non-empty, so the differential above cannot be satisfied by two blanks.
    expect(first.billingAddressKey.replace(/\|/g, ''), 'the first order has a non-empty inline address').not.toBe('');
    expect(third.billingAddressKey.replace(/\|/g, ''), 'the third order has a non-empty inline address').not.toBe('');
  });

  test('an order line for a specific variation hits the correct WC product variation, not the parent', async ({
    api,
    world,
    jobs,
  }) => {
    const ctx = resolveContext(world, destination);
    test.skip(!ctx, 'no WooCommerce OrderSource connection + a DISTINCT WooCommerce OrderProcessorManager connection, or missing REST credentials');
    const { wcSource, wc } = ctx!;

    const multiVariant = await world.findMultiVariantProduct(2, { requireEans: true });
    test.skip(!multiVariant, 'no multi-variant, EAN-complete product on this stack');
    const variants = await world.variantsOf(multiVariant!.id);
    const variant = variants.find((v) => externalIdFor(v.externalIds, wcSource.id));
    test.skip(!variant, 'no variant of the multi-variant product is mapped to the WooCommerce connection');
    // A source mapping alone is not enough: the destination processor rejects
    // any line whose product it cannot resolve on its OWN connection.
    test.skip(
      !externalIdFor(multiVariant!.externalIds, ctx!.wcDestination.id),
      'the multi-variant product has no mapping on the order-destination connection',
    );

    const wcProductId = Number(externalIdFor(multiVariant!.externalIds, wcSource.id));
    const wcVariationExternalId = externalIdFor(variant!.externalIds, wcSource.id)!;
    // A synthetic variant (simple product) has no real WC variation — this
    // scenario specifically needs a variable product's real variation id.
    test.skip(!/^\d+$/.test(wcVariationExternalId), 'variant maps to a synthetic (non-variation) WC external id');
    const wcVariationId = Number(wcVariationExternalId);

    const email = `e2e-variant-${randomUUID().slice(0, 8)}@example-e2e.invalid`;
    const syncedDestination = await createAndSyncWcOrder(api, world, jobs, wc, wcSource.id, {
      billing: { ...ADDRESS_A, email },
      lineItems: [{ productId: wcProductId, variationId: wcVariationId, quantity: 1 }],
    });

    const destinationOrder = await wc.getOrder(syncedDestination.externalOrderId!);
    const line = destinationOrder.lineItems.find((l) => l.productId === wcProductId);
    expect(line, 'destination WC order carries a line for the product').toBeTruthy();
    expect(
      line!.variationId,
      `destination WC order line resolves to variation ${wcVariationId}, not the parent product`,
    ).toBe(wcVariationId);
  });
});

// ── Shared setup ────────────────────────────────────────────────────────────

interface OrderDestinationContext {
  wcSource: Connection;
  wcDestination: Connection;
  wc: WooCommerceRestClient;
}

/**
 * Resolve a WooCommerce connection for `capability`, preferring one with the
 * capability actually ENABLED over `world.connectionWithCapability`'s looser
 * enabled-OR-adapter-supported fallback. With a single WC connection on the
 * stack this makes no difference; once a second WooCommerce connection exists
 * the loose fallback can't tell "the connection actually configured for this
 * role" from "any WC connection whose adapter merely can do it", and picks
 * arbitrarily.
 */
function pickWooCommerceConnection(world: World, capability: string): Connection | undefined {
  const candidates = world
    .connectionsWithCapability(capability)
    .filter((c) => c.platformType === 'woocommerce');
  const enabled = candidates.filter((c) => c.enabledCapabilities.includes(capability));
  return (enabled.length > 0 ? enabled : candidates)[0];
}


/**
 * Name of the throwaway destination connection this spec owns end to end.
 * Stable (not run-unique) so a leaked one from a hard-killed run is ADOPTED on
 * the next run rather than duplicated into a pile of stale connections.
 */
export const E2E_DESTINATION_CONNECTION_NAME = 'WooCommerce (order destination, e2e)';

/**
 * Find-or-create the distinct destination connection this spec requires.
 *
 * The topology is spec-owned rather than hand-curated on the stack, because a
 * persistent second `OrderProcessorManager` connection is not inert: OL fans
 * every ingested order out to EVERY destination carrying that capability, so a
 * always-on second WooCommerce destination makes unrelated orders (and the
 * order-detail UI other specs assert against) show extra sync failures for the
 * whole session. Owning its lifecycle here confines that to this spec's run.
 *
 * Mirrors the source connection's `siteUrl` + master pairing, so the pair is a
 * genuine "same store registered twice" topology - the shape this suite's
 * header documents as the supported single-store alternative to two real stores.
 */
async function ensureDestinationConnection(
  api: ApiClient,
  world: World,
  wcSource: Connection,
): Promise<Connection | null> {
  const existing = world
    .connectionsFor('woocommerce')
    .find((c) => c.name === E2E_DESTINATION_CONNECTION_NAME);
  if (existing) {
    // Adopt a leaked/previous one, re-enabling it if a prior run disabled it.
    return existing.status === 'active'
      ? existing
      : api.connections.update(existing.id, { status: 'active' });
  }

  const consumerKey = process.env.OL_WC_CONSUMER_KEY?.trim();
  const consumerSecret = process.env.OL_WC_CONSUMER_SECRET?.trim();
  const siteUrl = wcSource.config?.['siteUrl'];
  if (!consumerKey || !consumerSecret || typeof siteUrl !== 'string') return null;

  return api.connections.create({
    name: E2E_DESTINATION_CONNECTION_NAME,
    platformType: 'woocommerce',
    config: {
      siteUrl,
      ...(typeof wcSource.config?.['masterCatalogConnectionId'] === 'string'
        ? { masterCatalogConnectionId: wcSource.config['masterCatalogConnectionId'] }
        : {}),
    },
    credentials: { consumerKey, consumerSecret },
    enabledCapabilities: ['OrderProcessorManager', 'ProductPublisher', 'CategoryProvisioner'],
  });
}

/**
 * Disable (never delete) the spec-owned destination. Disabling drops it out of
 * the order fan-out immediately, while keeping its id - and therefore the
 * `ShopProduct` / product identifier mappings keyed to it - intact, so the next
 * run adopts a connection that is already mapped instead of re-seeding.
 */
async function releaseDestinationConnection(api: ApiClient, connectionId: string): Promise<void> {
  await api.connections.update(connectionId, { status: 'disabled' }).catch(() => undefined);
}

function resolveContext(world: World, wcDestination: Connection | null): OrderDestinationContext | null {
  const wcSource = pickWooCommerceConnection(world, 'OrderSource');
  if (!wcSource) return null;
  if (!wcDestination || wcDestination.id === wcSource.id) return null;
  const wc = buildWooCommerceClient(wcSource);
  if (!wc) return null;
  return { wcSource, wcDestination, wc };
}

/**
 * A product mapped to BOTH the source and the destination connection.
 *
 * The destination half matters and is not implied by the source half: OL's
 * order-processor refuses to create "silent partial orders", so it hard-fails
 * a line whose product has no mapping on the DESTINATION connection. On a
 * two-real-stores topology the destination mapping appears naturally from a
 * publish; on the single-store topology this suite also supports, the second
 * connection points at the same physical shop, so its mapping has to be seeded
 * once (a publish would try to CREATE a duplicate product and be rejected by
 * the shop on the duplicate SKU).
 *
 * Returning null here yields a precise skip instead of a sync failure that
 * looks like a product defect.
 */
async function findProductMappedToBoth(
  api: ApiClient,
  world: World,
  sourceConnectionId: string,
  destinationConnectionId: string,
): Promise<{ wcProductId: number } | undefined> {
  const products = await world.listProducts(50);
  for (const summary of products) {
    const detail = await api.products.getById(summary.id);
    const sourceExternalId = externalIdFor(detail.externalIds, sourceConnectionId);
    const destinationExternalId = externalIdFor(detail.externalIds, destinationConnectionId);
    if (!sourceExternalId || !/^\d+$/.test(sourceExternalId)) continue;
    if (!destinationExternalId) continue;
    const variants = await world.variantsOf(detail.id);
    if (variants.length === 0) continue;
    return { wcProductId: Number(sourceExternalId) };
  }
  return undefined;
}

/**
 * Create a native WC order via REST, ingest it through `wcSourceConnectionId`,
 * and poll until a WooCommerce-platform destination shows `synced` — the
 * shared happy-path plumbing for the reuse and variant-mapping scenarios.
 */
async function createAndSyncWcOrder(
  api: ApiClient,
  world: World,
  jobs: SyncJobs,
  wc: WooCommerceRestClient,
  wcSourceConnectionId: string,
  input: { billing: WooCommerceAddressInput; lineItems: Array<{ productId: number; variationId?: number; quantity: number }> },
): Promise<{ externalOrderId: string | null }> {
  const sourceOrder = await wc.createOrder({
    status: 'processing',
    billing: input.billing,
    lineItems: input.lineItems,
  });
  const order = await waitForOrderByExternalId(api, {
    sourceConnectionId: wcSourceConnectionId,
    externalOrderId: String(sourceOrder.id),
    timeoutMs: 120_000,
    retriggerPoll: () => jobs.trigger({ connectionId: wcSourceConnectionId, jobType: 'marketplace.orders.poll' }),
  });
  const synced = await pollWcDestinationSync(api, world, order.internalOrderId, { timeoutMs: 120_000 });
  if (synced.status === 'failed') {
    // A `failed` destination sync is a DESTINATION-ADAPTER failure, not a
    // missing precondition: every caller has already skipped up front unless the
    // ordered product is mapped on BOTH connections, which is the topology gap
    // this path used to blame. Because `pollWcDestinationSync` returns on
    // `failed` and the caller only read `externalOrderId`, a genuine
    // `WooCommerceOrderProcessorAdapter.createOrder` regression reported as a
    // `test.skip` with a plausible-sounding reason - green, forever.
    throw new Error(
      `order ${order.internalOrderId} FAILED to sync to the WooCommerce destination - the ordered ` +
        'product is mapped on both connections (asserted by the caller), so this is a ' +
        'destination-adapter failure, not a missing precondition',
    );
  }
  if (!synced.externalOrderId) {
    // A `synced` entry with no external id: nothing to read back on the shop.
    // Without this the null flows into `GET /orders/null` and surfaces as a
    // bogus WooCommerce 404 instead of a stated precondition.
    test.skip(
      true,
      `order ${order.internalOrderId} reached status=${synced.status} on a WooCommerce destination but carries no external order id`,
    );
  }
  return { externalOrderId: synced.externalOrderId };
}

/**
 * Poll an order record until a syncStatus entry for a WooCommerce-platform
 * destination reaches a terminal state (`synced` or `failed`). Generic over
 * WHICH WooCommerce connection id ends up as the destination — the stack may
 * pair a single multi-capability connection (source == destination) or two
 * distinct WooCommerce connections.
 */
async function pollWcDestinationSync(
  api: ApiClient,
  world: World,
  internalOrderId: string,
  options: { timeoutMs?: number } = {},
): Promise<{ status: string; externalOrderId: string | null }> {
  const wcConnectionIds = new Set(world.connectionsFor('woocommerce').map((c) => c.id));
  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  let last: OrderRecord | undefined;
  while (Date.now() < deadline) {
    const record = await api.orders.getById(internalOrderId);
    last = record;
    const entry = record.syncStatus.find((s) => wcConnectionIds.has(s.destinationConnectionId));
    if (entry && (entry.status === 'synced' || entry.status === 'failed')) {
      return { status: entry.status, externalOrderId: entry.externalOrderId };
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(
    `Timed out waiting for a WooCommerce destination sync on order ${internalOrderId}. ` +
      `Last syncStatus: ${JSON.stringify(last?.syncStatus ?? [])}`,
  );
}

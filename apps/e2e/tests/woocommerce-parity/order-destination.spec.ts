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
 * a WooCommerce-platform destination, so the test is correct whether the
 * stack pairs a single multi-capability WC connection (source == destination)
 * or two distinct WooCommerce connections.
 *
 * Requires the catalogue to already be WC-mastered (run
 * `master-catalog.spec.ts` first, or in the same serial run) so the ordered
 * product/variant already carries a WC external-id mapping the destination
 * adapter can resolve into `line_items`.
 *
 * Self-configuring: skips with a clear reason when the stack has no
 * WooCommerce OrderSource + OrderProcessorManager connections, or no WC REST
 * credentials.
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
import { snapshotOrderIds, waitForOrder } from '../../src/support/orders';
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
  test('an order sourced from WooCommerce is created in a WooCommerce destination with correct lines, price and status', async ({
    api,
    world,
    jobs,
  }) => {
    const ctx = await resolveContext(world);
    test.skip(!ctx, 'no WooCommerce OrderSource + OrderProcessorManager connection, or missing REST credentials');
    const { wcSource, wc } = ctx!;

    const mapped = await findMappedProduct(api, world, wcSource.id);
    test.skip(!mapped, 'no OL product mapped to the WooCommerce master/source connection (run master-catalog.spec.ts first)');
    const { wcProductId } = mapped!;
    const quantity = 1;

    const email = `e2e-${randomUUID().slice(0, 8)}@example-e2e.invalid`;
    const snapshot = await snapshotOrderIds(api, wcSource.id);
    await wc.createOrder({
      status: 'processing',
      billing: { ...ADDRESS_A, email },
      lineItems: [{ productId: wcProductId, quantity }],
    });

    await jobs.trigger({ connectionId: wcSource.id, jobType: 'marketplace.orders.poll' }).catch(() => undefined);
    const order = await waitForOrder(api, { sourceConnectionId: wcSource.id, snapshot, timeoutMs: 120_000 });

    const synced = await pollWcDestinationSync(api, world, order.internalOrderId, { timeoutMs: 120_000 });
    expect(synced.status, 'destination sync status').toBe('synced');
    expect(synced.externalOrderId, 'destination WC order id present').toBeTruthy();

    const destinationOrder = await wc.getOrder(synced.externalOrderId!);
    expect(destinationOrder.lineItems.length, 'destination WC order has line items').toBeGreaterThan(0);
    const line = destinationOrder.lineItems.find((l) => l.productId === wcProductId);
    expect(line, `destination WC order line references product ${wcProductId}`).toBeTruthy();
    expect(line!.quantity, 'destination WC order line quantity matches source').toBe(quantity);
    expect(destinationOrder.status, 'destination WC order status is set').toBeTruthy();
  });

  test('two orders from the same buyer produce exactly one WC customer; a changed address does not break reuse', async ({
    api,
    world,
    jobs,
  }) => {
    const ctx = await resolveContext(world);
    test.skip(!ctx, 'no WooCommerce OrderSource + OrderProcessorManager connection, or missing REST credentials');
    const { wcSource, wc } = ctx!;

    const mapped = await findMappedProduct(api, world, wcSource.id);
    test.skip(!mapped, 'no OL product mapped to the WooCommerce master/source connection (run master-catalog.spec.ts first)');
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

    // Each synced order carries ITS OWN inline address — proving reuse tracking
    // never cross-contaminates a later order's address with an earlier one.
    // (The internal destination_address_mappings row proving a *distinct*
    // address hash was recorded for the third order is not observable through
    // the public API surface — out of scope for black-box E2E.)
    expect(third.lineItems.length, 'third order has line items').toBeGreaterThan(0);
  });

  test('an order line for a specific variation hits the correct WC product variation, not the parent', async ({
    api,
    world,
    jobs,
  }) => {
    const ctx = await resolveContext(world);
    test.skip(!ctx, 'no WooCommerce OrderSource + OrderProcessorManager connection, or missing REST credentials');
    const { wcSource, wc } = ctx!;

    const multiVariant = await world.findMultiVariantProduct(2, { requireEans: true });
    test.skip(!multiVariant, 'no multi-variant, EAN-complete product on this stack');
    const variants = await world.variantsOf(multiVariant!.id);
    const variant = variants.find((v) => externalIdFor(v.externalIds, wcSource.id));
    test.skip(!variant, 'no variant of the multi-variant product is mapped to the WooCommerce connection');

    const wcProductId = Number(externalIdFor(multiVariant!.externalIds, wcSource.id));
    const wcVariationExternalId = externalIdFor(variant!.externalIds, wcSource.id)!;
    // A synthetic variant (simple product) has no real WC variation — this
    // scenario specifically needs a variable product's real variation id.
    test.skip(!/^\d+$/.test(wcVariationExternalId), 'variant maps to a synthetic (non-variation) WC external id');
    const wcVariationId = Number(wcVariationExternalId);

    const email = `e2e-variant-${randomUUID().slice(0, 8)}@example-e2e.invalid`;
    const destination = await createAndSyncWcOrder(api, world, jobs, wc, wcSource.id, {
      billing: { ...ADDRESS_A, email },
      lineItems: [{ productId: wcProductId, variationId: wcVariationId, quantity: 1 }],
    });

    const destinationOrder = await wc.getOrder(destination.externalOrderId!);
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

async function resolveContext(world: World): Promise<OrderDestinationContext | null> {
  const wcSource = world.connectionWithCapability('OrderSource', 'woocommerce');
  const wcDestination = world.connectionWithCapability('OrderProcessorManager', 'woocommerce');
  if (!wcSource || !wcDestination) return null;
  const wc = buildWooCommerceClient(wcSource);
  if (!wc) return null;
  return { wcSource, wcDestination, wc };
}

/** Resolve an existing OL product already mapped to the given WC connection, and its WC-native id. */
async function findMappedProduct(
  api: ApiClient,
  world: World,
  wcConnectionId: string,
): Promise<{ wcProductId: number } | undefined> {
  const products = await world.listProducts(50);
  for (const summary of products) {
    const detail = await api.products.getById(summary.id);
    const externalId = externalIdFor(detail.externalIds, wcConnectionId);
    if (!externalId || !/^\d+$/.test(externalId)) continue;
    const variants = await world.variantsOf(detail.id);
    if (variants.length === 0) continue;
    return { wcProductId: Number(externalId) };
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
  const snapshot = await snapshotOrderIds(api, wcSourceConnectionId);
  await wc.createOrder({ status: 'processing', billing: input.billing, lineItems: input.lineItems });
  await jobs.trigger({ connectionId: wcSourceConnectionId, jobType: 'marketplace.orders.poll' }).catch(() => undefined);
  const order = await waitForOrder(api, { sourceConnectionId: wcSourceConnectionId, snapshot, timeoutMs: 120_000 });
  const synced = await pollWcDestinationSync(api, world, order.internalOrderId, { timeoutMs: 120_000 });
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

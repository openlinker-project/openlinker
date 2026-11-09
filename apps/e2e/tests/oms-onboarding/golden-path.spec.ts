/**
 * OMS onboarding - what packing in OpenLinker does to orders (#3458)
 *
 * Runs on the dev stack AFTER the wizard has turned packing on (run
 * `live-walk.spec.ts`'s steps, or the wizard by hand, first). Every test reads
 * the wizard's own `data-state` and skips unless it is `status-on`.
 *
 *   1. Golden path (#3453, attended): one Allegro order placed after step 7
 *      reaches `/fulfillment` as Unassigned, is NOT created in PrestaShop, and
 *      lowers the PrestaShop stock by the sold quantity.
 *   2. Step 4 rule (#3485, attended): an Allegro order for a product with no
 *      stock in the product master waits in `/orders` with a reason
 *      (`routing-refused`) instead of going anywhere.
 *   3. Step 4 rule (#3487, unattended): an order placed in the PrestaShop store
 *      itself never reaches `/fulfillment` (`own-shop-order`).
 *
 * The issue numbers its rules against the 4-step mockup ("step 3"); in the
 * shipped 7-step wizard they are listed on step 4, "See what changes".
 *
 * MUTATING: buys on the Allegro sandbox (operator) and synthesizes a
 * PrestaShop order. The attended tests run only with `E2E_ATTENDED=1`, through
 * the same file-based checkpoint the full flow uses.
 *
 * @module tests/oms-onboarding
 */
import { test, expect } from '../../src/fixtures/test';
import type { ApiClient } from '../../src/api/api-client';
import type { Connection, OrderRecord } from '../../src/api/api.types';
import { OmsOnboardingPage } from '../../src/pages/oms-onboarding.page';
import { AssignPackingWorkPage } from '../../src/pages/assign-packing-work.page';
import { manualCheckpoint } from '../../src/support/manual-checkpoint';
import { snapshotOrderIds, waitForOrder } from '../../src/support/orders';
import { externalIdFor } from '../../src/support/external-ids';
import {
  buildPrestashopWebserviceClient,
  resolvePrestashopStore,
  synthesizeOrder,
} from '../../src/support/order-synthesis';
import { pollUntil } from '../../src/support/poller';

const ATTENDED = process.env.E2E_ATTENDED === '1';
const ROUTED_TIMEOUT_MS = 5 * 60_000;

test.describe.configure({ mode: 'serial' });

/** Whether this spec turned packing on, so `afterAll` can turn it off again. */
let turnedOnHere = false;

/**
 * Packing must be on. A stack left with packing OFF (the walk ends that way)
 * is turned on through the status page's own Start button and turned off
 * again after the file; a stack that was never set up is skipped.
 */
async function requirePackingOn(page: import('@playwright/test').Page): Promise<void> {
  const wizard = new OmsOnboardingPage(page);
  await wizard.goto();
  if ((await wizard.state()) === 'status-off') {
    await wizard.byTestId('btn-turn-on').click();
    await wizard.expectState('status-on');
    turnedOnHere = true;
  }
  const state = await wizard.state();
  test.skip(state !== 'status-on', `packing is not set up (wizard reads ${state}); run the onboarding first`);
}

function orderLines(order: OrderRecord): Array<{ productId: string; variantId: string | null; quantity: number }> {
  const items = order.orderSnapshot['items'];
  if (!Array.isArray(items)) return [];
  return items.flatMap((item: unknown) => {
    const record = item as Record<string, unknown>;
    const productId = typeof record['productId'] === 'string' ? record['productId'] : null;
    if (productId === null) return [];
    const variantId = typeof record['variantId'] === 'string' ? record['variantId'] : null;
    const quantity = typeof record['quantity'] === 'number' ? record['quantity'] : 1;
    return [{ productId, variantId, quantity }];
  });
}

/** PrestaShop's own stock for an OL product, through the webservice. */
async function prestashopStock(
  api: ApiClient,
  ps: NonNullable<ReturnType<typeof buildPrestashopWebserviceClient>>,
  prestashop: Connection,
  productId: string,
): Promise<number | null> {
  const product = await api.products.getById(productId);
  const psId = externalIdFor(product.externalIds, prestashop.id);
  return psId === undefined ? null : ps.getStockForProduct(psId);
}

test.describe('OMS onboarding - orders after packing is on (#3458)', () => {
  test.afterAll(async ({ browser, baseURL }) => {
    if (!turnedOnHere) return;
    const context = await browser.newContext({ baseURL, storageState: '.auth/admin.json' });
    const page = await context.newPage();
    const wizard = new OmsOnboardingPage(page);
    await wizard.goto();
    if ((await wizard.state()) === 'status-on') {
      await wizard.byTestId('btn-ask-stop').click();
      await wizard.byTestId('btn-stop-now').click();
      await wizard.expectState('status-off');
    }
    await context.close();
  });

  test('should put an Allegro order on /fulfillment as Unassigned, not in PrestaShop, and lower PrestaShop stock', async ({
    page,
    api,
    world,
  }, testInfo) => {
    test.skip(!ATTENDED, 'attended: set E2E_ATTENDED=1 to buy on the Allegro sandbox');
    const allegro = world.connectionFor('allegro');
    const prestashop = resolvePrestashopStore(world);
    test.skip(allegro === undefined, 'no active Allegro connection');
    test.skip(prestashop === undefined, 'no active PrestaShop connection');
    const ps = buildPrestashopWebserviceClient(world);
    test.skip(ps === null, 'OL_PS_WEBSERVICE_KEY is needed to read PrestaShop stock');
    await requirePackingOn(page);

    const snapshot = await snapshotOrderIds(api, allegro!.id);
    await manualCheckpoint(testInfo, {
      dashboard: 'MANUAL PURCHASE - Allegro (packing in OpenLinker is on)',
      expect: [
        'Buy exactly 1 unit of an Allegro offer whose product HAS stock in PrestaShop',
        'Complete checkout, then resume',
      ],
      severity: 'fatal',
    });

    const order = await waitForOrder(api, { sourceConnectionId: allegro!.id, snapshot });
    const lines = orderLines(order);
    expect(lines.length, 'the order carries no resolved line').toBeGreaterThan(0);

    // Routed, not mirrored: work exists, and PrestaShop has no copy of the order.
    const works = await pollUntil(
      async () => {
        const result = await api.fulfillment.listWorksForOrder(order.internalOrderId);
        return result.works.length > 0 ? result.works : undefined;
      },
      (value) => value !== undefined,
      { timeoutMs: ROUTED_TIMEOUT_MS, intervalMs: 5_000, message: 'fulfilment work for the Allegro order' },
    );
    const fresh = await api.orders.getById(order.internalOrderId);
    expect(fresh.fulfillmentRoutingSkipReason ?? null).toBeNull();
    expect(fresh.fulfillmentBlockReason ?? null).toBeNull();
    expect(fresh.syncStatus.filter((s) => s.destinationConnectionId === prestashop!.id)).toEqual([]);
    for (const work of works!) expect(work.assignedToUserId).toBeNull();

    // On /fulfillment, in the Unassigned lane.
    const board = new AssignPackingWorkPage(page);
    await board.goto();
    for (const work of works!) {
      await expect(board.laneFor('Unassigned').locator(`[data-task-id="${work.id}"]`)).toBeVisible();
    }
    const shot = testInfo.outputPath('fulfilment-unassigned.png');
    await page.screenshot({ path: shot, fullPage: true });
    await testInfo.attach('fulfilment - Unassigned', { path: shot, contentType: 'image/png' });

    // PrestaShop stock lowered (#3453): a `sale` movement for every line, and
    // the shop's own number matches what the movement recorded.
    for (const line of lines) {
      const movement = await pollUntil(
        async () => {
          if (line.variantId === null) return undefined;
          const history = await api.inventory.movements({ productVariantId: line.variantId, kind: 'movements', limit: 20 });
          return history.items.find(
            (m) => m.reason === 'sale' && new Date(m.occurredAt).getTime() >= snapshot.takenAt.getTime() - 60_000,
          );
        },
        (value) => value !== undefined,
        { timeoutMs: ROUTED_TIMEOUT_MS, intervalMs: 5_000, message: 'sale movement for the routed line' },
      );
      expect(movement!.quantityBefore! - movement!.quantityAfter!).toBe(line.quantity);
      const shopNow = await prestashopStock(api, ps!, prestashop!, line.productId);
      // The mirror is rewritten from the master's own answer after the
      // decrement, so the shop must read what the movement recorded.
      if (shopNow !== null) expect(shopNow).toBe(movement!.quantityAfter);
    }
  });

  test('should keep an Allegro order for an out-of-stock product waiting in /orders with a reason', async ({
    page,
    api,
    world,
  }, testInfo) => {
    test.skip(!ATTENDED, 'attended: set E2E_ATTENDED=1 to buy on the Allegro sandbox');
    const allegro = world.connectionFor('allegro');
    test.skip(allegro === undefined, 'no active Allegro connection');
    await requirePackingOn(page);

    const snapshot = await snapshotOrderIds(api, allegro!.id);
    await manualCheckpoint(testInfo, {
      dashboard: 'MANUAL PURCHASE - Allegro, product with NO stock in the product master',
      expect: [
        'In PrestaShop, set the stock of one product that has a live Allegro offer to 0 (keep the offer buyable on Allegro)',
        'Buy 1 unit of that Allegro offer, complete checkout',
        'Resume; restore the PrestaShop stock afterwards',
      ],
      severity: 'fatal',
    });
    const order = await waitForOrder(api, { sourceConnectionId: allegro!.id, snapshot });

    const held = await pollUntil(
      async () => {
        const fresh = await api.orders.getById(order.internalOrderId);
        return fresh.fulfillmentBlockReason ? fresh : undefined;
      },
      (value) => value !== undefined,
      { timeoutMs: ROUTED_TIMEOUT_MS, intervalMs: 5_000, message: 'the order held by routing' },
    );
    expect(held!.fulfillmentBlockReason).toBe('routing-refused');
    expect(held!.syncStatus, 'a held order is mirrored nowhere').toEqual([]);
    expect((await api.fulfillment.listWorksForOrder(order.internalOrderId)).works).toEqual([]);

    await page.goto(`/orders/${order.internalOrderId}`);
    await expect(page.getByText(/Waiting/).first()).toBeVisible();
    const shot = testInfo.outputPath('orders-waiting.png');
    await page.screenshot({ path: shot, fullPage: true });
    await testInfo.attach('orders - waiting with a reason', { path: shot, contentType: 'image/png' });
  });

  test('should keep an order placed in the PrestaShop store off /fulfillment', async ({
    page,
    api,
    world,
    jobs,
    poll,
  }) => {
    test.skip(resolvePrestashopStore(world) === undefined, 'no active PrestaShop connection');
    test.skip(buildPrestashopWebserviceClient(world) === null, 'OL_PS_WEBSERVICE_KEY is needed to place a shop order');
    await requirePackingOn(page);

    const { order } = await synthesizeOrder({ api, world, jobs, poll });

    const decided = await pollUntil(
      async () => {
        const fresh = await api.orders.getById(order.internalOrderId);
        return fresh.fulfillmentRoutingSkipReason ? fresh : undefined;
      },
      (value) => value !== undefined,
      { timeoutMs: ROUTED_TIMEOUT_MS, intervalMs: 5_000, message: 'the routing skip decision' },
    );
    expect(decided!.fulfillmentRoutingSkipReason).toBe('own-shop-order');
    expect(decided!.handledInOpenLinker ?? null).toBeNull();
    expect((await api.fulfillment.listWorksForOrder(order.internalOrderId)).works).toEqual([]);
  });
});

/**
 * Order ingestion: where a new connection's order sync starts (#4228)
 *
 * A connection used to import the shop's whole order history the moment it was
 * added. It now starts from "now" unless the operator chose otherwise
 * (`orderSyncStart`: `now` | `from` a date | `all`). Each mode below runs on its
 * OWN throwaway PrestaShop connection pointing at the same shop, because the
 * feed position lives on the connection: reusing the master connection would
 * make the second mode inherit the first one's position.
 *
 * SETUP USES THE API. The connection wizard's "Order history" step is not
 * driven here: no page object covers the PrestaShop wizard yet, and the choice
 * is the same `orderSyncStart` field the wizard posts. The one UI assertion is
 * the "Order sync" panel on the connection's health tab.
 *
 * WHAT `from` CAN AND CANNOT PROVE. The PrestaShop feed position is date
 * granular (`cursorForDate` answers `YYYY-MM-DD 00:00:00|0`), and every order
 * this suite seeds is created today. So a same-day `from` cannot separate "old"
 * from "new" orders inside one test day. What is provable, and asserted: a
 * `from` of today imports today's orders, and a `from` in the future is refused
 * with a 400 naming `orderSyncStart`. The older-than-the-date half of the
 * contract is covered by the adapter's unit tests, not here.
 *
 * MUTATING: seeds real PrestaShop orders and creates connections (archived
 * afterwards), so `retries: 0` via the `order-ingestion` project. Serial: the
 * cases share the seeded orders.
 *
 * @module tests/order-ingestion
 */
import { test, expect } from '../../src/fixtures/test';
import { ApiError } from '../../src/api/api-error';
import type { ApiClient } from '../../src/api/api-client';
import type {
  Connection,
  CreateConnectionInput,
  OrderRecord,
  OrderSyncStartInput,
} from '../../src/api/api.types';
import type { SyncJobs } from '../../src/support/jobs';
import { JobType } from '../../src/support/jobs';
import { matchesExternalOrderId } from '../../src/support/orders';
import { pollUntil } from '../../src/support/poller';
import {
  buildPrestashopWebserviceClient,
  createSourceOrder,
  resolvePrestashopStore,
} from '../../src/support/order-synthesis';

const OLD_ORDER_COUNT = 3;
const POLL_BUDGET_MS = 120_000;
/** Longer than a second, so a `date_upd` written before it is strictly older than the feed position. */
const CLOCK_GAP_MS = 2_500;

test.describe.configure({ mode: 'serial' });

test.describe('order ingestion: order sync start (#4228)', () => {
  const stamp = Date.now().toString(36);
  const created: Connection[] = [];
  let master: Connection | undefined;
  let oldExternalIds: string[] = [];
  let seedError: string | null = null;

  test.beforeAll(async ({ api, world }) => {
    master = resolvePrestashopStore(world);
    const ps = buildPrestashopWebserviceClient(world);
    if (!master || !ps) {
      seedError =
        'needs a PrestaShop store connection and OL_PS_WEBSERVICE_KEY (+ a resolvable PS base URL)';
      return;
    }
    try {
      // Seeded BEFORE any throwaway connection exists: these are the shop's
      // "history" the modes must treat differently.
      for (let i = 0; i < OLD_ORDER_COUNT; i += 1) {
        const seeded = await createSourceOrder({ api, world });
        oldExternalIds.push(seeded.externalOrderId);
      }
      await new Promise((resolve) => setTimeout(resolve, CLOCK_GAP_MS));
    } catch (error) {
      seedError = error instanceof Error ? error.message : String(error);
      oldExternalIds = [];
    }
  });

  test.afterAll(async ({ api }) => {
    for (const connection of created) {
      await api.connections.update(connection.id, { status: 'disabled' }).catch(() => undefined);
      await api.connections.archive(connection.id).catch(() => undefined);
    }
  });

  async function createThrowaway(
    api: ApiClient,
    label: string,
    orderSyncStart: OrderSyncStartInput,
  ): Promise<Connection> {
    const key = process.env.OL_PS_WEBSERVICE_KEY?.trim();
    const input: CreateConnectionInput = {
      name: `e2e-sync-start-${label}-${stamp}`,
      platformType: 'prestashop',
      adapterKey: 'prestashop.webservice.v1',
      config: { ...(master?.config ?? {}) },
      credentials: { webserviceApiKey: key },
      enabledCapabilities: ['OrderSource'],
      orderSyncStart,
    };
    const connection = await api.connections.create(input);
    created.push(connection);
    return connection;
  }

  async function ordersOf(api: ApiClient, connectionId: string): Promise<OrderRecord[]> {
    const page = await api.orders.list({ sourceConnectionId: connectionId, limit: 100 });
    return page.items;
  }

  async function pollOnce(jobs: SyncJobs, connectionId: string): Promise<void> {
    await jobs.triggerAndWait(
      { connectionId, jobType: JobType.marketplaceOrdersPoll },
      { timeoutMs: POLL_BUDGET_MS },
    );
  }

  function requireSeeded(): void {
    test.skip(seedError !== null, `could not seed old orders: ${seedError}`);
  }

  test('now: existing orders are not imported, and only a new order arrives', async ({
    api,
    world,
    jobs,
  }) => {
    requireSeeded();
    const connection = await createThrowaway(api, 'now', { mode: 'now' });

    await pollOnce(jobs, connection.id);
    const afterFirstPoll = await ordersOf(api, connection.id);
    expect(afterFirstPoll, 'the first poll must not import the shop history').toHaveLength(0);
    for (const id of oldExternalIds) {
      expect(afterFirstPoll.some((o) => matchesExternalOrderId(o, id))).toBe(false);
    }

    const status = await api.connections.getSyncStatus(connection.id);
    expect(status.orderSyncStartedAt, 'the start of order sync is recorded').not.toBeNull();

    // A new order, created strictly after the feed position was recorded.
    await new Promise((resolve) => setTimeout(resolve, CLOCK_GAP_MS));
    const fresh = await createSourceOrder({ api, world });
    const arrived = await pollUntil(
      async () => {
        await pollOnce(jobs, connection.id);
        return ordersOf(api, connection.id);
      },
      (orders) => orders.some((o) => matchesExternalOrderId(o, fresh.externalOrderId)),
      {
        timeoutMs: POLL_BUDGET_MS,
        intervalMs: 3_000,
        message: `the new order ${fresh.externalOrderId} to arrive on the "now" connection`,
      },
    );
    expect(arrived, 'exactly the new order, none of the old ones').toHaveLength(1);
  });

  test('all: the whole order history is imported', async ({ api, jobs }) => {
    requireSeeded();
    const connection = await createThrowaway(api, 'all', { mode: 'all' });

    const orders = await pollUntil(
      async () => {
        await pollOnce(jobs, connection.id);
        return ordersOf(api, connection.id);
      },
      (list) => oldExternalIds.every((id) => list.some((o) => matchesExternalOrderId(o, id))),
      {
        timeoutMs: POLL_BUDGET_MS,
        intervalMs: 3_000,
        message: `all ${OLD_ORDER_COUNT} old orders to be imported on the "all" connection`,
      },
    );
    expect(orders.length).toBeGreaterThanOrEqual(OLD_ORDER_COUNT);
  });

  test('from: today imports today\'s orders, and a future date is refused', async ({ api, jobs }) => {
    requireSeeded();
    // The date is the shop-side day the orders were created on. If the runner
    // and the shop straddle midnight in different zones this can miss; that is a
    // known limit of a date-granular feed, not of the feature.
    const today = new Date().toISOString().slice(0, 10);
    const connection = await createThrowaway(api, 'from-today', { mode: 'from', from: today });

    await pollUntil(
      async () => {
        await pollOnce(jobs, connection.id);
        return ordersOf(api, connection.id);
      },
      (list) => oldExternalIds.every((id) => list.some((o) => matchesExternalOrderId(o, id))),
      {
        timeoutMs: POLL_BUDGET_MS,
        intervalMs: 3_000,
        message: `today's orders to be imported from ${today}`,
      },
    );

    const tomorrow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const refusal = await api.connections
      .create({
        name: `e2e-sync-start-from-future-${stamp}`,
        platformType: 'prestashop',
        adapterKey: 'prestashop.webservice.v1',
        config: { ...(master?.config ?? {}) },
        credentials: { webserviceApiKey: process.env.OL_PS_WEBSERVICE_KEY?.trim() },
        enabledCapabilities: ['OrderSource'],
        orderSyncStart: { mode: 'from', from: tomorrow },
      })
      .then(
        (leaked) => {
          created.push(leaked);
          return null;
        },
        (error: unknown) => error,
      );
    expect(refusal, 'a start date in the future must be refused').toBeInstanceOf(ApiError);
    const apiError = refusal as ApiError;
    expect(apiError.status).toBe(400);
    expect(JSON.stringify(apiError.body)).toContain('orderSyncStart');
  });

  test('the connection health tab shows the Order sync panel with a Live row', async ({
    page,
    pages,
  }) => {
    requireSeeded();
    const connection = created.find((c) => c.name.startsWith('e2e-sync-start-now-'));
    test.skip(!connection, 'the "now" connection was not created');
    await pages.connectionDetail.goto(connection!.id, 'health');
    await pages.connectionDetail.expectOrderSyncPanel();
    await expect(page).toHaveURL(new RegExp(`/connections/${connection!.id}`));
  });

  test('the worker stayed healthy: no dead and no stuck order poll jobs', async ({ api }) => {
    requireSeeded();
    test.skip(created.length === 0, 'no throwaway connection was created');
    for (const connection of created) {
      const dead = await api.syncJobs.list({
        connectionId: connection.id,
        jobType: JobType.marketplaceOrdersPoll,
        status: 'dead',
        limit: 100,
      });
      expect(dead.items, `dead order polls on ${connection.name}`).toHaveLength(0);

      for (const status of ['queued', 'running'] as const) {
        const open = await pollUntil(
          () =>
            api.syncJobs.list({
              connectionId: connection.id,
              jobType: JobType.marketplaceOrdersPoll,
              status,
              limit: 100,
            }),
          (page) => page.items.length === 0,
          {
            timeoutMs: 60_000,
            intervalMs: 3_000,
            message: `no ${status} order poll to remain on ${connection.name}`,
          },
        );
        expect(open.items).toHaveLength(0);
      }
    }
  });
});

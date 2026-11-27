/**
 * A shop that is its own only destination still gets its sales document (#3959)
 *
 * Topology this spec needs: the PrestaShop store is the order source, and no
 * OTHER active connection can create orders (`OrderProcessorManager`). The
 * order then has nowhere to be copied to. Before #3959 that empty fan-out
 * threw inside `syncOrder`, which ended ingestion before the auto-issue step:
 * the order was persisted, but no invoice or receipt was ever decided and
 * `marketplace.order.sync` climbed its retry ladder against a condition no
 * retry can change.
 *
 * What it asserts, for a paid order:
 * 1. a sales document appears on the primary `auto-on-paid` invoicing
 *    connection, and
 * 2. no `marketplace.order.sync` job failed for that order, so nothing climbs
 *    the retry ladder.
 *
 * On a stack where another active order destination exists the empty fan-out
 * cannot happen, so the spec skips with that reason instead of passing.
 *
 * MUTATING: synthesizes one PrestaShop order (customer, address, cart, order).
 * Issues a real document on the invoicing connection, which on a sandbox
 * provider is the point.
 *
 * @module tests/order-ingestion
 */
import { test, expect } from '../../src/fixtures/test';
import type { Connection, InvoiceRecord, SyncJob } from '../../src/api/api.types';
import {
  buildPrestashopWebserviceClient,
  resolvePrestashopStore,
  synthesizeOrder,
} from '../../src/support/order-synthesis';

const ORDER_PROCESSOR = 'OrderProcessorManager';

function readPath(config: Record<string, unknown> | null | undefined, path: string[]): unknown {
  let node: unknown = config;
  for (const key of path) {
    if (!node || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

function isAutoOnPaidInvoicing(c: Connection): boolean {
  return (
    c.status === 'active' &&
    c.enabledCapabilities.includes('Invoicing') &&
    readPath(c.config, ['invoicing', 'triggerModel']) === 'auto-on-paid' &&
    readPath(c.config, ['salesDocument', 'documentKind']) === 'invoice'
  );
}

test.describe('own-only destination: sales documents (#3959)', () => {
  test('a paid order from a shop with no other destination gets its invoice', async ({
    api,
    world,
    jobs,
    poll,
  }) => {
    test.skip(
      !buildPrestashopWebserviceClient(world),
      'needs OL_PS_WEBSERVICE_KEY (+ a resolvable PS base URL) to synthesize PrestaShop orders'
    );
    const store = resolvePrestashopStore(world);
    test.skip(!store, 'needs an active PrestaShop connection');
    test.skip(
      !store!.enabledCapabilities.includes('OrderSource'),
      'the PrestaShop connection must be an order source'
    );

    const connections = await api.connections.list();
    const otherDestinations = connections.filter(
      (c) =>
        c.id !== store!.id &&
        c.status === 'active' &&
        c.enabledCapabilities.includes(ORDER_PROCESSOR)
    );
    test.skip(
      otherDestinations.length > 0,
      `another active order destination exists (${otherDestinations.map((c) => c.name).join(', ')}), so the fan-out is not empty`
    );

    const invoicing = connections.filter(isAutoOnPaidInvoicing);
    test.skip(
      invoicing.length !== 1,
      `needs exactly one active auto-on-paid invoice connection, found ${invoicing.length}`
    );
    const invoicingConnection = invoicing[0];

    const synthesized = await synthesizeOrder({ api, world, jobs, poll });
    const orderId = synthesized.order.internalOrderId;

    const invoice = await poll.until<InvoiceRecord | null>(
      () => api.invoices.getForOrder(orderId, invoicingConnection.id).catch(() => null),
      (record) => record !== null,
      {
        timeoutMs: 120_000,
        message: `an invoice for order ${orderId} on ${invoicingConnection.name}`,
      }
    );
    expect(invoice!.orderId).toBe(orderId);

    // A job that hit the empty fan-out names the order in its error. Job keys
    // cannot be matched to the order (a direct re-trigger uses a random key),
    // so the error text is the reliable link.
    const failedForOrder = (
      await api.syncJobs.list({
        connectionId: store!.id,
        jobType: 'marketplace.order.sync',
        limit: 100,
      })
    ).items.filter((job: SyncJob) => job.lastError?.includes(orderId));
    expect(
      failedForOrder.map((job) => `${job.status} x${job.attempts}: ${job.lastError}`),
      'no order-sync job for this order may fail'
    ).toEqual([]);
  });
});

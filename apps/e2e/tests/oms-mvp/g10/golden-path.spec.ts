/**
 * G10 golden path - receipts at once, invoices in a batch (#3585)
 *
 * Real stack, real worker. A dual-role e-paragony connection issues receipts
 * immediately and invoices in batches; routing sends B2B orders to an invoice
 * and B2C orders to a receipt.
 *
 * 1. The paid B2B order waits in the batch queue; the paid B2C order (a
 *    receipt, issued at once) never appears in it.
 * 2. "Run now" runs the queue: the B2B order is sent to issue exactly once.
 * 3. The order that already holds an invoice on another connection is shown
 *    as blocked and gets no second document.
 * 4. Run history shows the run and each order's result.
 * 5. A second "Run now" issues nothing more: still one document per order.
 *
 * Scope note: the seeded connection's credential is synthetic, so the
 * provider call itself fails after the run hands it over. What this proves is
 * the batch's half of the contract - one issue request per order, never two,
 * and none for an order that already has a document. That the document then
 * reaches the provider is the ordinary `invoicing.issue` path, covered by the
 * invoicing suites. The receipt being issued at once is decided by the gate
 * on ingestion (unit-tested in #3582); here it shows as the receipt order
 * staying out of the queue.
 *
 * @module tests/oms-mvp/g10
 */
import { test, expect } from '../../../src/fixtures/test';
import { BatchIssuingPage } from '../../../src/pages/batch-issuing.page';
import {
  G10_CONNECTION_ID,
  G10_ORDER_IDS,
  countOrderDocuments,
  seedBatchGoldenPath,
} from '../../../src/support/batch-issuing-seed';

test.describe.configure({ mode: 'serial' });

test.describe('G10 golden path - batched invoices, immediate receipts (#3585)', () => {
  const createdRuleIds: string[] = [];

  test.beforeAll(async ({ api }) => {
    await seedBatchGoldenPath();
    for (const rule of await api.salesDocuments.rules('PL')) {
      if (rule.connectionId === G10_CONNECTION_ID) await api.salesDocuments.deleteRule(rule.id);
    }
    const effectiveFrom = new Date(Date.now() - 60_000).toISOString();
    for (const [hasTaxId, documentKind] of [
      [true, 'invoice'],
      [false, 'fiscal-receipt'],
    ] as const) {
      const rule = await api.salesDocuments.createRule({
        country: 'PL',
        conditions: [{ field: 'buyerHasTaxId', op: 'eq', value: hasTaxId }],
        documentKind,
        connectionId: G10_CONNECTION_ID,
        effectiveFrom,
      });
      createdRuleIds.push(rule.id);
    }
  });

  test.afterAll(async ({ api }) => {
    for (const id of createdRuleIds) await api.salesDocuments.deleteRule(id);
  });

  test('the B2B order waits in the queue and the B2C receipt order does not', async ({ page }) => {
    const screen = new BatchIssuingPage(page);
    await screen.goto(G10_CONNECTION_ID);
    await screen.openTab('Next batch');
    await screen.expectState('queue');

    await expect(screen.queueRow(G10_ORDER_IDS.b2b)).toContainText('Invoice');
    await expect(screen.queueRow(G10_ORDER_IDS.documented)).toBeVisible();
    await expect(screen.queueRow(G10_ORDER_IDS.b2c)).toHaveCount(0);
  });

  test('Run now sends the B2B invoice once and leaves the documented order alone', async ({
    page,
    api,
    poll,
  }) => {
    const screen = new BatchIssuingPage(page);
    await screen.goto(G10_CONNECTION_ID);
    await screen.openTab('Next batch');
    await screen.runNow().click();

    const run = await poll.until(
      async () => (await api.salesDocumentBatches.runs(G10_CONNECTION_ID)).runs[0],
      (latest) => latest !== undefined && latest.status !== 'running',
      { timeoutMs: 90_000, message: 'the batch run to finish' }
    );
    if (run === undefined) throw new Error('No batch run was recorded.');
    expect(run.status).toBe('completed');

    const detail = await api.salesDocumentBatches.run(G10_CONNECTION_ID, run.id);
    const byOrder = new Map(detail.items.map((item) => [item.orderId, item]));
    expect(byOrder.get(G10_ORDER_IDS.b2b)?.result).toBe('enqueued');
    expect(byOrder.get(G10_ORDER_IDS.documented)?.result).toBe('already-documented');
    expect(byOrder.has(G10_ORDER_IDS.b2c)).toBe(false);

    expect((await countOrderDocuments(G10_ORDER_IDS.b2b)).issueJobs).toBe(1);
    expect(await countOrderDocuments(G10_ORDER_IDS.documented)).toEqual({
      invoiceRecords: 1,
      issueJobs: 0,
    });
  });

  test('the next batch shows the documented order as blocked', async ({ page }) => {
    const screen = new BatchIssuingPage(page);
    await screen.goto(G10_CONNECTION_ID);
    await screen.openTab('Next batch');

    const row = screen.queueRow(G10_ORDER_IDS.documented);
    await expect(row).toHaveAttribute('data-row-kind', 'blocked');
    await expect(row).toContainText('Already has a document on another connection.');
  });

  test('run history shows the run and each order', async ({ page }) => {
    const screen = new BatchIssuingPage(page);
    await screen.goto(G10_CONNECTION_ID);
    await screen.openTab('Run history');
    await screen.expectState('finished');

    await expect(page.getByTestId('batch-run-details')).toBeVisible();
    await expect(screen.runItem(G10_ORDER_IDS.b2b)).toBeVisible();
    await expect(screen.runItem(G10_ORDER_IDS.documented)).toHaveAttribute(
      'data-outcome',
      'blocked'
    );
  });

  test('a second Run now issues nothing more', async ({ page, api, poll }) => {
    const before = (await api.salesDocumentBatches.runs(G10_CONNECTION_ID)).total;
    const screen = new BatchIssuingPage(page);
    await screen.goto(G10_CONNECTION_ID);
    await screen.openTab('Next batch');

    // The B2B order left the queue, so only the blocked row remains and there
    // is nothing to run - which is itself "never twice". If the queue still
    // holds anything, run it and check no second request appears.
    if (await screen.runNow().isEnabled()) {
      await screen.runNow().click();
      await poll.until(
        async () => (await api.salesDocumentBatches.runs(G10_CONNECTION_ID)).runs,
        (runs) => runs.length > before && runs[0]?.status !== 'running',
        { timeoutMs: 90_000, message: 'the second run to finish' }
      );
    }

    expect((await countOrderDocuments(G10_ORDER_IDS.b2b)).issueJobs).toBe(1);
    expect((await countOrderDocuments(G10_ORDER_IDS.documented)).issueJobs).toBe(0);
  });
});

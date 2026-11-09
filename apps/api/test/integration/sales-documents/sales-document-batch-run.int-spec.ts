/**
 * Sales-document batch runs and the batch queue (#3583) — integration
 *
 * What only real Postgres can settle about batched issuing:
 *
 *  - the QUEUE is the persisted `trigger-model-batched` block with its target
 *    connection and kind, written by `markSalesDocumentBlock` and read back by
 *    the repository's keyset read, with the D42 B2B/B2C split taken from the
 *    three-state `buyerTaxId` column;
 *  - "one running run per connection" is the partial unique index, not a read:
 *    two claims started together produce exactly one run;
 *  - a run left `running` by a dead process is closed as `interrupted` by the
 *    next claim, and a finished run frees the connection;
 *  - such a stale run does not count as running, so it cannot refuse
 *    "Run now" or show as in progress.
 *
 * @module apps/api/test/integration/sales-documents
 */
import {
  ORDER_RECORD_SERVICE_TOKEN,
  SALES_DOCUMENT_BATCH_RUN_REPOSITORY_TOKEN,
  SALES_DOCUMENT_BATCH_SERVICE_TOKEN,
  type ISalesDocumentBatchService,
  type AppendSalesDocumentBatchRunItemInput,
  type CreateSalesDocumentBatchRunInput,
  type FinishSalesDocumentBatchRunInput,
  type IOrderRecordService,
  type SalesDocumentBatchQueueEntry,
  type SalesDocumentBatchQueueFilter,
  type SalesDocumentBatchRun,
  type SalesDocumentBatchRunItem,
} from '@openlinker/core/orders';

import { createTestOrderRecord } from '../fixtures/order.fixtures';
import { createTestConnection } from '../helpers/test-connection.helper';
import { getTestHarness, resetTestHarness, teardownTestHarness } from '../setup';
import type { IntegrationTestHarness } from '../setup';

/**
 * The slice of the repository this spec drives. A `*RepositoryPort` is an
 * intra-context contract that no sibling may import, so the methods are named
 * locally (the `oms-attention.int-spec.ts` shape).
 */
interface BatchRunRepositoryView {
  claim(
    input: CreateSalesDocumentBatchRunInput,
    staleAfterMs: number
  ): Promise<SalesDocumentBatchRun | null>;
  finish(runId: string, input: FinishSalesDocumentBatchRunInput): Promise<boolean>;
  appendItem(runId: string, input: AppendSalesDocumentBatchRunItemInput): Promise<void>;
  findById(runId: string): Promise<SalesDocumentBatchRun | null>;
  findRunning(connectionId: string, staleAfterMs: number): Promise<SalesDocumentBatchRun | null>;
  listItems(runId: string): Promise<SalesDocumentBatchRunItem[]>;
  listQueue(filter: SalesDocumentBatchQueueFilter): Promise<SalesDocumentBatchQueueEntry[]>;
  countQueue(connectionId: string): Promise<Record<string, number>>;
  listUntargetedBatched(page: { afterOrderId?: string; limit: number }): Promise<string[]>;
}

const CONNECTION_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_CONNECTION_ID = '44444444-4444-4444-8444-444444444444';
const HOUR_MS = 60 * 60 * 1000;
const OPERATOR_ID = '55555555-5555-4555-8555-555555555555';

const runInput = (
  overrides: Partial<CreateSalesDocumentBatchRunInput> = {}
): CreateSalesDocumentBatchRunInput => ({
  connectionId: CONNECTION_ID,
  trigger: 'manual',
  documentKinds: ['invoice'],
  segment: 'all',
  slotAt: null,
  startedByUserId: null,
  ...overrides,
});

const finished: FinishSalesDocumentBatchRunInput = {
  status: 'completed',
  failureReason: null,
  eligibleCount: 1,
  enqueuedCount: 1,
  blockedCount: 0,
};

describe('Sales-document batch runs (#3583)', () => {
  let harness: IntegrationTestHarness;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  const repository = (): BatchRunRepositoryView =>
    harness.getApp().get<BatchRunRepositoryView>(SALES_DOCUMENT_BATCH_RUN_REPOSITORY_TOKEN);

  const batches = (): ISalesDocumentBatchService =>
    harness.getApp().get<ISalesDocumentBatchService>(SALES_DOCUMENT_BATCH_SERVICE_TOKEN);

  /** Backdate a run's start, as if its worker died that long ago. */
  const startedAgo = async (runId: string, hours: number): Promise<void> => {
    await harness
      .getDataSource()
      .query(
        `UPDATE "sales_document_batch_runs" SET "startedAt" = now() - ($2 || ' hours')::interval WHERE "id" = $1`,
        [runId, String(hours)]
      );
  };

  const orderRecords = (): IOrderRecordService =>
    harness.getApp().get<IOrderRecordService>(ORDER_RECORD_SERVICE_TOKEN);

  const queueOrder = async (
    internalOrderId: string,
    options: { connectionId?: string; documentKind?: string; buyerTaxId?: string | null } = {}
  ): Promise<void> => {
    await createTestOrderRecord(harness.getDataSource(), {
      internalOrderId,
      buyerTaxId: options.buyerTaxId ?? null,
    });
    await orderRecords().markSalesDocumentBlock(
      internalOrderId,
      {
        reason: 'trigger-model-batched',
        connectionId: options.connectionId ?? CONNECTION_ID,
        documentKind: options.documentKind ?? 'invoice',
      },
      { action: 'set', matchedRuleId: null }
    );
  };

  describe('the batch queue', () => {
    it('should list an order the gate parked for this connection, with its kind', async () => {
      await queueOrder('ol_order_q1');

      const queue = await repository().listQueue({ connectionId: CONNECTION_ID, limit: 50 });

      expect(queue).toEqual([
        expect.objectContaining({ orderId: 'ol_order_q1', documentKind: 'invoice', isB2b: false }),
      ]);
    });

    it('should leave out an order queued for another connection', async () => {
      await queueOrder('ol_order_mine');
      await queueOrder('ol_order_theirs', { connectionId: OTHER_CONNECTION_ID });

      const queue = await repository().listQueue({ connectionId: CONNECTION_ID, limit: 50 });

      expect(queue.map((entry) => entry.orderId)).toEqual(['ol_order_mine']);
    });

    it('should drop an order from the queue once its block is cleared', async () => {
      await queueOrder('ol_order_cleared');

      await orderRecords().markSalesDocumentBlock('ol_order_cleared', null, { action: 'preserve' });

      const queue = await repository().listQueue({ connectionId: CONNECTION_ID, limit: 50 });
      expect(queue).toEqual([]);
    });

    it('should split the queue into B2B and B2C by the asserted buyer tax id', async () => {
      await queueOrder('ol_order_b2b', { buyerTaxId: '5260250274' });
      await queueOrder('ol_order_none_asserted', { buyerTaxId: '' });
      await queueOrder('ol_order_unknown', { buyerTaxId: null });

      const b2b = await repository().listQueue({
        connectionId: CONNECTION_ID,
        segment: 'b2b',
        limit: 50,
      });
      const b2c = await repository().listQueue({
        connectionId: CONNECTION_ID,
        segment: 'b2c',
        limit: 50,
      });

      expect(b2b.map((entry) => entry.orderId)).toEqual(['ol_order_b2b']);
      expect(b2c.map((entry) => entry.orderId).sort()).toEqual([
        'ol_order_none_asserted',
        'ol_order_unknown',
      ]);
    });

    it('should page the queue by order id and filter by document kind', async () => {
      await queueOrder('ol_order_a');
      await queueOrder('ol_order_b', { documentKind: 'fiscal-receipt' });
      await queueOrder('ol_order_c');

      const firstPage = await repository().listQueue({ connectionId: CONNECTION_ID, limit: 2 });
      const secondPage = await repository().listQueue({
        connectionId: CONNECTION_ID,
        afterOrderId: firstPage[firstPage.length - 1]?.orderId,
        limit: 2,
      });
      const invoicesOnly = await repository().listQueue({
        connectionId: CONNECTION_ID,
        documentKinds: ['invoice'],
        limit: 50,
      });

      expect([...firstPage, ...secondPage].map((entry) => entry.orderId)).toEqual([
        'ol_order_a',
        'ol_order_b',
        'ol_order_c',
      ]);
      expect(invoicesOnly.map((entry) => entry.orderId)).toEqual(['ol_order_a', 'ol_order_c']);
    });

    it('should count queued orders per document kind', async () => {
      await queueOrder('ol_order_i1');
      await queueOrder('ol_order_i2');
      await queueOrder('ol_order_r1', { documentKind: 'fiscal-receipt' });

      await expect(repository().countQueue(CONNECTION_ID)).resolves.toEqual({
        invoice: 2,
        'fiscal-receipt': 1,
      });
    });
  });

  describe('untargeted batched blocks (written before the target columns)', () => {
    const blockWithoutTarget = async (internalOrderId: string): Promise<void> => {
      await createTestOrderRecord(harness.getDataSource(), { internalOrderId, buyerTaxId: null });
      await orderRecords().markSalesDocumentBlock(
        internalOrderId,
        { reason: 'trigger-model-batched' },
        { action: 'set', matchedRuleId: null }
      );
    };

    it('should list only batched blocks with no target, keyset-paged by order id', async () => {
      await blockWithoutTarget('ol_order_u1');
      await blockWithoutTarget('ol_order_u2');
      await blockWithoutTarget('ol_order_u3');
      await queueOrder('ol_order_targeted');

      const first = await repository().listUntargetedBatched({ limit: 2 });
      const rest = await repository().listUntargetedBatched({
        afterOrderId: first[first.length - 1],
        limit: 2,
      });

      expect(first).toEqual(['ol_order_u1', 'ol_order_u2']);
      expect(rest).toEqual(['ol_order_u3']);
    });

    it('should stop listing an order once it is re-queued with a target', async () => {
      await blockWithoutTarget('ol_order_requeued');

      await orderRecords().markSalesDocumentBlock(
        'ol_order_requeued',
        { reason: 'trigger-model-batched', connectionId: CONNECTION_ID, documentKind: 'invoice' },
        { action: 'set', matchedRuleId: null }
      );

      expect(await repository().listUntargetedBatched({ limit: 50 })).toEqual([]);
      expect(
        (await repository().listQueue({ connectionId: CONNECTION_ID, limit: 50 })).map(
          (entry) => entry.orderId
        )
      ).toEqual(['ol_order_requeued']);
    });
  });

  describe('claiming a run', () => {
    it('should let exactly one of two simultaneous claims start a run', async () => {
      const [first, second] = await Promise.all([
        repository().claim(runInput(), HOUR_MS),
        repository().claim(runInput(), HOUR_MS),
      ]);

      const started = [first, second].filter((run) => run !== null);
      expect(started).toHaveLength(1);
      await expect(repository().findRunning(CONNECTION_ID, HOUR_MS)).resolves.toEqual(
        expect.objectContaining({ id: started[0]?.id, status: 'running' })
      );
    });

    it('should not block a run on another connection', async () => {
      await repository().claim(runInput(), HOUR_MS);

      const other = await repository().claim(
        runInput({ connectionId: OTHER_CONNECTION_ID }),
        HOUR_MS
      );

      expect(other).not.toBeNull();
    });

    it('should free the connection once the run finishes', async () => {
      const run = await repository().claim(runInput(), HOUR_MS);

      await expect(repository().finish(run!.id, finished)).resolves.toBe(true);
      const next = await repository().claim(runInput(), HOUR_MS);

      expect(next).not.toBeNull();
      await expect(repository().findById(run!.id)).resolves.toEqual(
        expect.objectContaining({ status: 'completed', enqueuedCount: 1 })
      );
    });

    it('should refuse to finish a run twice', async () => {
      const run = await repository().claim(runInput(), HOUR_MS);
      await repository().finish(run!.id, finished);

      await expect(repository().finish(run!.id, finished)).resolves.toBe(false);
    });

    it('should close a run left running by a dead process as interrupted', async () => {
      const abandoned = await repository().claim(runInput(), HOUR_MS);
      await harness
        .getDataSource()
        .query(
          `UPDATE "sales_document_batch_runs" SET "startedAt" = now() - interval '2 hours' WHERE "id" = $1`,
          [abandoned!.id]
        );

      const next = await repository().claim(runInput(), HOUR_MS);

      expect(next).not.toBeNull();
      await expect(repository().findById(abandoned!.id)).resolves.toEqual(
        expect.objectContaining({ status: 'interrupted' })
      );
    });
    it('should not report a run left running past the stale bound as running', async () => {
      const abandoned = await repository().claim(runInput(), HOUR_MS);
      await startedAgo(abandoned!.id, 2);

      await expect(repository().findRunning(CONNECTION_ID, HOUR_MS)).resolves.toBeNull();
      // Read-only: the row is untouched until a claim closes it.
      await expect(repository().findById(abandoned!.id)).resolves.toEqual(
        expect.objectContaining({ status: 'running' })
      );
    });
  });

  describe('"Run now" after a worker died mid-run', () => {
    const batchedConnection = async (): Promise<void> => {
      await createTestConnection(harness.getDataSource(), {
        id: CONNECTION_ID,
        config: {
          salesDocument: { documentKind: 'invoice', triggerModels: { invoice: 'batched' } },
        },
      });
    };

    it('should start a run when the only running row is past the stale bound', async () => {
      await batchedConnection();
      const abandoned = await repository().claim(runInput(), HOUR_MS);
      await startedAgo(abandoned!.id, 7);

      const result = await batches().requestRun({
        connectionId: CONNECTION_ID,
        startedByUserId: OPERATOR_ID,
      });

      expect(result).toEqual(expect.objectContaining({ status: 'enqueued' }));
      await expect(batches().findRunning(CONNECTION_ID)).resolves.toBeNull();
    });

    it('should still refuse while a run is genuinely in progress', async () => {
      await batchedConnection();
      await repository().claim(runInput(), HOUR_MS);

      const result = await batches().requestRun({
        connectionId: CONNECTION_ID,
        startedByUserId: OPERATOR_ID,
      });

      expect(result).toEqual({ status: 'refused', reason: 'run-in-progress' });
    });
  });

  it('should keep what a run did with each order', async () => {
    const run = await repository().claim(runInput(), HOUR_MS);

    await repository().appendItem(run!.id, {
      orderId: 'ol_order_done',
      documentKind: 'invoice',
      result: 'enqueued',
      blockReason: null,
      idempotencyKey: 'invoice:issue:key',
    });
    await repository().appendItem(run!.id, {
      orderId: 'ol_order_blocked',
      documentKind: 'invoice',
      result: 'blocked',
      blockReason: 'missing-tax-rate',
      idempotencyKey: null,
    });

    const items = await repository().listItems(run!.id);

    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          orderId: 'ol_order_done',
          result: 'enqueued',
          idempotencyKey: 'invoice:issue:key',
        }),
        expect.objectContaining({
          orderId: 'ol_order_blocked',
          result: 'blocked',
          blockReason: 'missing-tax-rate',
        }),
      ])
    );
  });
});

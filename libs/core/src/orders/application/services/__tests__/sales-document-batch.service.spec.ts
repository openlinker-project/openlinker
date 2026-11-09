/**
 * SalesDocumentBatchService tests (#3583)
 *
 * The cases #3583 names: a happy path, a partial failure, a run with nothing
 * eligible, and a connection that needs reconnecting - plus the overlap guard
 * and the D42 segment reaching the queue read.
 */
import type { Connection, ConnectionPort } from '@openlinker/core/identifier-mapping';
import { ConnectionNotFoundException } from '@openlinker/core/identifier-mapping';
import type { IAutoIssueTriggerService } from '@openlinker/core/invoicing';
import type { JobEnqueuePort } from '@openlinker/core/sync';
import { SalesDocumentBatchRun } from '../../../domain/entities/sales-document-batch-run.entity';
import type { OrderRecord } from '../../../domain/entities/order-record.entity';
import type { SalesDocumentBatchRunRepositoryPort } from '../../../domain/ports/sales-document-batch-run-repository.port';
import type { SalesDocumentBatchQueueEntry } from '../../../domain/types/sales-document-batch-run.types';
import type { IOrderRecordService } from '../../interfaces/order-record.service.interface';
import type { ISalesDocumentViewService } from '../../interfaces/sales-document-view.service.interface';
import {
  SALES_DOCUMENT_BATCH_STALE_AFTER_MS,
  SalesDocumentBatchService,
} from '../sales-document-batch.service';

jest.mock('../../../domain/order-from-ready-snapshot', () => ({
  orderFromReadySnapshot: (record: { internalOrderId: string }) => {
    if (record.internalOrderId === 'order-broken') {
      throw new Error('snapshot unavailable');
    }
    return { id: record.internalOrderId };
  },
}));

const CONNECTION = 'conn-1';

const run = (status: SalesDocumentBatchRun['status'] = 'running'): SalesDocumentBatchRun =>
  new SalesDocumentBatchRun(
    'run-1',
    CONNECTION,
    'schedule',
    ['invoice'],
    'all',
    new Date('2026-01-15T17:00:00Z'),
    status,
    null,
    0,
    0,
    0,
    null,
    new Date(),
    null,
  );

const entry = (orderId: string): SalesDocumentBatchQueueEntry => ({
  orderId,
  sourceConnectionId: 'src-1',
  documentKind: 'invoice',
  placedAt: null,
  totalAmount: 10,
  currency: 'PLN',
  isB2b: false,
  orderNumber: null,
  buyerName: null,
});

describe('SalesDocumentBatchService', () => {
  let runs: jest.Mocked<SalesDocumentBatchRunRepositoryPort>;
  let connections: { get: jest.Mock };
  let trigger: { onOrderTransition: jest.Mock };
  let orderRecords: { getOrderRecord: jest.Mock; markSalesDocumentBlock: jest.Mock };
  let views: { getForOrders: jest.Mock };
  let jobEnqueue: { enqueueJob: jest.Mock };
  let service: SalesDocumentBatchService;

  beforeEach(() => {
    runs = {
      claim: jest.fn().mockResolvedValue(run()),
      finish: jest.fn().mockResolvedValue(true),
      appendItem: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn().mockResolvedValue(run('completed')),
      findRunning: jest.fn().mockResolvedValue(null),
      listForConnection: jest.fn(),
      listItems: jest.fn().mockResolvedValue([]),
      listQueue: jest.fn().mockResolvedValue([]),
      countQueue: jest.fn(),
      findOrderLabels: jest.fn().mockResolvedValue(new Map()),
      listUntargetedBatched: jest.fn().mockResolvedValue([]),
    };
    connections = {
      get: jest.fn().mockResolvedValue({ id: CONNECTION, status: 'active' } as Connection),
    };
    trigger = { onOrderTransition: jest.fn() };
    orderRecords = {
      getOrderRecord: jest.fn((id: string) =>
        Promise.resolve({
          internalOrderId: id,
          sourceConnectionId: 'src-1',
          taxRateEra: null,
          buyerTaxId: null,
        } as unknown as OrderRecord),
      ),
      markSalesDocumentBlock: jest.fn().mockResolvedValue(undefined),
    };
    views = { getForOrders: jest.fn().mockResolvedValue(new Map()) };
    jobEnqueue = { enqueueJob: jest.fn().mockResolvedValue({ jobId: 'job-1', isExisting: false }) };
    service = new SalesDocumentBatchService(
      runs,
      connections as unknown as ConnectionPort,
      trigger as unknown as IAutoIssueTriggerService,
      orderRecords as unknown as IOrderRecordService,
      views as unknown as ISalesDocumentViewService,
      jobEnqueue as unknown as JobEnqueuePort,
    );
  });

  const execute = () =>
    service.executeRun({
      connectionId: CONNECTION,
      trigger: 'schedule',
      documentKinds: ['invoice'],
      segment: 'all',
      slotAt: new Date('2026-01-15T17:00:00Z'),
      startedByUserId: null,
    });

  it('should enqueue every queued order through the gate in batch-run mode and record it', async () => {
    runs.listQueue.mockResolvedValueOnce([entry('order-1'), entry('order-2')]);
    trigger.onOrderTransition.mockImplementation((order: { id: string }) =>
      Promise.resolve({
        kind: 'none',
        enqueued: {
          connectionId: CONNECTION,
          documentKind: 'invoice',
          idempotencyKey: `invoice:${CONNECTION}:${order.id}`,
        },
      }),
    );

    await execute();

    expect(trigger.onOrderTransition).toHaveBeenCalledWith(
      { id: 'order-1' },
      'src-1',
      undefined,
      null,
      null,
      { batchRun: { connectionId: CONNECTION, documentKinds: ['invoice'] } },
    );
    // `none` clears the queue marker, exactly as ingestion writes it.
    expect(orderRecords.markSalesDocumentBlock).toHaveBeenCalledWith('order-1', null, {
      action: 'set',
      matchedRuleId: null,
    });
    expect(runs.appendItem).toHaveBeenCalledWith('run-1', {
      orderId: 'order-2',
      documentKind: 'invoice',
      result: 'enqueued',
      blockReason: null,
      idempotencyKey: `invoice:${CONNECTION}:order-2`,
    });
    expect(runs.finish).toHaveBeenCalledWith('run-1', {
      status: 'completed',
      failureReason: null,
      eligibleCount: 2,
      enqueuedCount: 2,
      blockedCount: 0,
    });
  });

  it('should keep going past an order it cannot evaluate, recording it indeterminate', async () => {
    runs.listQueue.mockResolvedValueOnce([entry('order-broken'), entry('order-2')]);
    trigger.onOrderTransition.mockResolvedValue({
      kind: 'blocked',
      block: { reason: 'missing-tax-rate' },
    });

    await execute();

    expect(runs.appendItem).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ orderId: 'order-broken', result: 'indeterminate' }),
    );
    expect(runs.appendItem).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        orderId: 'order-2',
        result: 'blocked',
        blockReason: 'missing-tax-rate',
      }),
    );
    expect(runs.finish).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'completed', eligibleCount: 2, blockedCount: 1 }),
    );
  });

  it('should record an order that already has a document as already-documented', async () => {
    runs.listQueue.mockResolvedValueOnce([entry('order-1')]);
    trigger.onOrderTransition.mockResolvedValue({ kind: 'none', alreadyDocumented: true });

    await execute();

    expect(runs.appendItem).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ result: 'already-documented' }),
    );
  });

  it('should finish a run with nothing eligible as a healthy empty run', async () => {
    const result = await execute();

    expect(result.status).toBe('finished');
    expect(runs.finish).toHaveBeenCalledWith('run-1', {
      status: 'empty',
      failureReason: null,
      eligibleCount: 0,
      enqueuedCount: 0,
      blockedCount: 0,
    });
    expect(trigger.onOrderTransition).not.toHaveBeenCalled();
  });

  it.each([
    ['needs_reauth', 'connection-needs-reauth'],
    ['disabled', 'connection-not-active'],
  ])('should fail to start on a %s connection and leave the queue untouched', async (status, reason) => {
    connections.get.mockResolvedValue({ id: CONNECTION, status } as Connection);

    await execute();

    expect(runs.listQueue).not.toHaveBeenCalled();
    expect(trigger.onOrderTransition).not.toHaveBeenCalled();
    expect(runs.finish).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'failed-to-start', failureReason: reason }),
    );
  });

  it('should fail to start when the connection no longer exists', async () => {
    connections.get.mockRejectedValue(new ConnectionNotFoundException(CONNECTION));

    await execute();

    expect(runs.finish).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'failed-to-start', failureReason: 'connection-not-found' }),
    );
  });

  it('should report already-running when another run holds the connection', async () => {
    runs.claim.mockResolvedValue(null);
    runs.findRunning.mockResolvedValue(run());

    const result = await execute();

    expect(result).toEqual({ status: 'already-running', runningRunId: 'run-1' });
    expect(runs.listQueue).not.toHaveBeenCalled();
  });

  it('should pass the D42 segment and the run kinds to the queue read', async () => {
    await service.executeRun({
      connectionId: CONNECTION,
      trigger: 'schedule',
      documentKinds: ['invoice'],
      segment: 'b2b',
      slotAt: null,
      startedByUserId: null,
    });

    expect(runs.listQueue).toHaveBeenCalledWith(
      expect.objectContaining({ segment: 'b2b', documentKinds: ['invoice'] }),
    );
  });

  it('should derive each enqueued item outcome from the order document at read time', async () => {
    runs.listItems.mockResolvedValue([
      {
        id: 'i1',
        runId: 'run-1',
        orderId: 'order-1',
        documentKind: 'invoice',
        result: 'enqueued',
        blockReason: null,
        idempotencyKey: 'k',
        createdAt: new Date(),
      },
    ]);
    views.getForOrders.mockResolvedValue(
      new Map([
        [
          'order-1',
          {
            document: {
              status: 'failed',
              failureMode: 'in-doubt',
              identity: { documentNumber: null },
            },
          },
        ],
      ]),
    );

    const detail = await service.getRun('run-1');

    expect(detail?.items[0].outcome).toBe('in-doubt');
  });

  it('should name each item by its order number, buyer and document number', async () => {
    runs.listItems.mockResolvedValue([
      {
        id: 'i1',
        runId: 'run-1',
        orderId: 'order-1',
        documentKind: 'invoice',
        result: 'enqueued',
        blockReason: null,
        idempotencyKey: 'k',
        createdAt: new Date(),
      },
      {
        id: 'i2',
        runId: 'run-1',
        orderId: 'order-2',
        documentKind: 'invoice',
        result: 'blocked',
        blockReason: 'missing-tax-rate',
        idempotencyKey: null,
        createdAt: new Date(),
      },
    ]);
    views.getForOrders.mockResolvedValue(
      new Map([
        ['order-1', { document: { status: 'issued', identity: { documentNumber: 'FV/1/2026' } } }],
      ]),
    );
    runs.findOrderLabels.mockResolvedValue(
      new Map([['order-1', { orderNumber: 'ALG-1', buyerName: 'Anna Kowalska' }]]),
    );

    const detail = await service.getRun('run-1');

    expect(runs.findOrderLabels).toHaveBeenCalledWith(['order-1', 'order-2']);
    expect(detail?.items[0]).toMatchObject({
      orderNumber: 'ALG-1',
      buyerName: 'Anna Kowalska',
      documentNumber: 'FV/1/2026',
    });
    expect(detail?.items[1]).toMatchObject({
      orderNumber: null,
      buyerName: null,
      documentNumber: null,
    });
  });

  describe('requestRun ("Run now")', () => {
    const batchedInvoices = {
      salesDocument: {
        documentKind: 'both',
        triggerModels: { invoice: 'batched', 'fiscal-receipt': 'auto-on-paid' },
      },
    };

    it('should enqueue the run job for the kinds the connection batches and the whole queue', async () => {
      connections.get.mockResolvedValue({
        id: CONNECTION,
        status: 'active',
        config: batchedInvoices,
      } as unknown as Connection);

      const result = await service.requestRun({ connectionId: CONNECTION, startedByUserId: 'u-1' });

      expect(result).toEqual({ status: 'enqueued', jobId: 'job-1', documentKinds: ['invoice'] });
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({
          jobType: 'salesDocument.batch.run',
          connectionId: CONNECTION,
          payload: {
            schemaVersion: 1,
            trigger: 'manual',
            documentKinds: ['invoice'],
            segment: 'all',
            startedByUserId: 'u-1',
          },
          idempotencyKey: expect.stringMatching(`^salesDocument:batch:${CONNECTION}:manual:`),
        }),
      );
    });

    it.each([
      ['not-batched', { config: {}, status: 'active' }, null],
      ['connection-needs-reauth', { config: batchedInvoices, status: 'needs_reauth' }, null],
      ['connection-not-active', { config: batchedInvoices, status: 'disabled' }, null],
      ['run-in-progress', { config: batchedInvoices, status: 'active' }, run()],
    ])('should refuse with %s and enqueue nothing', async (reason, conn, running) => {
      connections.get.mockResolvedValue({ id: CONNECTION, ...conn } as unknown as Connection);
      runs.findRunning.mockResolvedValue(running);

      const result = await service.requestRun({ connectionId: CONNECTION, startedByUserId: 'u-1' });

      expect(result).toEqual({ status: 'refused', reason });
      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    });

    it('should refuse a connection that no longer exists', async () => {
      connections.get.mockRejectedValue(new ConnectionNotFoundException(CONNECTION));

      await expect(
        service.requestRun({ connectionId: CONNECTION, startedByUserId: 'u-1' }),
      ).resolves.toEqual({ status: 'refused', reason: 'connection-not-found' });
    });
    it('should ask for the running run with the same stale bound a claim closes it with', async () => {
      // A run left `running` by a dead worker must not refuse "Run now" for ever.
      connections.get.mockResolvedValue({
        id: CONNECTION,
        status: 'active',
        config: batchedInvoices,
      } as unknown as Connection);

      await service.requestRun({ connectionId: CONNECTION, startedByUserId: 'u-1' });

      expect(runs.findRunning).toHaveBeenCalledWith(
        CONNECTION,
        SALES_DOCUMENT_BATCH_STALE_AFTER_MS,
      );
    });
  });

  describe('getOverview', () => {
    it('should report each kind with its schedule, next slot, queue counts and running run', async () => {
      connections.get.mockResolvedValue({
        id: CONNECTION,
        status: 'active',
        config: {
          salesDocument: {
            documentKind: 'invoice',
            triggerModels: { invoice: 'batched' },
            batchSchedules: { invoice: { frequency: 'daily', time: '18:00' } },
          },
        },
      } as unknown as Connection);
      runs.countQueue.mockResolvedValue({ invoice: 3 });

      const overview = await service.getOverview(CONNECTION, new Date('2026-01-15T12:00:00Z'));

      const invoice = overview?.kinds.find((kind) => kind.documentKind === 'invoice');
      expect(invoice?.batched).toBe(true);
      expect(invoice?.schedule?.timeZone).toBe('Europe/Warsaw');
      expect(invoice?.nextSlots).toEqual([
        { segment: 'all', slotAt: new Date('2026-01-15T17:00:00Z') },
      ]);
      expect(overview?.queueCounts).toEqual({ invoice: 3 });
      expect(overview?.runningRun).toBeNull();
    });

    it('should answer null for a connection that does not exist', async () => {
      connections.get.mockRejectedValue(new ConnectionNotFoundException(CONNECTION));

      await expect(service.getOverview(CONNECTION, new Date())).resolves.toBeNull();
    });
  });

  describe('requeueUntargetedBatched', () => {
    it('should re-evaluate each untargeted order outside any run and persist the new block', async () => {
      runs.listUntargetedBatched.mockResolvedValueOnce(['order-a', 'order-b']).mockResolvedValue([]);
      trigger.onOrderTransition.mockResolvedValue({
        kind: 'blocked',
        block: {
          reason: 'trigger-model-batched',
          connectionId: CONNECTION,
          documentKind: 'invoice',
        },
      });

      const result = await service.requeueUntargetedBatched();

      expect(result).toEqual({ evaluated: 2, indeterminate: 0 });
      expect(trigger.onOrderTransition).toHaveBeenCalledTimes(2);
      // Outside a run: no `batchRun` option, so the gate re-queues rather than issues.
      expect(trigger.onOrderTransition.mock.calls[0]).toHaveLength(5);
      expect(orderRecords.markSalesDocumentBlock).toHaveBeenCalledWith(
        'order-a',
        { reason: 'trigger-model-batched', connectionId: CONNECTION, documentKind: 'invoice' },
        { action: 'set', matchedRuleId: null },
      );
    });

    it('should leave an order it cannot decide as it was, and page past it', async () => {
      runs.listUntargetedBatched
        .mockResolvedValueOnce(['order-broken', 'order-c'])
        .mockResolvedValue([]);
      trigger.onOrderTransition.mockResolvedValue({ kind: 'none' });

      const result = await service.requeueUntargetedBatched();

      expect(result).toEqual({ evaluated: 2, indeterminate: 1 });
      expect(runs.listUntargetedBatched).toHaveBeenLastCalledWith(
        expect.objectContaining({ afterOrderId: 'order-c' }),
      );
      expect(orderRecords.markSalesDocumentBlock).toHaveBeenCalledTimes(1);
    });
  });
});

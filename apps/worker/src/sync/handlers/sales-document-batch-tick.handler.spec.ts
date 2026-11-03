/**
 * SalesDocumentBatchTickHandler tests (#3583)
 */
import type { Connection, ConnectionPort } from '@openlinker/core/identifier-mapping';
import type { ISalesDocumentBatchService } from '@openlinker/core/orders';
import type { JobEnqueuePort, SyncJob } from '@openlinker/core/sync';
import {
  SalesDocumentBatchTickHandler,
  collectDueRuns,
} from './sales-document-batch-tick.handler';

const connection = (
  config: Record<string, unknown>,
  id = 'conn-1',
  status: Connection['status'] = 'active',
): Connection =>
  ({
    id,
    status,
    enabledCapabilities: ['Invoicing', 'Fiscalization'],
    config,
  }) as unknown as Connection;

const daily = { frequency: 'daily', time: '18:00', timeZone: 'Europe/Warsaw' };
// 15 Jan 2026 18:30 Warsaw: today's 18:00 slot is due.
const NOW = new Date('2026-01-15T17:30:00Z');

describe('collectDueRuns', () => {
  it('should ignore a kind that is not batched even when it has a schedule', () => {
    const runs = collectDueRuns(
      connection({
        salesDocument: {
          documentKind: 'invoice',
          triggerModels: { invoice: 'auto-on-paid' },
          batchSchedules: { invoice: daily },
        },
      }),
      NOW,
    );
    expect(runs).toEqual([]);
  });

  it('should ignore a batched kind the connection does not issue', () => {
    const runs = collectDueRuns(
      connection({
        salesDocument: {
          documentKind: 'invoice',
          triggerModels: { 'fiscal-receipt': 'batched' },
          batchSchedules: { 'fiscal-receipt': daily },
        },
      }),
      NOW,
    );
    expect(runs).toEqual([]);
  });

  it('should put two kinds due at the same slot into one run', () => {
    const runs = collectDueRuns(
      connection({
        salesDocument: {
          documentKind: 'both',
          triggerModels: { invoice: 'batched', 'fiscal-receipt': 'batched' },
          batchSchedules: { invoice: daily, 'fiscal-receipt': daily },
        },
      }),
      NOW,
    );
    expect(runs).toHaveLength(1);
    expect(runs[0].kinds).toEqual(['invoice', 'fiscal-receipt']);
    expect(runs[0].slot.slotAt.toISOString()).toBe('2026-01-15T17:00:00.000Z');
  });
});

const batchedDaily = {
  salesDocument: {
    documentKind: 'invoice',
    triggerModels: { invoice: 'batched' },
    batchSchedules: { invoice: daily },
  },
};

describe('SalesDocumentBatchTickHandler', () => {
  let jobEnqueue: { enqueueJob: jest.Mock };
  let batches: { requeueUntargetedBatched: jest.Mock };

  const runTick = async (connections: Connection[]): Promise<void> => {
    const handler = new SalesDocumentBatchTickHandler(
      { list: jest.fn().mockResolvedValue(connections) } as unknown as ConnectionPort,
      jobEnqueue as unknown as JobEnqueuePort,
      batches as unknown as ISalesDocumentBatchService,
    );
    jest.useFakeTimers().setSystemTime(NOW);
    try {
      await handler.execute({} as SyncJob);
    } finally {
      jest.useRealTimers();
    }
  };

  beforeEach(() => {
    jobEnqueue = { enqueueJob: jest.fn().mockResolvedValue({ jobId: 'j', isExisting: false }) };
    batches = {
      requeueUntargetedBatched: jest.fn().mockResolvedValue({ evaluated: 0, indeterminate: 0 }),
    };
  });

  it('should enqueue one run per due slot under a slot-derived key', async () => {
    await runTick([connection(batchedDaily)]);

    expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith({
      jobType: 'salesDocument.batch.run',
      connectionId: 'conn-1',
      payload: {
        schemaVersion: 1,
        trigger: 'schedule',
        documentKinds: ['invoice'],
        segment: 'all',
        slotAt: '2026-01-15T17:00:00.000Z',
      },
      idempotencyKey: 'salesDocument:batch:conn-1:all:invoice:2026-01-15T17:00:00.000Z',
    });
  });

  it('should still enqueue the slot of a connection that needs reconnecting, so the run records why it could not start', async () => {
    await runTick([connection(batchedDaily, 'conn-1', 'needs_reauth')]);

    expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(1);
  });

  it('should skip a disabled connection', async () => {
    await runTick([connection(batchedDaily, 'conn-1', 'disabled')]);

    expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
  });

  it('should re-evaluate untargeted batched orders on every tick', async () => {
    await runTick([]);

    expect(batches.requeueUntargetedBatched).toHaveBeenCalledTimes(1);
  });

  it('should keep the slots it enqueued when the untargeted requeue fails', async () => {
    batches.requeueUntargetedBatched.mockRejectedValue(new Error('db down'));

    await expect(runTick([connection(batchedDaily)])).resolves.toBeUndefined();
    expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(1);
  });
});

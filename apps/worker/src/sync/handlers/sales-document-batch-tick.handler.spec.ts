/**
 * SalesDocumentBatchTickHandler tests (#3583)
 */
import type { Connection, ConnectionPort } from '@openlinker/core/identifier-mapping';
import type { JobEnqueuePort, SyncJob } from '@openlinker/core/sync';
import {
  SalesDocumentBatchTickHandler,
  collectDueRuns,
} from './sales-document-batch-tick.handler';

const connection = (config: Record<string, unknown>, id = 'conn-1'): Connection =>
  ({
    id,
    status: 'active',
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

describe('SalesDocumentBatchTickHandler', () => {
  it('should enqueue one run per due slot under a slot-derived key', async () => {
    const connections = {
      list: jest.fn().mockResolvedValue([
        connection({
          salesDocument: {
            documentKind: 'invoice',
            triggerModels: { invoice: 'batched' },
            batchSchedules: { invoice: daily },
          },
        }),
      ]),
    };
    const jobEnqueue = { enqueueJob: jest.fn().mockResolvedValue({ jobId: 'j', isExisting: false }) };
    const handler = new SalesDocumentBatchTickHandler(
      connections as unknown as ConnectionPort,
      jobEnqueue as unknown as JobEnqueuePort,
    );

    jest.useFakeTimers().setSystemTime(NOW);
    try {
      await handler.execute({} as SyncJob);
    } finally {
      jest.useRealTimers();
    }

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
});

/**
 * SalesDocumentBatchRunHandler tests (#3583)
 */
import type { ISalesDocumentBatchService } from '@openlinker/core/orders';
import { ContendedWriteError, type SyncJob } from '@openlinker/core/sync';
import { SalesDocumentBatchRunHandler } from './sales-document-batch-run.handler';

const job = (payload: Record<string, unknown>): SyncJob =>
  ({
    id: 'job-1',
    jobType: 'salesDocument.batch.run',
    connectionId: 'conn-1',
    payload,
  }) as unknown as SyncJob;

const validPayload = {
  schemaVersion: 1,
  trigger: 'schedule',
  documentKinds: ['invoice'],
  segment: 'all',
  slotAt: '2026-01-15T17:00:00.000Z',
};

describe('SalesDocumentBatchRunHandler', () => {
  let batches: { executeRun: jest.Mock };
  let handler: SalesDocumentBatchRunHandler;

  beforeEach(() => {
    batches = { executeRun: jest.fn() };
    handler = new SalesDocumentBatchRunHandler(batches as unknown as ISalesDocumentBatchService);
  });

  it('should run the queue and report ok for a completed run', async () => {
    batches.executeRun.mockResolvedValue({ status: 'finished', run: { status: 'completed' } });

    await expect(handler.execute(job(validPayload))).resolves.toEqual({ outcome: 'ok' });
    expect(batches.executeRun).toHaveBeenCalledWith({
      connectionId: 'conn-1',
      trigger: 'schedule',
      documentKinds: ['invoice'],
      segment: 'all',
      slotAt: new Date('2026-01-15T17:00:00.000Z'),
      startedByUserId: null,
    });
  });

  it('should report a terminal business failure for a run that failed to start', async () => {
    batches.executeRun.mockResolvedValue({ status: 'finished', run: { status: 'failed-to-start' } });

    await expect(handler.execute(job(validPayload))).resolves.toEqual({
      outcome: 'business_failure',
    });
  });

  it('should defer the job penalty-free, not consume the slot, while another run is in progress', async () => {
    batches.executeRun.mockResolvedValue({ status: 'already-running', runningRunId: 'run-0' });

    await expect(handler.execute(job(validPayload))).rejects.toBeInstanceOf(ContendedWriteError);
  });

  it('should refuse an unreadable payload without running anything', async () => {
    await expect(
      handler.execute(job({ ...validPayload, documentKinds: ['nonsense'] })),
    ).resolves.toEqual({ outcome: 'business_failure' });
    expect(batches.executeRun).not.toHaveBeenCalled();
  });
});

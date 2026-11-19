/**
 * Connection Sync Status Service Unit Tests
 *
 * @module libs/core/src/sync/application/services
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ConnectionSyncStatusService } from '../connection-sync-status.service';
import { SYNC_CURSORS_SERVICE_TOKEN, SYNC_JOB_REPOSITORY_TOKEN } from '../../../sync.tokens';
import type { ConnectionBacklogStats } from '../../../domain/types/connection-sync-status.types';

const CONNECTION_ID = '11111111-1111-1111-1111-111111111111';

function stats(overrides: Partial<ConnectionBacklogStats> = {}): ConnectionBacklogStats {
  return {
    queuedCount: 0,
    deferredCount: 0,
    runningCount: 0,
    deadCount: 0,
    arrivedInWindow: 0,
    succeededInWindow: 0,
    deadInWindow: 0,
    lastSucceededAt: null,
    averageAttemptDurationMs: null,
    attemptDurationSampleSize: 0,
    oldestQueuedAt: null,
    ...overrides,
  };
}

describe('ConnectionSyncStatusService', () => {
  let service: ConnectionSyncStatusService;
  let getConnectionBacklogStats: jest.Mock;
  let getOrderImportStats: jest.Mock;
  let getMostRecentCursorUpdate: jest.Mock;
  let getCursorValuesByKeySuffix: jest.Mock;

  beforeEach(async () => {
    getConnectionBacklogStats = jest.fn().mockResolvedValue(stats());
    getOrderImportStats = jest.fn().mockResolvedValue({
      importedLast24h: 0,
      failedLast7d: 0,
      waiting: 0,
      lastImportedAt: null,
      activeImport: null,
    });
    getMostRecentCursorUpdate = jest.fn().mockResolvedValue(null);
    getCursorValuesByKeySuffix = jest.fn().mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectionSyncStatusService,
        { provide: SYNC_JOB_REPOSITORY_TOKEN, useValue: { getConnectionBacklogStats, getOrderImportStats } },
        { provide: SYNC_CURSORS_SERVICE_TOKEN, useValue: { getMostRecentCursorUpdate, getCursorValuesByKeySuffix }, },
      ],
    }).compile();

    service = module.get(ConnectionSyncStatusService);
  });

  it('should report the order sync start from the seed marker', async () => {
    getCursorValuesByKeySuffix.mockResolvedValue(['2026-11-18T08:00:00.000Z']);

    const result = await service.getConnectionSyncStatus(CONNECTION_ID);

    expect(getCursorValuesByKeySuffix).toHaveBeenCalledWith(CONNECTION_ID, '.seededAt');
    expect(result.orderSyncStartedAt).toEqual(new Date('2026-11-18T08:00:00.000Z'));
  });

  it('should report no order sync start when there is no marker, an unparseable one, or the read fails', async () => {
    expect((await service.getConnectionSyncStatus(CONNECTION_ID)).orderSyncStartedAt).toBeNull();

    getCursorValuesByKeySuffix.mockResolvedValue(['not-a-date']);
    expect((await service.getConnectionSyncStatus(CONNECTION_ID)).orderSyncStartedAt).toBeNull();

    getCursorValuesByKeySuffix.mockRejectedValue(new Error('boom'));
    expect((await service.getConnectionSyncStatus(CONNECTION_ID)).orderSyncStartedAt).toBeNull();
  });

  it('should report idle with no alert when the connection has no queued jobs', async () => {
    const result = await service.getConnectionSyncStatus(CONNECTION_ID);

    expect(result.status).toBe('idle');
    expect(result.alerting).toBe(false);
    expect(result.queuedCount).toBe(0);
  });

  it('should alert when the queue is not converging, over the derived threshold and already old', async () => {
    getConnectionBacklogStats.mockResolvedValue(
      stats({
        queuedCount: 15066,
        arrivedInWindow: 200,
        succeededInWindow: 55,
        oldestQueuedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      })
    );

    const result = await service.getConnectionSyncStatus(CONNECTION_ID);

    expect(result.status).toBe('backlogged');
    expect(result.alerting).toBe(true);
    expect(result.alertThresholdJobs).toBe(55 * 24);
    expect(result.estimatedClearanceMs).toBeNull();
  });

  it('should not alert on a deep queue an operator just enqueued', async () => {
    getConnectionBacklogStats.mockResolvedValue(
      stats({
        queuedCount: 9000,
        arrivedInWindow: 9000,
        succeededInWindow: 55,
        oldestQueuedAt: new Date(Date.now() - 5 * 60 * 1000),
      })
    );

    const result = await service.getConnectionSyncStatus(CONNECTION_ID);

    expect(result.status).toBe('growing');
    expect(result.alerting).toBe(false);
  });

  it('should report unknown, not a healthy zero, when the counts cannot be read', async () => {
    getConnectionBacklogStats.mockRejectedValue(new Error('connection terminated'));

    const result = await service.getConnectionSyncStatus(CONNECTION_ID);

    expect(result.status).toBe('unknown');
    expect(result.alerting).toBe(false);
  });

  it('should keep the backlog answer when the cursor read fails', async () => {
    getConnectionBacklogStats.mockResolvedValue(
      stats({ queuedCount: 3, arrivedInWindow: 1, succeededInWindow: 20 })
    );
    getMostRecentCursorUpdate.mockRejectedValue(new Error('cursor read failed'));

    const result = await service.getConnectionSyncStatus(CONNECTION_ID);

    expect(result.status).toBe('draining');
    expect(result.lastCursorAdvanceAt).toBeNull();
  });

  it('should carry the attempt-duration mean and its sample size through unchanged', async () => {
    getConnectionBacklogStats.mockResolvedValue(
      stats({ averageAttemptDurationMs: 4200, attemptDurationSampleSize: 55 })
    );

    const result = await service.getConnectionSyncStatus(CONNECTION_ID);

    expect(result.averageAttemptDurationMs).toBe(4200);
    expect(result.attemptDurationSampleSize).toBe(55);
  });

  it('should read the queue stats over the one-hour observation window', async () => {
    await service.getConnectionSyncStatus(CONNECTION_ID);

    const [, windowStart, historyStart] = getConnectionBacklogStats.mock.calls[0] as [
      string,
      Date,
      Date,
      Date,
    ];
    const spanMs = Date.now() - windowStart.getTime();
    expect(spanMs).toBeGreaterThanOrEqual(60 * 60 * 1000);
    expect(spanMs).toBeLessThan(60 * 60 * 1000 + 5000);

    // The historical figures are bounded, or the aggregate reads every row the
    // connection ever had.
    const historySpanMs = Date.now() - historyStart.getTime();
    expect(historySpanMs).toBeGreaterThanOrEqual(7 * 24 * 60 * 60 * 1000);
  });

  it('should report failing rather than idle when nothing succeeded and jobs died', async () => {
    getConnectionBacklogStats.mockResolvedValue(
      stats({ queuedCount: 0, deadCount: 12, deadInWindow: 12 })
    );

    const result = await service.getConnectionSyncStatus(CONNECTION_ID);

    expect(result.status).toBe('failing');
    expect(result.alerting).toBe(false);
  });

  it('should not alert on a single job waiting on its own retry backoff', async () => {
    // The queue count carries only due jobs, and with nothing measured as
    // draining the absolute floor blocks the alert as well.
    getConnectionBacklogStats.mockResolvedValue(
      stats({
        queuedCount: 1,
        deferredCount: 1,
        oldestQueuedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      })
    );

    const result = await service.getConnectionSyncStatus(CONNECTION_ID);

    expect(result.alerting).toBe(false);
  });

  it('should report the order import figures read from the job rows', async () => {
    const figures = {
      importedLast24h: 40,
      failedLast7d: 2,
      waiting: 5,
      lastImportedAt: new Date('2026-11-18T09:00:00.000Z'),
      activeImport: null,
    };
    getOrderImportStats.mockResolvedValue(figures);

    const result = await service.getConnectionSyncStatus(CONNECTION_ID);

    expect(result.orderImport).toEqual(figures);
  });

  it('should report an unreadable order import as null, never as zero orders', async () => {
    getOrderImportStats.mockRejectedValue(new Error('db down'));

    const result = await service.getConnectionSyncStatus(CONNECTION_ID);

    expect(result.orderImport).toBeNull();
    expect(result.status).not.toBe('unknown');
  });
});

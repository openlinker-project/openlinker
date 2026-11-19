/**
 * Connection Sync Status Controller Tests (#2615)
 *
 * @module apps/api/src/sync/http
 */
import { ConnectionSyncStatusController } from './connection-sync-status.controller';
import type { ConnectionSyncStatus, IConnectionSyncStatusService } from '@openlinker/core/sync';

const HOUR = 60 * 60 * 1000;

function status(overrides: Partial<ConnectionSyncStatus> = {}): ConnectionSyncStatus {
  return {
    connectionId: 'conn-1',
    generatedAt: new Date('2026-08-27T10:00:00.000Z'),
    status: 'idle',
    alerting: false,
    queuedCount: 0,
    deferredCount: 0,
    runningCount: 0,
    deadCount: 0,
    deadInWindow: 0,
    lastSucceededAt: null,
    arrivalRatePerHour: 0,
    drainRatePerHour: 0,
    alertThresholdJobs: 0,
    estimatedClearanceMs: 0,
    oldestQueuedWaitMs: null,
    averageAttemptDurationMs: null,
    attemptDurationSampleSize: 0,
    lastCursorAdvanceAt: null,
    orderSyncStartedAt: null,
    orderImport: null,
    observationWindowMs: HOUR,
    alertHorizonMs: 24 * HOUR,
    historyWindowMs: 7 * 24 * HOUR,
    ...overrides,
  };
}

describe('ConnectionSyncStatusController', () => {
  let service: jest.Mocked<IConnectionSyncStatusService>;
  let controller: ConnectionSyncStatusController;

  beforeEach(() => {
    service = { getConnectionSyncStatus: jest.fn() };
    controller = new ConnectionSyncStatusController(service);
  });

  it('should project the status field-by-field with ISO dates', async () => {
    service.getConnectionSyncStatus.mockResolvedValue(
      status({
        status: 'backlogged',
        alerting: true,
        queuedCount: 15066,
        runningCount: 2,
        deadCount: 4,
        arrivalRatePerHour: 200,
        drainRatePerHour: 55,
        alertThresholdJobs: 1320,
        estimatedClearanceMs: null,
        oldestQueuedWaitMs: 3 * 24 * HOUR,
        averageAttemptDurationMs: 4200,
        attemptDurationSampleSize: 40,
        lastCursorAdvanceAt: new Date('2026-08-27T09:30:00.000Z'),
        orderSyncStartedAt: new Date('2026-08-20T08:00:00.000Z'),
      })
    );

    const dto = await controller.getSyncStatus('conn-1');

    expect(dto.generatedAt).toBe('2026-08-27T10:00:00.000Z');
    expect(dto.lastCursorAdvanceAt).toBe('2026-08-27T09:30:00.000Z');
    expect(dto.orderSyncStartedAt).toBe('2026-08-20T08:00:00.000Z');
    expect(dto.status).toBe('backlogged');
    expect(dto.alerting).toBe(true);
    expect(dto.alertThresholdJobs).toBe(1320);
    expect(dto.estimatedClearanceMs).toBeNull();
    expect(dto.averageAttemptDurationMs).toBe(4200);
    expect(dto.attemptDurationSampleSize).toBe(40);
  });

  it('should project the due, deferred and last-success fields', async () => {
    service.getConnectionSyncStatus.mockResolvedValue(
      status({
        queuedCount: 4,
        deferredCount: 11,
        deadInWindow: 2,
        lastSucceededAt: new Date('2026-08-27T09:00:00.000Z'),
      })
    );

    const dto = await controller.getSyncStatus('conn-1');

    expect(dto.queuedCount).toBe(4);
    expect(dto.deferredCount).toBe(11);
    expect(dto.deadInWindow).toBe(2);
    expect(dto.lastSucceededAt).toBe('2026-08-27T09:00:00.000Z');
  });

  it('should serialize an absent cursor as null rather than a zero date', async () => {
    service.getConnectionSyncStatus.mockResolvedValue(status());

    const dto = await controller.getSyncStatus('conn-1');

    expect(dto.lastCursorAdvanceAt).toBeNull();
    expect(dto.orderSyncStartedAt).toBeNull();
    expect(dto.status).toBe('idle');
  });

  it('should project the order import figures with ISO dates, and keep an unreadable read null', async () => {
    service.getConnectionSyncStatus.mockResolvedValue(
      status({
        orderImport: {
          importedLast24h: 12,
          failedLast7d: 1,
          failures: [
            {
              code: 'missing-mapping',
              count: 1,
              lastFailedAt: new Date('2026-08-20T09:30:00.000Z'),
              sampleOrderId: '37',
              sampleMessage: 'Missing mapping for order item',
            },
          ],
          waiting: 3,
          lastImportedAt: new Date('2026-08-20T09:00:00.000Z'),
          activeImport: {
            runId: 'run-1',
            direction: 'newest-first',
            from: '2026-10-01',
            to: null,
            pagesDone: 4,
            startedAt: new Date('2026-08-20T08:00:00.000Z'),
          },
        },
      })
    );

    const dto = await controller.getSyncStatus('conn-1');

    expect(dto.orderImport).toEqual({
      importedLast24h: 12,
      failedLast7d: 1,
      failures: [
        {
          code: 'missing-mapping',
          count: 1,
          lastFailedAt: '2026-08-20T09:30:00.000Z',
          sampleOrderId: '37',
          sampleMessage: 'Missing mapping for order item',
        },
      ],
      waiting: 3,
      lastImportedAt: '2026-08-20T09:00:00.000Z',
      activeImport: {
        runId: 'run-1',
        direction: 'newest-first',
        from: '2026-10-01',
        to: null,
        pagesDone: 4,
        startedAt: '2026-08-20T08:00:00.000Z',
      },
    });

    service.getConnectionSyncStatus.mockResolvedValue(status());
    expect((await controller.getSyncStatus('conn-1')).orderImport).toBeNull();
  });
});

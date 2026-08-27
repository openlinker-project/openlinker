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
    runningCount: 0,
    deadCount: 0,
    arrivalRatePerHour: 0,
    drainRatePerHour: 0,
    alertThresholdJobs: 0,
    estimatedClearanceMs: 0,
    oldestQueuedWaitMs: null,
    averageAttemptDurationMs: null,
    attemptDurationSampleSize: 0,
    lastCursorAdvanceAt: null,
    observationWindowMs: HOUR,
    alertHorizonMs: 24 * HOUR,
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
      })
    );

    const dto = await controller.getSyncStatus('conn-1');

    expect(dto.generatedAt).toBe('2026-08-27T10:00:00.000Z');
    expect(dto.lastCursorAdvanceAt).toBe('2026-08-27T09:30:00.000Z');
    expect(dto.status).toBe('backlogged');
    expect(dto.alerting).toBe(true);
    expect(dto.alertThresholdJobs).toBe(1320);
    expect(dto.estimatedClearanceMs).toBeNull();
    expect(dto.averageAttemptDurationMs).toBe(4200);
    expect(dto.attemptDurationSampleSize).toBe(40);
  });

  it('should serialize an absent cursor as null rather than a zero date', async () => {
    service.getConnectionSyncStatus.mockResolvedValue(status());

    const dto = await controller.getSyncStatus('conn-1');

    expect(dto.lastCursorAdvanceAt).toBeNull();
    expect(dto.status).toBe('idle');
  });
});

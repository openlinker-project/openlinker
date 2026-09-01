/**
 * ConnectionSyncStatusPanel tests (#2615)
 *
 * @module features/connections/components
 */
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../../test/test-utils';
import { ConnectionSyncStatusPanel } from './connection-sync-status-panel';
import type { ConnectionSyncStatus } from '../api/connections.types';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function renderPanel(overrides: Partial<ConnectionSyncStatus> = {}): void {
  const status: ConnectionSyncStatus = {
    connectionId: 'conn_1',
    generatedAt: '2026-08-27T10:00:00.000Z',
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
    observationWindowMs: HOUR,
    alertHorizonMs: DAY,
    historyWindowMs: 7 * DAY,
    ...overrides,
  };
  const apiClient = createMockApiClient({
    connections: { getSyncStatus: vi.fn().mockResolvedValue(status) },
  });
  renderWithProviders(<ConnectionSyncStatusPanel connectionId="conn_1" />, { apiClient });
}

afterEach(() => {
  cleanup();
});

describe('ConnectionSyncStatusPanel', () => {
  it('reports an empty queue without an alert', async () => {
    renderPanel();

    expect(await screen.findByText('Nothing waiting')).toBeInTheDocument();
    expect(screen.getByText('No work is waiting for this connection.')).toBeInTheDocument();
    expect(screen.queryByText('This connection is behind')).not.toBeInTheDocument();
  });

  it('raises one alert when the backend reports the connection is backlogged', async () => {
    renderPanel({
      status: 'backlogged',
      alerting: true,
      queuedCount: 15066,
      oldestQueuedWaitMs: 3 * DAY,
      drainRatePerHour: 55,
      arrivalRatePerHour: 200,
      alertThresholdJobs: 1320,
      estimatedClearanceMs: null,
    });

    expect(await screen.findByText('This connection is behind')).toBeInTheDocument();
    expect(screen.getByText(/15,066 tasks are waiting/)).toBeInTheDocument();
    expect(screen.getByText(/the oldest for 3 days/)).toBeInTheDocument();
  });

  it('does not alert on a deep queue that is shrinking', async () => {
    renderPanel({
      status: 'draining',
      queuedCount: 9000,
      oldestQueuedWaitMs: 5 * 60 * 1000,
      drainRatePerHour: 300,
      arrivalRatePerHour: 10,
      alertThresholdJobs: 7200,
      estimatedClearanceMs: 31 * HOUR,
    });

    expect(await screen.findByText('Catching up')).toBeInTheDocument();
    expect(screen.queryByText('This connection is behind')).not.toBeInTheDocument();
    expect(screen.getByText(/the queue is shrinking/)).toBeInTheDocument();
  });

  it('omits a clearance estimate when the queue is not shrinking', async () => {
    renderPanel({
      status: 'growing',
      queuedCount: 400,
      oldestQueuedWaitMs: 2 * HOUR,
      estimatedClearanceMs: null,
    });

    expect(await screen.findByText('Falling behind')).toBeInTheDocument();
    expect(screen.queryByText(/to clear at the current pace/)).not.toBeInTheDocument();
  });

  it('says the queue could not be read rather than reporting it empty', async () => {
    renderPanel({ status: 'unknown' });

    expect(await screen.findByText('Unknown')).toBeInTheDocument();
    expect(screen.getByText(/could not be read just now/)).toBeInTheDocument();
  });

  it('keeps the rates and the derived threshold behind a disclosure', async () => {
    renderPanel({
      status: 'growing',
      queuedCount: 400,
      arrivalRatePerHour: 145,
      drainRatePerHour: 60,
      alertThresholdJobs: 1440,
      oldestQueuedWaitMs: 2 * HOUR,
    });

    expect(await screen.findByText('Details')).toBeInTheDocument();
    expect(screen.getByText('1,440 waiting')).toBeInTheDocument();
    expect(screen.getByText('145 an hour')).toBeInTheDocument();
  });

  it('states the attempt time was not measured rather than showing a zero', async () => {
    renderPanel({ averageAttemptDurationMs: null, attemptDurationSampleSize: 0 });

    expect(await screen.findByText('Not measured yet')).toBeInTheDocument();
  });

  it('shows the attempt time with the sample size behind it', async () => {
    renderPanel({ averageAttemptDurationMs: 4200, attemptDurationSampleSize: 55 });

    expect(await screen.findByText('4.2 s (over 55 tasks)')).toBeInTheDocument();
  });

  it('describes a connection with no saved sync position as normal', async () => {
    renderPanel({ lastCursorAdvanceAt: null });

    expect(await screen.findByText(/No saved position/)).toBeInTheDocument();
  });

  it('reports jobs that gave up, since nothing retries them on its own', async () => {
    renderPanel({ deadCount: 4 });

    expect(await screen.findByText(/4 tasks have given up/)).toBeInTheDocument();
  });

  it('says tasks are failing rather than showing an empty queue as healthy', async () => {
    renderPanel({ status: 'failing', queuedCount: 0, deadCount: 12, deadInWindow: 12 });

    expect(await screen.findByText('Tasks failing')).toBeInTheDocument();
    expect(await screen.findByText(/work is dying rather than getting done/)).toBeInTheDocument();
  });

  it('names the stalled-worker case when tasks are running and nothing finishes', async () => {
    renderPanel({ status: 'growing', queuedCount: 20, runningCount: 2, drainRatePerHour: 0 });

    expect(
      await screen.findByText(/the background worker stopped part-way through/)
    ).toBeInTheDocument();
  });

  it('does not print an alert level of zero when no drain rate was measured', async () => {
    renderPanel({ status: 'growing', queuedCount: 20, drainRatePerHour: 0 });

    expect(await screen.findByText(/Not measured yet - nothing finished/)).toBeInTheDocument();
  });
});

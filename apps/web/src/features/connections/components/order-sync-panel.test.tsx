/**
 * OrderSyncPanel tests (#4228)
 *
 * @module features/connections/components
 */
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../../test/test-utils';
import { OrderSyncPanel } from './order-sync-panel';
import type { ConnectionSyncStatus } from '../api/connections.types';

function makeStatus(overrides: Partial<ConnectionSyncStatus> = {}): ConnectionSyncStatus {
  return {
    connectionId: 'conn_1',
    generatedAt: '2026-11-18T10:00:00.000Z',
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
    estimatedClearanceMs: null,
    oldestQueuedWaitMs: null,
    averageAttemptDurationMs: null,
    attemptDurationSampleSize: 0,
    lastCursorAdvanceAt: null,
    orderSyncStartedAt: null,
    observationWindowMs: 3600000,
    alertHorizonMs: 86400000,
    historyWindowMs: 604800000,
    ...overrides,
  };
}

type GetSyncStatus = (connectionId: string) => Promise<ConnectionSyncStatus>;

function renderPanel(getSyncStatus: Mock<GetSyncStatus>): void {
  const apiClient = createMockApiClient({ connections: { getSyncStatus } });
  renderWithProviders(<OrderSyncPanel connectionId="conn_1" />, { apiClient });
}

afterEach(() => {
  cleanup();
});

describe('OrderSyncPanel', () => {
  it('shows a loading state while the status loads', () => {
    renderPanel(vi.fn<GetSyncStatus>().mockReturnValue(new Promise(() => undefined)));

    expect(screen.getByText('Loading order sync')).toBeInTheDocument();
  });

  it('shows an error with a retry that refetches', async () => {
    const user = userEvent.setup();
    const getSyncStatus = vi
      .fn<GetSyncStatus>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(makeStatus());
    renderPanel(getSyncStatus);

    expect(await screen.findByText('Could not load order sync')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Started before tracking')).toBeInTheDocument();
  });

  it('shows the live row with the start date when a start was recorded', async () => {
    renderPanel(
      vi.fn<GetSyncStatus>().mockResolvedValue(
        makeStatus({
          orderSyncStartedAt: '2026-11-18T08:00:00.000Z',
          lastCursorAdvanceAt: '2026-11-18T09:55:00.000Z',
        }),
      ),
    );

    expect(await screen.findByText('Syncing')).toBeInTheDocument();
    expect(screen.getByText(/^From /)).toBeInTheDocument();
    expect(screen.getByText(/Last activity/)).toBeInTheDocument();
  });

  it('shows an honest absence, not a date, when no start was recorded', async () => {
    renderPanel(vi.fn<GetSyncStatus>().mockResolvedValue(makeStatus({ orderSyncStartedAt: null })));

    expect(await screen.findByText('Started before tracking')).toBeInTheDocument();
    expect(
      screen.getByText(
        'This connection has been syncing since before start dates were recorded.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^From /)).not.toBeInTheDocument();
  });

  it('states that earlier orders were not imported, with no import action', async () => {
    renderPanel(vi.fn<GetSyncStatus>().mockResolvedValue(makeStatus()));

    expect(await screen.findByText('Not imported')).toBeInTheDocument();
    expect(
      screen.getByText('Orders placed before the start date were not imported.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /import/i })).not.toBeInTheDocument();
  });
});

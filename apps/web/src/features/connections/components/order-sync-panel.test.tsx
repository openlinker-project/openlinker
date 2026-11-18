/**
 * OrderSyncPanel tests (#4228)
 *
 * @module features/connections/components
 */
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  renderWithProviders,
  createMockApiClient,
  createAuthenticatedSessionAdapter,
} from '../../../test/test-utils';
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

const CONNECTION = { id: 'conn_1', platformType: 'prestashop', adapterKey: 'prestashop.webservice.v1' };

type GetSyncStatus = (connectionId: string) => Promise<ConnectionSyncStatus>;

function renderPanel(getSyncStatus: Mock<GetSyncStatus>): void {
  const apiClient = createMockApiClient({ connections: { getSyncStatus } });
  renderWithProviders(<OrderSyncPanel connection={CONNECTION} />, {
        apiClient,
        sessionAdapter: createAuthenticatedSessionAdapter(),
      });
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

    expect(await screen.findByText('Running')).toBeInTheDocument();
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

    expect(await screen.findByText('Importing')).toBeInTheDocument();
    expect(screen.getByText(/^Importing orders since /)).toBeInTheDocument();
    expect(screen.getByText(/Last order check/)).toBeInTheDocument();
  });

  it('shows an honest absence, not a date, when no start was recorded', async () => {
    renderPanel(vi.fn<GetSyncStatus>().mockResolvedValue(makeStatus({ orderSyncStartedAt: null })));

    expect(await screen.findByText('Running')).toBeInTheDocument();
    expect(
      screen.getByText(
        'This connection imports new orders. Its start date was not recorded.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Importing orders since /)).not.toBeInTheDocument();
  });

  it('states that earlier orders were not imported, with no import action', async () => {
    renderPanel(vi.fn<GetSyncStatus>().mockResolvedValue(makeStatus()));

    expect(await screen.findByText('Your choice')).toBeInTheDocument();
    expect(
      screen.getByText('Orders from before the start were imported only if you chose that when connecting or changing the start.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /import/i })).not.toBeInTheDocument();
  });

  describe('restart', () => {
    it('restarts the sync from the chosen start and confirms', async () => {
      const user = userEvent.setup();
      const restartOrderSync = vi.fn().mockResolvedValue(undefined);
      const apiClient = createMockApiClient({
        connections: {
          getSyncStatus: vi.fn<GetSyncStatus>().mockResolvedValue(makeStatus()),
          restartOrderSync,
        },
        adapters: {
          list: vi.fn().mockResolvedValue([
            {
              adapterKey: 'prestashop.webservice.v1',
              platformType: 'prestashop',
              orderSyncStartModes: ['now', 'from', 'all'],
            },
          ]),
        },
      });
      renderWithProviders(<OrderSyncPanel connection={CONNECTION} />, {
        apiClient,
        sessionAdapter: createAuthenticatedSessionAdapter(),
      });

      await user.click(await screen.findByRole('button', { name: /Change start/ }));
      await user.click(await screen.findByRole('radio', { name: /Every order the shop has/ }));
      await user.click(screen.getByRole('button', { name: 'Apply change' }));

      expect(restartOrderSync).toHaveBeenCalledWith('conn_1', { mode: 'all' });
    });

    it('does not send a start date that is not acceptable', async () => {
      const user = userEvent.setup();
      const restartOrderSync = vi.fn().mockResolvedValue(undefined);
      const apiClient = createMockApiClient({
        connections: {
          getSyncStatus: vi.fn<GetSyncStatus>().mockResolvedValue(makeStatus()),
          restartOrderSync,
        },
        adapters: {
          list: vi.fn().mockResolvedValue([
            {
              adapterKey: 'prestashop.webservice.v1',
              platformType: 'prestashop',
              orderSyncStartModes: ['now', 'from', 'all'],
            },
          ]),
        },
      });
      renderWithProviders(<OrderSyncPanel connection={CONNECTION} />, {
        apiClient,
        sessionAdapter: createAuthenticatedSessionAdapter(),
      });

      await user.click(await screen.findByRole('button', { name: /Change start/ }));
      await user.click(await screen.findByRole('radio', { name: /Orders since a date/ }));

      expect(screen.getByRole('button', { name: 'Apply change' })).toBeDisabled();
      expect(restartOrderSync).not.toHaveBeenCalled();
    });
  });
});

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
    orderImport: null,
    observationWindowMs: 3600000,
    alertHorizonMs: 86400000,
    historyWindowMs: 604800000,
    ...overrides,
  };
}

const CONNECTION = {
  id: 'conn_1',
  platformType: 'prestashop',
  adapterKey: 'prestashop.webservice.v1',
};

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

    expect(screen.getByText('Loading order import')).toBeInTheDocument();
  });

  it('shows an error with a retry that refetches', async () => {
    const user = userEvent.setup();
    const getSyncStatus = vi
      .fn<GetSyncStatus>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(makeStatus());
    renderPanel(getSyncStatus);

    expect(await screen.findByText('Could not load order import')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Importing new orders')).toBeInTheDocument();
  });

  it('shows the start date and last check when a start was recorded', async () => {
    renderPanel(
      vi.fn<GetSyncStatus>().mockResolvedValue(
        makeStatus({
          orderSyncStartedAt: '2026-11-18T08:00:00.000Z',
          lastCursorAdvanceAt: '2026-11-18T09:55:00.000Z',
        })
      )
    );

    expect(await screen.findByText('Importing new orders')).toBeInTheDocument();
    expect(screen.getByText(/^Since /)).toBeInTheDocument();
    expect(screen.getByText(/Last check /)).toBeInTheDocument();
  });

  it('shows an honest absence, not a date, when no start was recorded', async () => {
    renderPanel(vi.fn<GetSyncStatus>().mockResolvedValue(makeStatus({ orderSyncStartedAt: null })));

    expect(await screen.findByText('Importing new orders')).toBeInTheDocument();
    expect(screen.getByText('Start date was not recorded')).toBeInTheDocument();
    expect(screen.queryByText(/^Since /)).not.toBeInTheDocument();
  });

  describe('health details (statusOnly)', () => {
    const importFigures = {
      importedLast24h: 42,
      failedLast7d: 2,
      waiting: 5,
      lastImportedAt: '2026-11-18T09:50:00.000Z',
      activeImport: {
        runId: 'run-1',
        direction: 'newest-first' as const,
        from: '2026-10-01',
        to: null,
        pagesDone: 4,
        startedAt: '2026-11-18T09:00:00.000Z',
      },
    };

    function renderHealth(status: ConnectionSyncStatus): void {
      const apiClient = createMockApiClient({
        connections: { getSyncStatus: vi.fn<GetSyncStatus>().mockResolvedValue(status) },
      });
      renderWithProviders(<OrderSyncPanel connection={CONNECTION} statusOnly />, {
        apiClient,
        sessionAdapter: createAuthenticatedSessionAdapter(),
      });
    }

    it('should show the import figures, the failures and a running history import', async () => {
      renderHealth(makeStatus({ orderImport: importFigures }));

      expect(await screen.findByText('Imported (24 h)')).toBeInTheDocument();
      expect(screen.getByText('42')).toBeInTheDocument();
      expect(screen.getByText('Some orders could not be imported.')).toBeInTheDocument();
      expect(screen.getByText('History import in progress')).toBeInTheDocument();
      expect(screen.getByText(/Newest first · from .* · Pages read: 4/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Change start/ })).not.toBeInTheDocument();
    });

    it('should not mention failures or a running import when there are none', async () => {
      renderHealth(
        makeStatus({
          orderImport: { ...importFigures, failedLast7d: 0, activeImport: null },
        }),
      );

      expect(await screen.findByText('Imported (24 h)')).toBeInTheDocument();
      expect(screen.queryByText('Some orders could not be imported.')).not.toBeInTheDocument();
      expect(screen.queryByText('History import in progress')).not.toBeInTheDocument();
    });

    it('should say the figures are unavailable rather than show zero orders', async () => {
      renderHealth(makeStatus({ orderImport: null }));

      expect(
        await screen.findByText('Order import figures are not available right now.'),
      ).toBeInTheDocument();
      expect(screen.queryByText('Imported (24 h)')).not.toBeInTheDocument();
    });
  });

  it('states that earlier orders stay in the shop, with no import action', async () => {
    renderPanel(vi.fn<GetSyncStatus>().mockResolvedValue(makeStatus()));

    expect(
      await screen.findByText(
        'Orders placed before the start stay in the shop. They are copied only if you chose to import them.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /import/i })).not.toBeInTheDocument();
  });

  describe('restart', () => {
    it('says nothing is skipped when restarting to new orders only', async () => {
      const user = userEvent.setup();
      renderPanel(vi.fn<GetSyncStatus>().mockResolvedValue(makeStatus()));

      await user.click(await screen.findByRole('button', { name: /Change start/ }));

      expect(
        await screen.findByText(
          'OpenLinker keeps importing new orders from the last check, so nothing is skipped.'
        )
      ).toBeInTheDocument();
      expect(screen.queryByText(/are skipped/)).not.toBeInTheDocument();
    });

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

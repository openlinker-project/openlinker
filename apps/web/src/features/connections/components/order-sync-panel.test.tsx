/**
 * OrderSyncPanel tests (#4228)
 *
 * @module features/connections/components
 */
import type { ReactElement } from 'react';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  renderWithProviders,
  createMockApiClient,
  createAuthenticatedSessionAdapter,
} from '../../../test/test-utils';
import { useLocation } from 'react-router-dom';
import { OrderSyncPanel } from './order-sync-panel';

function LocationProbe(): ReactElement {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}
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
    orderStart: null,
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

    expect(await screen.findByText('Unknown')).toBeInTheDocument();
  });

  it('states the recorded start as a setting, with the mode and what it means for older orders', async () => {
    renderPanel(
      vi.fn<GetSyncStatus>().mockResolvedValue(
        makeStatus({
          orderStart: {
            mode: 'now',
            from: null,
            order: 'oldest-first',
            appliedAt: '2026-11-18T08:00:00.000Z',
            pending: false,
          },
        })
      )
    );

    expect(await screen.findByText(/^New orders only, from .*Older orders stay in the shop\./)).toBeInTheDocument();
  });

  it('states a whole-history start with its order, not a marker date', async () => {
    renderPanel(
      vi.fn<GetSyncStatus>().mockResolvedValue(
        makeStatus({
          orderStart: {
            mode: 'all',
            from: null,
            order: 'newest-first',
            appliedAt: '2026-11-18T08:00:00.000Z',
            pending: false,
          },
        })
      )
    );

    expect(await screen.findByText('Every order the shop has, newest first.')).toBeInTheDocument();
  });

  it('says a restarted choice starts on the next check', async () => {
    renderPanel(
      vi.fn<GetSyncStatus>().mockResolvedValue(
        makeStatus({
          orderStart: { mode: 'now', from: null, order: 'oldest-first', appliedAt: null, pending: true },
        })
      )
    );

    expect(
      await screen.findByText('Starts on the next check: new orders only.')
    ).toBeInTheDocument();
  });

  it('shows an honest absence, not a date, when no start was recorded', async () => {
    renderPanel(vi.fn<GetSyncStatus>().mockResolvedValue(makeStatus({ orderSyncStartedAt: null })));

    expect(await screen.findByText('The start was not recorded.')).toBeInTheDocument();
  });

  it('sends the operator to the Trigger sync dialog on Actions from Sync orders', async () => {
    const user = userEvent.setup();
    const apiClient = createMockApiClient({
      connections: { getSyncStatus: vi.fn<GetSyncStatus>().mockResolvedValue(makeStatus()) },
    });
    renderWithProviders(
      <>
        <OrderSyncPanel connection={CONNECTION} />
        <LocationProbe />
      </>,
      { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() }
    );

    await user.click(await screen.findByRole('button', { name: /Sync orders/ }));

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/connections/conn_1?tab=actions&sync=orders'
    );
  });

  it('explains on hover that Sync orders leads to Actions', async () => {
    const user = userEvent.setup();
    const apiClient = createMockApiClient({
      connections: { getSyncStatus: vi.fn<GetSyncStatus>().mockResolvedValue(makeStatus()) },
    });
    renderWithProviders(<OrderSyncPanel connection={CONNECTION} />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await user.hover(await screen.findByRole('button', { name: /Sync orders/ }));

    expect(await screen.findByText('You will be taken to Actions')).toBeInTheDocument();
  });

  describe('import health details', () => {
    const importFigures = {
      importedLast24h: 42,
      lastPolledAt: new Date().toISOString(),
      failedLast7d: 2,
      failures: [
        {
          code: 'missing-mapping' as const,
          count: 2,
          lastFailedAt: '2026-11-18T09:30:00.000Z',
          sampleOrderId: '37',
          sampleMessage: 'Missing mapping for order item',
        },
      ],
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
      renderWithProviders(<OrderSyncPanel connection={CONNECTION} />, {
        apiClient,
        sessionAdapter: createAuthenticatedSessionAdapter(),
      });
    }

    it('should show the import figures, the failures and a running history import', async () => {
      renderHealth(makeStatus({ orderImport: importFigures }));

      expect(await screen.findByText('Orders received (24 h)')).toBeInTheDocument();
      expect(screen.getByText('42')).toBeInTheDocument();
      expect(screen.getByText('What failed')).toBeInTheDocument();
      expect(screen.getByText(/A product in the order is not linked/)).toBeInTheDocument();
      expect(screen.getByText(/Orders: 2 · Latest: order 37/)).toBeInTheDocument();
      expect(screen.getByText('History import in progress')).toBeInTheDocument();
      expect(screen.getByText(/Newest first · from .* · Started /)).toBeInTheDocument();
      expect(screen.getByText('Needs attention')).toBeInTheDocument();
      expect(screen.getByText('Orders that could not be imported: 2.')).toBeInTheDocument();
      expect(screen.getByText('What to do')).toBeInTheDocument();
      expect(screen.getByText(/Sync the catalogue so OpenLinker knows the missing products/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Change import start/ })).toBeInTheDocument();
    });

    it('should not mention failures or a running import when there are none', async () => {
      renderHealth(
        makeStatus({
          orderImport: { ...importFigures, failedLast7d: 0, failures: [], activeImport: null },
        }),
      );

      expect(await screen.findByText('Orders received (24 h)')).toBeInTheDocument();
      expect(screen.queryByText('What failed')).not.toBeInTheDocument();
      expect(screen.queryByText('History import in progress')).not.toBeInTheDocument();
    });

    it('should say the figures are unavailable rather than show zero orders', async () => {
      renderHealth(makeStatus({ orderImport: null }));

      expect(
        await screen.findByText('Order import figures are not available right now.'),
      ).toBeInTheDocument();
      expect(screen.getByText('Unknown')).toBeInTheDocument();
      expect(screen.queryByText('Orders received (24 h)')).not.toBeInTheDocument();
    });
  });

  it('shows waiting orders only when there are some', async () => {
    renderPanel(
      vi.fn<GetSyncStatus>().mockResolvedValue(
        makeStatus({
          orderImport: {
            importedLast24h: 3,
            lastPolledAt: new Date().toISOString(),
            failedLast7d: 0,
            failures: [],
            waiting: 0,
            lastImportedAt: null,
            activeImport: null,
          },
        })
      )
    );

    expect(await screen.findByText('Up to date')).toBeInTheDocument();
    expect(screen.queryByText('Waiting to import')).not.toBeInTheDocument();
  });

  describe('restart', () => {
    it('says nothing is skipped when restarting to new orders only', async () => {
      const user = userEvent.setup();
      renderPanel(vi.fn<GetSyncStatus>().mockResolvedValue(makeStatus()));

      await user.click(await screen.findByRole('button', { name: /Change import start/ }));

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

      await user.click(await screen.findByRole('button', { name: /Change import start/ }));
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

      await user.click(await screen.findByRole('button', { name: /Change import start/ }));
      await user.click(await screen.findByRole('radio', { name: /Orders since a date/ }));

      expect(screen.getByRole('button', { name: 'Apply change' })).toBeDisabled();
      expect(restartOrderSync).not.toHaveBeenCalled();
    });
  });
});

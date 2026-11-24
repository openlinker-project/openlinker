/**
 * OrderSyncPanel tests (#4228)
 *
 * @module features/connections/components
 */
import { useRef, type ReactElement } from 'react';
import { cleanup, screen, waitFor } from '@testing-library/react';
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
  const visits = useRef(0);
  const lastKey = useRef('');
  if (lastKey.current !== location.key && location.search.includes('tab=actions')) {
    lastKey.current = location.key;
    visits.current += 1;
  }
  return (
    <>
      <div data-testid="location">{location.pathname + location.search}</div>
      <div data-testid="state">{JSON.stringify(location.state)}</div>
      <div data-testid="count">{visits.current}</div>
    </>
  );
}
import type { ConnectionStatus, ConnectionSyncStatus } from '../api/connections.types';

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

function renderPanel(
  getSyncStatus: Mock<GetSyncStatus>,
  status?: ConnectionStatus
): void {
  const apiClient = createMockApiClient({
    connections: { getSyncStatus },
    adapters: {
      list: vi.fn().mockResolvedValue([
        {
          adapterKey: 'prestashop.webservice.v1',
          platformType: 'prestashop',
          orderSyncStartModes: ['now', 'from', 'all'],
          orderWindowImport: true,
        },
      ]),
    },
  });
  renderWithProviders(<OrderSyncPanel connection={{ ...CONNECTION, status }} />, {
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

    expect(await screen.findByText('Every order the shop has, starting with the newest.')).toBeInTheDocument();
  });

  it('should state every start with a date and no time of day when the start was applied', async () => {
    renderPanel(
      vi.fn<GetSyncStatus>().mockResolvedValue(
        makeStatus({
          orderStart: {
            mode: 'now',
            from: null,
            order: 'oldest-first',
            appliedAt: '2026-11-18T08:45:00.000Z',
            pending: false,
          },
        })
      )
    );

    const sentence = await screen.findByText(/^New orders only, from /);
    expect(sentence.textContent).not.toMatch(/\d:\d\d/);
  });

  it('should explain the import order in plain words when the start names one', async () => {
    renderPanel(
      vi.fn<GetSyncStatus>().mockResolvedValue(
        makeStatus({
          orderStart: {
            mode: 'from',
            from: '2026-10-01',
            order: 'oldest-first',
            appliedAt: '2026-11-18T08:00:00.000Z',
            pending: false,
          },
        })
      )
    );

    expect(await screen.findByText(/starting with the oldest\. Earlier orders stay/)).toBeInTheDocument();
  });

  it('should make Check for new orders the primary action and the start change a ghost button', async () => {
    renderPanel(vi.fn<GetSyncStatus>().mockResolvedValue(makeStatus()));

    expect(await screen.findByRole('button', { name: 'Check for new orders' })).toHaveClass('button--primary');
    expect(screen.getByRole('button', { name: 'Get orders from a period…' })).toHaveClass(
      'button--secondary'
    );
    expect(screen.getByRole('button', { name: 'Change where syncing starts…' })).toHaveClass(
      'button--ghost'
    );
  });

  it('should explain the period read in a tooltip when the connection is active', async () => {
    renderPanel(vi.fn<GetSyncStatus>().mockResolvedValue(makeStatus()));

    expect(await screen.findByRole('button', { name: 'Get orders from a period…' })).toHaveAttribute(
      'title',
      'Reads the orders of one past period, once.'
    );
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

  it('checks for new orders straight from the Orders tab', async () => {
    const user = userEvent.setup();
    const enqueue = vi.fn().mockResolvedValue({ jobId: 'job_9' });
    const apiClient = createMockApiClient({
      connections: { getSyncStatus: vi.fn<GetSyncStatus>().mockResolvedValue(makeStatus()) },
      syncJobs: { enqueue },
    });
    renderWithProviders(<OrderSyncPanel connection={CONNECTION} />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await user.click(await screen.findByRole('button', { name: 'Check for new orders' }));

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'conn_1',
        jobType: 'marketplace.orders.poll',
        payload: { schemaVersion: 1 },
      })
    );
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

    it('should show the figures, a failure banner and, in the panel, each cause with its fix', async () => {
      const user = userEvent.setup();
      renderHealth(makeStatus({ orderImport: importFigures }));

      expect(await screen.findByText('Imported in the last 24 hours')).toBeInTheDocument();
      expect(await screen.findByText('42')).toBeInTheDocument();
      expect(screen.getByText('Needs attention')).toBeInTheDocument();
      expect(screen.getByText('2 orders could not be imported')).toBeInTheDocument();
      expect(screen.queryByText('Some orders could not be imported.')).not.toBeInTheDocument();
      expect(screen.queryByText(/unknown product/)).not.toBeInTheDocument();

      expect(screen.getByRole('button', { name: 'Change where syncing starts…' })).toBeInTheDocument();
      expect(screen.getByText('History import in progress')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'View' }));

      expect(await screen.findByText(/2 orders · unknown product/)).toBeInTheDocument();
      expect(screen.getByText(/Latest: order 37/)).toBeInTheDocument();
      expect(screen.getByText(/Sync products from the shop, then use Retry failed orders/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Sync products…' })).toBeInTheDocument();
    });

    it('should say failed orders are not counted when nothing was imported next to a failure', async () => {
      renderHealth(makeStatus({ orderImport: { ...importFigures, importedLast24h: 0 } }));

      expect(await screen.findByText('Orders that failed are not counted here.')).toBeInTheDocument();
    });

    it('should not add the note when orders were imported', async () => {
      renderHealth(makeStatus({ orderImport: importFigures }));

      await screen.findByText('Imported in the last 24 hours');
      expect(screen.queryByText('Orders that failed are not counted here.')).not.toBeInTheDocument();
    });

    it('should send the operator to Actions on the product sync from the failure card', async () => {
      const user = userEvent.setup();
      const apiClient = createMockApiClient({
        connections: {
          getSyncStatus: vi.fn<GetSyncStatus>().mockResolvedValue(makeStatus({ orderImport: importFigures })),
        },
      });
      renderWithProviders(
        <>
          <OrderSyncPanel connection={CONNECTION} />
          <LocationProbe />
        </>,
        { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() }
      );

      await user.click(await screen.findByRole('button', { name: 'View' }));
      await user.click(await screen.findByRole('button', { name: 'Sync products…' }));

      expect(screen.getByTestId('location')).toHaveTextContent(
        '/connections/conn_1?tab=actions&sync=products'
      );
    });

    it('should fall back to the generic cause for a failure code this build does not know', async () => {
      renderHealth(
        makeStatus({
          orderImport: {
            ...importFigures,
            failures: [
              {
                code: 'something-new' as never,
                count: 1,
                lastFailedAt: '2026-11-18T09:30:00.000Z',
                sampleOrderId: null,
                sampleMessage: 'boom',
              },
            ],
          },
        }),
      );

      await userEvent.setup().click(await screen.findByRole('button', { name: 'View' }));

      expect(await screen.findByText(/1 order · other error/)).toBeInTheDocument();
      expect(screen.getByText(/boom/)).toBeInTheDocument();
    });

    it('should say behind, with a next step, when the shop has not been checked for over an hour', async () => {
      renderHealth(
        makeStatus({
          orderImport: {
            ...importFigures,
            failedLast7d: 0,
            failures: [],
            lastPolledAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
          },
        }),
      );

      expect(await screen.findByText('Behind')).toBeInTheDocument();
      expect(screen.getByText('What to do:')).toBeInTheDocument();
      expect(screen.getByText(/Click Check for new orders/)).toBeInTheDocument();
    });

    it('should say not checked yet when the shop was never polled successfully', async () => {
      renderHealth(
        makeStatus({
          orderImport: { ...importFigures, failedLast7d: 0, failures: [], lastPolledAt: null },
        }),
      );

      expect(await screen.findByText('There is no successful check of the shop yet.')).toBeInTheDocument();
    });

    it('should not mention failures or a running import when there are none', async () => {
      renderHealth(
        makeStatus({
          orderImport: { ...importFigures, failedLast7d: 0, failures: [], activeImport: null },
        }),
      );

      expect(await screen.findByText('Imported in the last 24 hours')).toBeInTheDocument();
      expect(screen.queryByText(/unknown product/)).not.toBeInTheDocument();
      expect(screen.queryByText('History import in progress')).not.toBeInTheDocument();
      expect(screen.queryByText('What to do:')).not.toBeInTheDocument();
    });

    it('should say the figures are unavailable rather than show zero orders', async () => {
      renderHealth(makeStatus({ orderImport: null }));

      expect(
        await screen.findByText('Order import figures are not available right now.'),
      ).toBeInTheDocument();
      expect(screen.getByText('Unknown')).toBeInTheDocument();
      expect(screen.queryByText('Imported in the last 24 hours')).not.toBeInTheDocument();
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

  it('hides the start row and the import button for an adapter that declares no start modes', async () => {
    const apiClient = createMockApiClient({
      connections: { getSyncStatus: vi.fn<GetSyncStatus>().mockResolvedValue(makeStatus()) },
      adapters: {
        list: vi.fn().mockResolvedValue([
          {
            adapterKey: 'prestashop.webservice.v1',
            platformType: 'prestashop',
            isDefault: true,
            orderSyncStartModes: [],
          },
        ]),
      },
    });
    renderWithProviders(<OrderSyncPanel connection={CONNECTION} />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    expect(await screen.findByRole('button', { name: 'Check for new orders' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Change where syncing starts…' })).not.toBeInTheDocument();
    });
    expect(screen.queryByText('Import start')).not.toBeInTheDocument();
  });

  describe('get orders from a period', () => {
    const adapterWithWindow = (orderWindowImport: boolean) => ({
      list: vi.fn().mockResolvedValue([
        {
          adapterKey: 'prestashop.webservice.v1',
          platformType: 'prestashop',
          orderSyncStartModes: ['now', 'from', 'all'],
          orderWindowImport,
        },
      ]),
    });

    it('jumps to Actions at once, with the guided state, when motion is not allowed', async () => {
      const user = userEvent.setup();
      const apiClient = createMockApiClient({
        connections: { getSyncStatus: vi.fn<GetSyncStatus>().mockResolvedValue(makeStatus()) },
        adapters: adapterWithWindow(true),
      });
      renderWithProviders(
        <>
          <OrderSyncPanel connection={CONNECTION} />
          <LocationProbe />
        </>,
        { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() }
      );

      await user.click(await screen.findByRole('button', { name: 'Get orders from a period…' }));

      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent(
          '/connections/conn_1?tab=actions&sync=orders&scope=range'
        )
      );
      expect(screen.getByTestId('state')).toHaveTextContent('{"guided":true,"fromTab":"orders"}');
    });

    it('presses and ripples first with motion, jumps once, and ignores a second click', async () => {
      vi.stubGlobal('matchMedia', () => ({ matches: true }));
      try {
        const user = userEvent.setup();
        const apiClient = createMockApiClient({
          connections: { getSyncStatus: vi.fn<GetSyncStatus>().mockResolvedValue(makeStatus()) },
          adapters: adapterWithWindow(true),
        });
        renderWithProviders(
          <>
            <OrderSyncPanel connection={CONNECTION} />
            <LocationProbe />
          </>,
          { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() }
        );

        const button = await screen.findByRole('button', { name: 'Get orders from a period…' });
        await user.click(button);
        await user.click(button);

        expect(button).toHaveClass('guided-press');
        expect(button.querySelector('.guided-ripple')).not.toBeNull();
        expect(screen.getByTestId('location')).not.toHaveTextContent('tab=actions');
        await waitFor(() =>
          expect(screen.getByTestId('location')).toHaveTextContent('tab=actions&sync=orders&scope=range')
        );
        expect(screen.getByTestId('count')).toHaveTextContent('1');
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('does not offer the period read when the shop cannot read a window', async () => {
      const apiClient = createMockApiClient({
        connections: { getSyncStatus: vi.fn<GetSyncStatus>().mockResolvedValue(makeStatus()) },
        adapters: adapterWithWindow(false),
      });
      renderWithProviders(<OrderSyncPanel connection={CONNECTION} />, {
        apiClient,
        sessionAdapter: createAuthenticatedSessionAdapter(),
      });

      expect(await screen.findByRole('button', { name: 'Check for new orders' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Get orders from a period…' })).not.toBeInTheDocument();
    });
  });

  describe('restart', () => {
    it('says nothing is skipped when restarting to new orders only', async () => {
      const user = userEvent.setup();
      renderPanel(vi.fn<GetSyncStatus>().mockResolvedValue(makeStatus()));

      await user.click(await screen.findByRole('button', { name: 'Change where syncing starts…' }));

      expect(
        await screen.findByText(
          'OpenLinker keeps importing new orders from the last check.'
        )
      ).toBeInTheDocument();
      expect(screen.queryByText(/are skipped/)).not.toBeInTheDocument();
    });

    it('restarts the sync from the chosen start and confirms', async () => {
      const user = userEvent.setup();
      const restartOrderSync = vi.fn().mockResolvedValue({ applied: true });
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

      await user.click(await screen.findByRole('button', { name: 'Change where syncing starts…' }));
      await user.click(await screen.findByRole('radio', { name: /Every order the shop has/ }));
      await user.click(screen.getByRole('button', { name: 'Apply change' }));

      expect(restartOrderSync).toHaveBeenCalledWith('conn_1', { mode: 'all' });
    });

    it('does not send a start date that is not acceptable', async () => {
      const user = userEvent.setup();
      const restartOrderSync = vi.fn().mockResolvedValue({ applied: true });
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

      await user.click(await screen.findByRole('button', { name: 'Change where syncing starts…' }));
      await user.click(await screen.findByRole('radio', { name: /Orders since a date/ }));

      expect(screen.getByRole('button', { name: 'Apply change' })).toBeDisabled();
      expect(restartOrderSync).not.toHaveBeenCalled();
    });
  });

  describe('a connection that is not active', () => {
    const staleImport = {
      importedLast24h: 0,
      lastPolledAt: '2026-11-10T10:00:00.000Z',
      failedLast7d: 0,
      failures: [],
      waiting: 0,
      lastImportedAt: null,
      activeImport: null,
    };
    const cases: Array<[ConnectionStatus, string, RegExp]> = [
      ['needs_reauth', 'Sign-in needed', /Re-authenticate first/],
      ['disabled', 'Paused', /Enable the connection first/],
      ['error', 'Connection error', /Fix the connection first/],
      ['archived', 'Archived', /Restore the connection first/],
    ];

    it.each(cases)(
      'should say what to do and disable the actions when the status is %s',
      async (status, verdict, next) => {
        renderPanel(
          vi.fn<GetSyncStatus>().mockResolvedValue(makeStatus({ orderImport: staleImport })),
          status
        );

        expect(await screen.findByText(verdict)).toBeInTheDocument();
        expect(screen.getByText(next)).toBeInTheDocument();
        expect(screen.queryByText('Behind')).not.toBeInTheDocument();
        expect(screen.queryByText(/Click Check for new orders/)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Check for new orders' })).toBeDisabled();
        expect(screen.getByRole('button', { name: /Get orders from a period/ })).toBeDisabled();
        expect(screen.getByRole('button', { name: /Change where syncing starts/ })).toBeDisabled();
      }
    );

    it('should link a connection that needs re-authentication to the place that fixes it', async () => {
      renderPanel(
        vi.fn<GetSyncStatus>().mockResolvedValue(makeStatus({ orderImport: staleImport })),
        'needs_reauth'
      );

      const link = await screen.findByRole('link', { name: 'Re-authenticate' });
      expect(link).toHaveAttribute('href', '/connections/conn_1/edit');
    });

    it('should keep the actions enabled when the connection is active', async () => {
      renderPanel(
        vi.fn<GetSyncStatus>().mockResolvedValue(makeStatus({ orderImport: staleImport })),
        'active'
      );

      expect(await screen.findByText('Behind')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Check for new orders' })).toBeEnabled();
    });
  });
});

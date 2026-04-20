import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../test/test-utils';
import { DashboardPage } from './dashboard-page';
import type { Connection } from '../../features/connections/api/connections.types';
import type {
  PaginatedSyncJobs,
  SyncJob,
  SyncJobFilters,
  SyncJobPagination,
} from '../../features/sync-jobs/api/sync-jobs.types';
import { SYNC_JOBS_MAX_LIMIT } from '../../features/sync-jobs/api/sync-jobs.types';

function makeSyncJob(overrides: Partial<SyncJob> = {}): SyncJob {
  return {
    id: 'job_1',
    jobType: 'marketplace.orders.poll',
    connectionId: 'conn_1',
    status: 'succeeded',
    attempts: 1,
    maxAttempts: 3,
    nextRunAt: '2026-04-11T00:00:00.000Z',
    lastError: null,
    payloadJson: null,
    idempotencyKey: null,
    lockedAt: null,
    lockedBy: null,
    createdAt: '2026-04-11T00:00:00.000Z',
    updatedAt: '2026-04-11T00:00:00.000Z',
    ...overrides,
  };
}

function makeConnection(overrides: Partial<Connection>): Connection {
  return { ...sampleConnection, ...overrides };
}

function findCardByLabel(container: HTMLElement, label: string): HTMLElement {
  const labels = Array.from(container.querySelectorAll<HTMLElement>('.metric-card__label')).filter(
    (el) => el.textContent === label,
  );
  if (labels.length !== 1) {
    throw new Error(`Expected one .metric-card__label "${label}", found ${labels.length}`);
  }
  const card = labels[0].closest('.metric-card');
  if (!(card instanceof HTMLElement)) {
    throw new Error(`No .metric-card ancestor for label: ${label}`);
  }
  return card;
}

describe('DashboardPage', () => {
  afterEach(cleanup);

  it('renders the operations overview heading', () => {
    renderWithProviders(<DashboardPage />);
    expect(screen.getByRole('heading', { name: 'Operations overview' })).toBeInTheDocument();
  });

  it('shows real connection count from API', async () => {
    const apiClient = createMockApiClient({
      connections: {
        list: vi.fn().mockResolvedValue([
          makeConnection({ id: 'c1', name: 'Store A', status: 'active', platformType: 'prestashop' }),
          makeConnection({ id: 'c2', name: 'Store B', status: 'error', platformType: 'allegro' }),
        ]),
      },
    });
    renderWithProviders(<DashboardPage />, { apiClient });

    expect(await screen.findByText('1 / 2')).toBeInTheDocument();
    expect(screen.getByText('Store A')).toBeInTheDocument();
    expect(screen.getByText('Store B')).toBeInTheDocument();
  });

  it('shows system health services from API', async () => {
    const { container } = renderWithProviders(<DashboardPage />);

    expect(await within(container).findByText('PostgreSQL')).toBeInTheDocument();
    expect(within(container).getByText('Redis')).toBeInTheDocument();
    expect(within(container).getByText('PrestaShop')).toBeInTheDocument();
  });

  it('shows error message when a service is degraded', async () => {
    const apiClient = createMockApiClient({
      health: {
        getDevStackHealth: vi.fn().mockResolvedValue({
          status: 'degraded',
          services: {
            postgres: { status: 'ok' },
            redis: { status: 'ok' },
            prestashop: { status: 'error', message: 'Connection refused' },
            worker: { status: 'ok' },
          },
          timestamp: '2026-04-06T00:00:00.000Z',
        }),
      },
    });
    renderWithProviders(<DashboardPage />, { apiClient });

    expect(await screen.findByText('Connection refused')).toBeInTheDocument();
  });

  it('shows loading state while connections are fetching', () => {
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockReturnValue(new Promise(() => {})) },
    });
    renderWithProviders(<DashboardPage />, { apiClient });

    expect(screen.getByRole('heading', { name: 'Loading connections' })).toBeInTheDocument();
  });

  it('shows error state when health check fails', async () => {
    const apiClient = createMockApiClient({
      health: {
        getDevStackHealth: vi.fn().mockRejectedValue(new Error('Health endpoint unreachable')),
      },
    });
    renderWithProviders(<DashboardPage />, { apiClient });

    expect(await screen.findByRole('heading', { name: 'Health check failed' }, { timeout: 10000 })).toBeInTheDocument();
  }, 15000);

  it('shows recent sync jobs in a table', async () => {
    const listMock = vi.fn().mockImplementation((filters?: { status?: string }) => {
      if (filters?.status === 'dead') {
        return Promise.resolve({ items: [], total: 0, limit: 10, offset: 0 });
      }
      return Promise.resolve({
        items: [
          makeSyncJob({ id: 'j1', jobType: 'marketplace.orders.poll', status: 'succeeded' }),
          makeSyncJob({ id: 'j2', jobType: 'marketplace.offers.sync', status: 'running' }),
        ],
        total: 2,
        limit: 5,
        offset: 0,
      });
    });
    const apiClient = createMockApiClient({
      syncJobs: { list: listMock },
    });
    renderWithProviders(<DashboardPage />, { apiClient });

    expect(await screen.findByText('marketplace › orders › poll')).toBeInTheDocument();
    expect(screen.getByText('marketplace › offers › sync')).toBeInTheDocument();
  });

  it('shows failed jobs count in metric card', async () => {
    const listMock = vi.fn().mockImplementation((filters?: { status?: string }) => {
      if (filters?.status === 'dead') {
        return Promise.resolve({
          items: [makeSyncJob({ id: 'dead1', status: 'dead', lastError: 'Timeout' })],
          total: 1,
          limit: 10,
          offset: 0,
        });
      }
      return Promise.resolve({ items: [], total: 0, limit: 5, offset: 0 });
    });
    const apiClient = createMockApiClient({
      syncJobs: { list: listMock },
    });
    renderWithProviders(<DashboardPage />, { apiClient });

    expect(await screen.findByText('1 job needs attention')).toBeInTheDocument();
  });

  it('tints the Failed jobs card red and links to /jobs-logs?status=dead when there are failures', async () => {
    const listMock = vi.fn().mockImplementation((filters?: { status?: string }) => {
      if (filters?.status === 'dead') {
        return Promise.resolve({
          items: [makeSyncJob({ id: 'dead1', status: 'dead', lastError: 'Timeout' })],
          total: 3,
          limit: 100,
          offset: 0,
        });
      }
      return Promise.resolve({ items: [], total: 0, limit: 5, offset: 0 });
    });
    const apiClient = createMockApiClient({
      syncJobs: { list: listMock },
    });

    const { container } = renderWithProviders(<DashboardPage />, { apiClient });

    await screen.findByText('3 jobs need attention');
    const failedCard = findCardByLabel(container, 'Failed jobs');
    expect(failedCard).toHaveClass('metric-card--error');
    expect(failedCard).toHaveAttribute('href', '/jobs-logs?status=dead');
  });

  it('keeps the Failed jobs card neutral when there are no failures', async () => {
    const { container } = renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      const failedCard = findCardByLabel(container, 'Failed jobs');
      expect(failedCard).toHaveClass('metric-card--neutral');
    });
    const failedCard = findCardByLabel(container, 'Failed jobs');
    expect(failedCard.tagName).toBe('DIV');
    expect(failedCard).not.toHaveClass('metric-card--error');
    expect(failedCard).not.toHaveClass('metric-card--success');
  });

  it('tints the Integration health card warning when a connection is in error', async () => {
    const apiClient = createMockApiClient({
      connections: {
        list: vi.fn().mockResolvedValue([
          makeConnection({ id: 'c1', name: 'Store A', status: 'active', platformType: 'prestashop' }),
          makeConnection({ id: 'c2', name: 'Store B', status: 'error', platformType: 'allegro' }),
        ]),
      },
    });

    const { container } = renderWithProviders(<DashboardPage />, { apiClient });

    await screen.findByText('1 / 2');
    const integrationCard = findCardByLabel(container, 'Integration health');
    expect(integrationCard).toHaveClass('metric-card--warning');
    const icon = integrationCard.querySelector('.metric-card__icon');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
  });

  it('requests dead jobs with limit capped at SYNC_JOBS_MAX_LIMIT (regression guard for #270)', async () => {
    const listMock = vi.fn().mockResolvedValue({ items: [], total: 0, limit: SYNC_JOBS_MAX_LIMIT, offset: 0 });
    const apiClient = createMockApiClient({ syncJobs: { list: listMock } });
    renderWithProviders(<DashboardPage />, { apiClient });

    await waitFor(() => {
      const deadCall = listMock.mock.calls.find((call) => {
        const filters = call[0] as unknown as SyncJobFilters | undefined;
        return filters !== undefined && filters.status === 'dead';
      });
      expect(deadCall).toBeDefined();
      // The backend caps this at SYNC_JOBS_MAX_LIMIT (=100). Requesting any
      // higher value returns HTTP 400 and breaks the incidents panel.
      const pagination = (deadCall as unknown[])[1] as SyncJobPagination;
      expect(pagination.limit).toBeLessThanOrEqual(SYNC_JOBS_MAX_LIMIT);
      expect(pagination.limit).toBe(SYNC_JOBS_MAX_LIMIT);
    });
  });

  it('shows error state when sync jobs fail to load', async () => {
    const apiClient = createMockApiClient({
      syncJobs: {
        list: vi.fn().mockRejectedValue(new Error('Sync API down')),
      },
    });
    renderWithProviders(<DashboardPage />, { apiClient });

    expect(
      await screen.findByRole('heading', { name: 'Unable to load sync jobs' }, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  it('shows empty state when no sync jobs exist', async () => {
    renderWithProviders(<DashboardPage />);

    // Wait for queries to settle, then verify empty states are present
    await waitFor(() => {
      expect(screen.queryAllByText('No sync jobs recorded yet.').length).toBeGreaterThan(0);
    });
    await waitFor(() => {
      expect(screen.queryAllByText('No failed jobs. All clear.').length).toBeGreaterThan(0);
    });
  });

  describe('"What\'s broken right now" triage surface', () => {
    function buildListMock(
      deadJobs: SyncJob[],
    ): (filters?: SyncJobFilters) => Promise<PaginatedSyncJobs> {
      return vi.fn().mockImplementation((filters?: { status?: string }) => {
        if (filters?.status === 'dead') {
          return Promise.resolve({
            items: deadJobs,
            total: deadJobs.length,
            limit: 100,
            offset: 0,
          });
        }
        if (filters?.status === 'queued') {
          return Promise.resolve({ items: [], total: 0, limit: 1, offset: 0 });
        }
        return Promise.resolve({ items: [], total: 0, limit: 5, offset: 0 });
      });
    }

    it('groups dead jobs that share connection + job type into a single row with a count badge', async () => {
      const deadJobs: SyncJob[] = Array.from({ length: 3 }, (_, i) =>
        makeSyncJob({
          id: `dead_${i}`,
          status: 'dead',
          connectionId: 'conn_1',
          jobType: 'master.inventory.syncByExternalId',
          lastError: 'FK violation',
          updatedAt: `2026-04-20T10:0${i}:00.000Z`,
        }),
      );
      const apiClient = createMockApiClient({
        syncJobs: { list: buildListMock(deadJobs) },
      });
      renderWithProviders(<DashboardPage />, { apiClient });

      expect(
        await screen.findByRole('heading', { name: /What\u2019s broken right now/ }),
      ).toBeInTheDocument();
      expect(await screen.findByText('master › inventory › syncByExternalId')).toBeInTheDocument();
      expect(screen.getByText('1 unique signature · 3 total failures')).toBeInTheDocument();
    });

    it('renders one group per (connection, jobType) pair sorted by count desc', async () => {
      const deadJobs: SyncJob[] = [
        makeSyncJob({ id: 'a1', connectionId: 'conn_1', jobType: 'alpha' }),
        makeSyncJob({ id: 'b1', connectionId: 'conn_2', jobType: 'beta' }),
        makeSyncJob({ id: 'b2', connectionId: 'conn_2', jobType: 'beta' }),
      ];
      const apiClient = createMockApiClient({
        syncJobs: { list: buildListMock(deadJobs) },
      });
      renderWithProviders(<DashboardPage />, { apiClient });

      expect(
        await screen.findByText('2 unique signatures · 3 total failures'),
      ).toBeInTheDocument();
    });

    it('calls the retry mutation for the representative job when Retry is clicked', async () => {
      const deadJobs: SyncJob[] = [
        makeSyncJob({
          id: 'rep_1',
          status: 'dead',
          connectionId: 'conn_1',
          jobType: 'some.failing.job',
          updatedAt: '2026-04-20T10:05:00.000Z',
        }),
      ];
      const retryMock = vi.fn().mockResolvedValue(deadJobs[0]);
      const apiClient = createMockApiClient({
        syncJobs: { list: buildListMock(deadJobs), retry: retryMock },
      });
      renderWithProviders(<DashboardPage />, { apiClient });

      await screen.findByText('some › failing › job');
      // Row action is uniquely labelled via `aria-label` so screen readers
      // can tell rows apart; use that to target the right button.
      const retryButton = await screen.findByRole('button', {
        name: /Retry — some › failing › job on Main PrestaShop Store/,
      });
      fireEvent.click(retryButton);
      await waitFor(() => {
        expect(retryMock).toHaveBeenCalledWith('rep_1');
      });
    });

    it('labels the Retry button with the group size when there is more than one failure', async () => {
      const deadJobs: SyncJob[] = [
        makeSyncJob({
          id: 'a1',
          status: 'dead',
          connectionId: 'conn_1',
          jobType: 'chatty.failing.job',
          updatedAt: '2026-04-20T10:01:00.000Z',
        }),
        makeSyncJob({
          id: 'a2',
          status: 'dead',
          connectionId: 'conn_1',
          jobType: 'chatty.failing.job',
          updatedAt: '2026-04-20T10:02:00.000Z',
        }),
        makeSyncJob({
          id: 'a3',
          status: 'dead',
          connectionId: 'conn_1',
          jobType: 'chatty.failing.job',
          updatedAt: '2026-04-20T10:03:00.000Z',
        }),
      ];
      const apiClient = createMockApiClient({
        syncJobs: { list: buildListMock(deadJobs) },
      });
      renderWithProviders(<DashboardPage />, { apiClient });

      expect(
        await screen.findByRole('button', { name: /Retry 1 of 3 — chatty › failing › job/ }),
      ).toBeInTheDocument();
    });

    it('surfaces the remaining-failures caveat in the success toast for a multi-row group', async () => {
      const deadJobs: SyncJob[] = Array.from({ length: 3 }, (_, i) =>
        makeSyncJob({
          id: `bulk_${i}`,
          status: 'dead',
          connectionId: 'conn_1',
          jobType: 'bulk.failing.job',
          updatedAt: `2026-04-20T10:0${i}:00.000Z`,
        }),
      );
      const retryMock = vi.fn().mockResolvedValue(deadJobs[2]);
      const apiClient = createMockApiClient({
        syncJobs: { list: buildListMock(deadJobs), retry: retryMock },
      });
      renderWithProviders(<DashboardPage />, { apiClient });

      const retryButton = await screen.findByRole('button', {
        name: /Retry 1 of 3 — bulk › failing › job on Main PrestaShop Store/,
      });
      fireEvent.click(retryButton);

      expect(
        await screen.findByText(/2 other failures still dead/i),
      ).toBeInTheDocument();
    });

    it('shows "signatures in first N" when the dead-job page is capped below the total', async () => {
      const deadJobs: SyncJob[] = [
        makeSyncJob({ id: 'd1', status: 'dead', connectionId: 'conn_1', jobType: 'a.b' }),
        makeSyncJob({ id: 'd2', status: 'dead', connectionId: 'conn_1', jobType: 'a.b' }),
      ];
      const apiClient = createMockApiClient({
        syncJobs: {
          list: vi.fn().mockImplementation((filters?: { status?: string }) => {
            if (filters?.status === 'dead') {
              // Server reports a higher total than the page returns.
              return Promise.resolve({
                items: deadJobs,
                total: 1234,
                limit: 100,
                offset: 0,
              });
            }
            return Promise.resolve({ items: [], total: 0, limit: 5, offset: 0 });
          }),
        },
      });
      renderWithProviders(<DashboardPage />, { apiClient });

      expect(
        await screen.findByText('1 signatures in first 2 · 1234 total failures'),
      ).toBeInTheDocument();
    });
  });

  describe('connection health roll-up', () => {
    it('marks a connection warning even when DB status=active but it has dead jobs', async () => {
      const healthyConn = makeConnection({
        id: 'conn_healthy',
        name: 'Shop A',
        status: 'active',
      });
      const failingConn = makeConnection({
        id: 'conn_failing',
        name: 'Shop B',
        status: 'active',
      });
      const deadJobs: SyncJob[] = [
        makeSyncJob({ id: 'd1', status: 'dead', connectionId: 'conn_failing' }),
        makeSyncJob({ id: 'd2', status: 'dead', connectionId: 'conn_failing' }),
      ];
      const apiClient = createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([healthyConn, failingConn]) },
        syncJobs: {
          list: vi.fn().mockImplementation((filters?: { status?: string }) => {
            if (filters?.status === 'dead') {
              return Promise.resolve({ items: deadJobs, total: 2, limit: 100, offset: 0 });
            }
            return Promise.resolve({ items: [], total: 0, limit: 5, offset: 0 });
          }),
        },
      });

      const { container } = renderWithProviders(<DashboardPage />, { apiClient });

      // "Shop B" appears in both the Connection health list and the incidents
      // table's Connection column — just wait for it to land in the DOM.
      await waitFor(() => {
        expect(screen.getAllByText('Shop B').length).toBeGreaterThan(0);
      });
      const integrationCard = findCardByLabel(container, 'Integration health');
      expect(integrationCard).toHaveClass('metric-card--warning');
      expect(screen.getByText('1 connection with failing jobs')).toBeInTheDocument();
      // The roll-up attaches a "N failing jobs" link next to the connection name.
      const failingJobsLink = screen.getByRole('link', { name: /2 failing jobs/ });
      expect(failingJobsLink).toHaveAttribute(
        'href',
        '/jobs-logs?status=dead&connectionId=conn_failing',
      );
    });
  });
});

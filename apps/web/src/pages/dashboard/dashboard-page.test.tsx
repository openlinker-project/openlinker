import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../test/test-utils';
import { DashboardPage } from './dashboard-page';
import type { Connection } from '../../features/connections/api/connections.types';
import type {
  JobType,
  SyncJob,
  SyncJobGroup,
  SyncJobGroupsResponse,
} from '../../features/sync-jobs/api/sync-jobs.types';

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

function makeGroup(overrides: Partial<SyncJobGroup> = {}): SyncJobGroup {
  return {
    connectionId: 'conn_1',
    jobType: 'master.inventory.syncByExternalId' as JobType,
    count: 1,
    latestUpdatedAt: '2026-04-20T10:00:00.000Z',
    representativeJobId: 'rep_1',
    lastError: null,
    ...overrides,
  };
}

function groupsResponse(groups: SyncJobGroup[]): SyncJobGroupsResponse {
  return {
    groups,
    totalGroups: groups.length,
    totalJobs: groups.reduce((sum, g) => sum + g.count, 0),
  };
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
    const listMock = vi.fn().mockImplementation(() => {
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
    const apiClient = createMockApiClient({
      syncJobs: {
        listGrouped: vi.fn().mockResolvedValue(
          groupsResponse([
            makeGroup({ count: 1, lastError: 'Timeout' }),
          ]),
        ),
      },
    });
    renderWithProviders(<DashboardPage />, { apiClient });

    expect(await screen.findByText('1 job needs attention')).toBeInTheDocument();
  });

  it('tints the Failed jobs card red and links to /jobs-logs?status=dead when there are failures', async () => {
    const apiClient = createMockApiClient({
      syncJobs: {
        listGrouped: vi.fn().mockResolvedValue(
          groupsResponse([makeGroup({ count: 3, lastError: 'Timeout' })]),
        ),
      },
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
    it('calls listGrouped with status=dead (regression guard: grouping happens server-side)', async () => {
      const listGrouped = vi.fn().mockResolvedValue(groupsResponse([]));
      const apiClient = createMockApiClient({ syncJobs: { listGrouped } });
      renderWithProviders(<DashboardPage />, { apiClient });

      await waitFor(() => {
        expect(listGrouped).toHaveBeenCalledWith({ status: 'dead' });
      });
    });

    it('renders one row per server-returned group with count and total', async () => {
      const apiClient = createMockApiClient({
        syncJobs: {
          listGrouped: vi.fn().mockResolvedValue(
            groupsResponse([
              makeGroup({
                connectionId: 'conn_1',
                jobType: 'master.inventory.syncByExternalId' as JobType,
                count: 3,
                lastError: 'FK violation',
              }),
            ]),
          ),
        },
      });
      renderWithProviders(<DashboardPage />, { apiClient });

      expect(
        await screen.findByRole('heading', { name: /What’s broken right now/ }),
      ).toBeInTheDocument();
      expect(await screen.findByText('master › inventory › syncByExternalId')).toBeInTheDocument();
      expect(screen.getByText('1 unique signature · 3 total failures')).toBeInTheDocument();
    });

    it('renders one group per (connection, jobType) pair sorted by the server', async () => {
      const apiClient = createMockApiClient({
        syncJobs: {
          listGrouped: vi.fn().mockResolvedValue(
            groupsResponse([
              makeGroup({
                connectionId: 'conn_2',
                jobType: 'marketplace.order.sync' as JobType,
                count: 2,
              }),
              makeGroup({
                connectionId: 'conn_1',
                jobType: 'marketplace.orders.poll' as JobType,
                count: 1,
              }),
            ]),
          ),
        },
      });
      renderWithProviders(<DashboardPage />, { apiClient });

      expect(
        await screen.findByText('2 unique signatures · 3 total failures'),
      ).toBeInTheDocument();
    });

    it('calls retryGrouped with the group selector when Retry is clicked', async () => {
      const retryGrouped = vi.fn().mockResolvedValue({
        requeuedJobIds: ['rep_1'],
        count: 1,
        skipped: 0,
      });
      const apiClient = createMockApiClient({
        syncJobs: {
          listGrouped: vi.fn().mockResolvedValue(
            groupsResponse([
              makeGroup({
                connectionId: 'conn_1',
                jobType: 'some.failing.job' as JobType,
                count: 1,
              }),
            ]),
          ),
          retryGrouped,
        },
      });
      renderWithProviders(<DashboardPage />, { apiClient });

      await screen.findByText('some › failing › job');
      const retryButton = await screen.findByRole('button', {
        name: /Retry — some › failing › job on Main PrestaShop Store/,
      });
      fireEvent.click(retryButton);

      await waitFor(() => {
        expect(retryGrouped).toHaveBeenCalledWith({
          connectionId: 'conn_1',
          jobType: 'some.failing.job',
        });
      });
    });

    it('shows a success toast with the re-queued count', async () => {
      const retryGrouped = vi.fn().mockResolvedValue({
        requeuedJobIds: ['j1', 'j2', 'j3'],
        count: 3,
        skipped: 0,
      });
      const apiClient = createMockApiClient({
        syncJobs: {
          listGrouped: vi.fn().mockResolvedValue(
            groupsResponse([
              makeGroup({
                connectionId: 'conn_1',
                jobType: 'bulk.failing.job' as JobType,
                count: 3,
              }),
            ]),
          ),
          retryGrouped,
        },
      });
      renderWithProviders(<DashboardPage />, { apiClient });

      const retryButton = await screen.findByRole('button', {
        name: /Retry — bulk › failing › job on Main PrestaShop Store/,
      });
      fireEvent.click(retryButton);

      expect(await screen.findByText(/Re-queued 3 jobs/i)).toBeInTheDocument();
    });

    it('mentions skipped jobs in the toast when the bulk endpoint skips some', async () => {
      const retryGrouped = vi.fn().mockResolvedValue({
        requeuedJobIds: ['j1'],
        count: 1,
        skipped: 2,
      });
      const apiClient = createMockApiClient({
        syncJobs: {
          listGrouped: vi.fn().mockResolvedValue(
            groupsResponse([
              makeGroup({
                connectionId: 'conn_1',
                jobType: 'partial.retry.job' as JobType,
                count: 3,
              }),
            ]),
          ),
          retryGrouped,
        },
      });
      renderWithProviders(<DashboardPage />, { apiClient });

      const retryButton = await screen.findByRole('button', {
        name: /Retry — partial › retry › job on Main PrestaShop Store/,
      });
      fireEvent.click(retryButton);

      expect(
        await screen.findByText(/skipped 2 already running/i),
      ).toBeInTheDocument();
    });

    it('shows an honest "nothing re-queued" toast when the bulk endpoint returns count=0', async () => {
      // Race case: every candidate flipped out of dead between the dashboard
      // fetch and the retry click. Toast should read as neutral, not success.
      const retryGrouped = vi.fn().mockResolvedValue({
        requeuedJobIds: [],
        count: 0,
        skipped: 3,
      });
      const apiClient = createMockApiClient({
        syncJobs: {
          listGrouped: vi.fn().mockResolvedValue(
            groupsResponse([
              makeGroup({
                connectionId: 'conn_1',
                jobType: 'racy.job' as JobType,
                count: 3,
              }),
            ]),
          ),
          retryGrouped,
        },
      });
      renderWithProviders(<DashboardPage />, { apiClient });

      const retryButton = await screen.findByRole('button', {
        name: /Retry — racy › job on Main PrestaShop Store/,
      });
      fireEvent.click(retryButton);

      expect(await screen.findByText(/Nothing re-queued/i)).toBeInTheDocument();
      expect(screen.getByText(/no dead jobs remain/i)).toBeInTheDocument();
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
      const apiClient = createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([healthyConn, failingConn]) },
        syncJobs: {
          listGrouped: vi.fn().mockResolvedValue(
            groupsResponse([
              makeGroup({
                connectionId: 'conn_failing',
                jobType: 'some.job' as JobType,
                count: 2,
              }),
            ]),
          ),
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

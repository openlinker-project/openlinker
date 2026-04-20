import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../test/test-utils';
import { DashboardPage } from './dashboard-page';
import type { SyncJob } from '../../features/sync-jobs/api/sync-jobs.types';

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
          { id: 'c1', name: 'Store A', status: 'active', platformType: 'prestashop', config: {}, credentialsBacked: true, createdAt: '', updatedAt: '' },
          { id: 'c2', name: 'Store B', status: 'error', platformType: 'allegro', config: {}, credentialsBacked: true, createdAt: '', updatedAt: '' },
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

  it('tints the Failed jobs card red and links to /orders/failed when there are failures', async () => {
    const listMock = vi.fn().mockImplementation((filters?: { status?: string }) => {
      if (filters?.status === 'dead') {
        return Promise.resolve({
          items: [makeSyncJob({ id: 'dead1', status: 'dead', lastError: 'Timeout' })],
          total: 3,
          limit: 10,
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
    const errorCard = container.querySelector('.metric-card--error');
    expect(errorCard).not.toBeNull();
    expect(errorCard).toHaveAttribute('href', '/orders/failed');
  });

  it('leaves the Failed jobs card in the success tone when there are no failures', async () => {
    const { container } = renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(container.querySelector('.metric-card--error')).toBeNull();
    });
    expect(container.querySelector('.metric-card--success')).not.toBeNull();
  });

  it('tints the Integration health card warning when a connection is in error', async () => {
    const apiClient = createMockApiClient({
      connections: {
        list: vi.fn().mockResolvedValue([
          { id: 'c1', name: 'Store A', status: 'active', platformType: 'prestashop', config: {}, credentialsBacked: true, createdAt: '', updatedAt: '', enabledCapabilities: [], supportedCapabilities: [] },
          { id: 'c2', name: 'Store B', status: 'error', platformType: 'allegro', config: {}, credentialsBacked: true, createdAt: '', updatedAt: '', enabledCapabilities: [], supportedCapabilities: [] },
        ]),
      },
    });

    const { container } = renderWithProviders(<DashboardPage />, { apiClient });

    await screen.findByText('1 / 2');
    expect(container.querySelector('.metric-card--warning')).not.toBeNull();
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
});

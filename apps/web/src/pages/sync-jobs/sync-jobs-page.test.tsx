import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../test/test-utils';
import { SyncJobsPage } from './sync-jobs-page';
import type {
  PaginatedSyncJobs,
  SyncJobFilters,
  SyncJobPagination,
} from '../../features/sync-jobs/api/sync-jobs.types';
import { SYNC_JOBS_MAX_LIMIT } from '../../features/sync-jobs/api/sync-jobs.types';
import type { Connection } from '../../features/connections/api/connections.types';

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn_allegro_1',
    name: 'Allegro Europe',
    platformType: 'allegro',
    status: 'active',
    config: {},
    credentialsBacked: true,
    enabledCapabilities: [],
    supportedCapabilities: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const sampleJobs: PaginatedSyncJobs = {
  items: [
    {
      id: 'job_abc12345-1111-2222-3333-444444444444',
      jobType: 'marketplace.orders.poll',
      connectionId: 'conn_allegro_1',
      status: 'succeeded',
      outcome: 'ok',
      attempts: 1,
      maxAttempts: 3,
      nextRunAt: '2026-01-15T10:05:00.000Z',
      lastError: null,
      payloadJson: null,
      idempotencyKey: null,
      lockedAt: null,
      lockedBy: null,
      createdAt: '2026-01-15T10:00:00.000Z',
      updatedAt: '2026-01-15T10:01:00.000Z',
    },
  ],
  total: 1,
  limit: 20,
  offset: 0,
};

describe('SyncJobsPage', () => {
  afterEach(cleanup);
  it('should show loading state initially', () => {
    const mockApi = createMockApiClient({
      syncJobs: { list: vi.fn().mockReturnValue(new Promise(() => {})) },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<SyncJobsPage />, { apiClient: mockApi });

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('should show jobs table when data loads', async () => {
    const mockApi = createMockApiClient({
      syncJobs: { list: vi.fn().mockResolvedValue(sampleJobs) },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<SyncJobsPage />, { apiClient: mockApi });

    expect(await screen.findByText(/1 \/ 3/)).toBeInTheDocument();
    expect(screen.getAllByText('marketplace.orders.poll').length).toBeGreaterThan(1);
  });

  it('renders the Diagnostics eyebrow so the header matches the sidebar group and breadcrumb', async () => {
    const mockApi = createMockApiClient({
      syncJobs: { list: vi.fn().mockResolvedValue(sampleJobs) },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<SyncJobsPage />, { apiClient: mockApi });

    expect(await screen.findByText('Diagnostics')).toBeInTheDocument();
  });

  it('should show error state when fetch fails', async () => {
    const mockApi = createMockApiClient({
      syncJobs: { list: vi.fn().mockRejectedValue(new Error('Service unavailable')) },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<SyncJobsPage />, { apiClient: mockApi });

    expect(await screen.findByText('Unable to load sync jobs')).toBeInTheDocument();
    expect(screen.getByText('Service unavailable')).toBeInTheDocument();
  });

  it('should show empty state without an action when no jobs exist and no filter is active', async () => {
    const mockApi = createMockApiClient({
      syncJobs: { list: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 }) },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<SyncJobsPage />, { apiClient: mockApi });

    expect(await screen.findByText('No jobs found')).toBeInTheDocument();
    // Jobs are system-populated — no CTA for the no-filter branch.
    expect(screen.queryByRole('button', { name: /clear filters/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /manage connections|browse|add the first/i }),
    ).not.toBeInTheDocument();
  });

  it('should show a Clear filters button that clears all filter params when filters are active', async () => {
    const user = userEvent.setup();
    const mockApi = createMockApiClient({
      syncJobs: { list: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 }) },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<SyncJobsPage />, {
      apiClient: mockApi,
      route: '/sync-jobs?status=failed&jobType=order.sync',
    });

    expect(await screen.findByText('No jobs match the current filters.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));

    // After clearing, we're back to the informational empty state — no button.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
    });
    expect(screen.getByText('No sync jobs have been enqueued yet.')).toBeInTheDocument();
  });

  // Regression guard for #270: the backend rejects `limit > 100` with HTTP 400
  // ("limit must not be greater than 100"). The page previously requested 200
  // and broke every load.
  it('requests sync jobs with limit capped at SYNC_JOBS_MAX_LIMIT', async () => {
    const listMock = vi.fn().mockResolvedValue(sampleJobs);
    const mockApi = createMockApiClient({
      syncJobs: { list: listMock },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<SyncJobsPage />, { apiClient: mockApi });

    await waitFor(() => {
      expect(listMock).toHaveBeenCalled();
    });
    const [, pagination] = listMock.mock.calls[0] as [SyncJobFilters, SyncJobPagination];
    expect(pagination.limit).toBeLessThanOrEqual(SYNC_JOBS_MAX_LIMIT);
    expect(pagination.limit).toBe(SYNC_JOBS_MAX_LIMIT);
  });

  it('should resolve the connection name via ConnectionEntityLabel in the Connection column', async () => {
    const connection = makeConnection();
    const mockApi = createMockApiClient({
      syncJobs: { list: vi.fn().mockResolvedValue(sampleJobs) },
      connections: {
        list: vi.fn().mockResolvedValue([connection]),
        getById: vi.fn().mockResolvedValue(connection),
      },
    });

    renderWithProviders(<SyncJobsPage />, { apiClient: mockApi });

    expect(await screen.findByText('Allegro Europe')).toBeInTheDocument();
  });

  it('filters sync jobs by the selected connection when changing the dropdown', async () => {
    const user = userEvent.setup();
    const connection = makeConnection();
    const listMock = vi.fn().mockResolvedValue(sampleJobs);
    const mockApi = createMockApiClient({
      syncJobs: { list: listMock },
      connections: { list: vi.fn().mockResolvedValue([connection]) },
    });

    renderWithProviders(<SyncJobsPage />, { apiClient: mockApi });

    await screen.findByRole('option', { name: 'Allegro Europe' });
    await user.selectOptions(
      screen.getByRole('combobox', { name: /filter by connection/i }),
      connection.id,
    );

    await waitFor(() => {
      const lastCall = listMock.mock.calls.at(-1) as [SyncJobFilters, SyncJobPagination];
      expect(lastCall[0].connectionId).toBe(connection.id);
    });
  });
});

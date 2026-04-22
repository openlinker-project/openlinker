import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../test/test-utils';
import { SyncJobsPage } from './sync-jobs-page';
import type {
  PaginatedSyncJobs,
  SyncJobFilters,
  SyncJobPagination,
} from '../../features/sync-jobs/api/sync-jobs.types';
import { SYNC_JOBS_MAX_LIMIT } from '../../features/sync-jobs/api/sync-jobs.types';

const sampleJobs: PaginatedSyncJobs = {
  items: [
    {
      id: 'job_abc12345-1111-2222-3333-444444444444',
      jobType: 'marketplace.orders.poll',
      connectionId: 'conn_allegro_1',
      status: 'succeeded',
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
  it('should show loading state initially', () => {
    const mockApi = createMockApiClient({
      syncJobs: { list: vi.fn().mockReturnValue(new Promise(() => {})) },
    });

    renderWithProviders(<SyncJobsPage />, { apiClient: mockApi });

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('should show jobs table when data loads', async () => {
    const mockApi = createMockApiClient({
      syncJobs: { list: vi.fn().mockResolvedValue(sampleJobs) },
    });

    renderWithProviders(<SyncJobsPage />, { apiClient: mockApi });

    expect(await screen.findByText(/1 \/ 3/)).toBeInTheDocument();
    expect(screen.getAllByText('marketplace.orders.poll').length).toBeGreaterThan(1);
  });

  it('should show error state when fetch fails', async () => {
    const mockApi = createMockApiClient({
      syncJobs: { list: vi.fn().mockRejectedValue(new Error('Service unavailable')) },
    });

    renderWithProviders(<SyncJobsPage />, { apiClient: mockApi });

    expect(await screen.findByText('Unable to load sync jobs')).toBeInTheDocument();
    expect(screen.getByText('Service unavailable')).toBeInTheDocument();
  });

  it('should show empty state when no jobs exist', async () => {
    const mockApi = createMockApiClient({
      syncJobs: { list: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 }) },
    });

    renderWithProviders(<SyncJobsPage />, { apiClient: mockApi });

    expect(await screen.findByText('No jobs found')).toBeInTheDocument();
  });

  // Regression guard for #270: the backend rejects `limit > 100` with HTTP 400
  // ("limit must not be greater than 100"). The page previously requested 200
  // and broke every load.
  it('requests sync jobs with limit capped at SYNC_JOBS_MAX_LIMIT', async () => {
    const listMock = vi.fn().mockResolvedValue(sampleJobs);
    const mockApi = createMockApiClient({ syncJobs: { list: listMock } });

    renderWithProviders(<SyncJobsPage />, { apiClient: mockApi });

    await waitFor(() => {
      expect(listMock).toHaveBeenCalled();
    });
    const [, pagination] = listMock.mock.calls[0] as [SyncJobFilters, SyncJobPagination];
    expect(pagination.limit).toBeLessThanOrEqual(SYNC_JOBS_MAX_LIMIT);
    expect(pagination.limit).toBe(SYNC_JOBS_MAX_LIMIT);
  });
});

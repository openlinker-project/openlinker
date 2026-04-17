import { screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../test/test-utils';
import { FailedOrdersPage } from './failed-orders-page';
import type { PaginatedSyncJobs, SyncJob } from '../../features/sync-jobs/api/sync-jobs.types';

function makeSyncJob(overrides: Partial<SyncJob> = {}): SyncJob {
  return {
    id: 'aabbccdd-1111-2222-3333-444444444444',
    jobType: 'marketplace.order.sync',
    connectionId: 'conn-1111-2222-3333-444444444444',
    status: 'dead',
    attempts: 10,
    maxAttempts: 10,
    nextRunAt: '2026-04-10T10:00:00.000Z',
    lastError: 'MissingOrderItemMappingError: No product mapping found for offer abc123',
    payloadJson: { allegroOrderId: 'order-1' },
    idempotencyKey: 'key-1',
    lockedAt: null,
    lockedBy: null,
    createdAt: '2026-04-10T08:00:00.000Z',
    updatedAt: '2026-04-10T10:00:00.000Z',
    ...overrides,
  };
}

const sampleData: PaginatedSyncJobs = {
  items: [makeSyncJob()],
  total: 1,
  limit: 25,
  offset: 0,
};

describe('FailedOrdersPage', () => {
  it('should show loading state initially', () => {
    const mockApi = createMockApiClient({
      syncJobs: {
        list: vi.fn().mockReturnValue(new Promise(() => {})),
      },
      connections: {
        list: vi.fn().mockResolvedValue([]),
      },
    });

    renderWithProviders(<FailedOrdersPage />, { apiClient: mockApi });

    expect(screen.getByText('Loading failed orders')).toBeInTheDocument();
  });

  it('should show failed jobs table when data loads', async () => {
    const mockApi = createMockApiClient({
      syncJobs: {
        list: vi.fn().mockResolvedValue(sampleData),
      },
      connections: {
        list: vi.fn().mockResolvedValue([]),
      },
    });

    renderWithProviders(<FailedOrdersPage />, { apiClient: mockApi });

    expect(await screen.findByText('aabbccdd…')).toBeInTheDocument();
    expect(screen.getByText('10/10')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('should show error state when fetch fails', async () => {
    const mockApi = createMockApiClient({
      syncJobs: {
        list: vi.fn().mockRejectedValue(new Error('Network error')),
      },
      connections: {
        list: vi.fn().mockResolvedValue([]),
      },
    });

    renderWithProviders(<FailedOrdersPage />, { apiClient: mockApi });

    expect(await screen.findByText('Unable to load failed orders')).toBeInTheDocument();
  });

  it('should show empty state when no failed jobs', async () => {
    const mockApi = createMockApiClient({
      syncJobs: {
        list: vi.fn().mockResolvedValue({
          items: [],
          total: 0,
          limit: 25,
          offset: 0,
        }),
      },
      connections: {
        list: vi.fn().mockResolvedValue([]),
      },
    });

    renderWithProviders(<FailedOrdersPage />, { apiClient: mockApi });

    expect(await screen.findByText('No failed orders')).toBeInTheDocument();
  });

  it('should render retry button scoped to each job row', async () => {
    const mockApi = createMockApiClient({
      syncJobs: {
        list: vi.fn().mockResolvedValue(sampleData),
      },
      connections: {
        list: vi.fn().mockResolvedValue([]),
      },
    });

    renderWithProviders(<FailedOrdersPage />, { apiClient: mockApi });

    const jobIdLink = await screen.findByText('aabbccdd…');
    const row = jobIdLink.closest('tr')!;
    const retryButton = within(row).getByRole('button', { name: 'Retry' });

    expect(retryButton).toBeInTheDocument();
    expect(retryButton).not.toBeDisabled();
  });
});

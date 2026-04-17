import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../test/test-utils';
import { SyncJobDetailPage } from './sync-job-detail-page';
import type { SyncJob } from '../../features/sync-jobs/api/sync-jobs.types';

const sampleJob: SyncJob = {
  id: 'job_abc12345-1111-2222-3333-444444444444',
  jobType: 'marketplace.orders.poll',
  connectionId: 'conn_allegro_1',
  status: 'succeeded',
  attempts: 1,
  maxAttempts: 3,
  nextRunAt: '2026-01-15T10:05:00.000Z',
  lastError: null,
  payloadJson: null,
  idempotencyKey: 'idem_key_1',
  lockedAt: null,
  lockedBy: null,
  createdAt: '2026-01-15T10:00:00.000Z',
  updatedAt: '2026-01-15T10:01:00.000Z',
};

function renderDetailPage(apiClient: ReturnType<typeof createMockApiClient>): void {
  renderWithProviders(
    <Routes>
      <Route path="/sync-jobs/:id" element={<SyncJobDetailPage />} />
    </Routes>,
    { apiClient, route: '/sync-jobs/job_abc12345-1111-2222-3333-444444444444' },
  );
}

describe('SyncJobDetailPage', () => {
  it('should show loading state initially', () => {
    const mockApi = createMockApiClient({
      syncJobs: { getById: vi.fn().mockReturnValue(new Promise(() => {})) },
    });

    renderDetailPage(mockApi);

    expect(screen.getByText('Loading job')).toBeInTheDocument();
  });

  it('should show job detail when data loads', async () => {
    const mockApi = createMockApiClient({
      syncJobs: { getById: vi.fn().mockResolvedValue(sampleJob) },
    });

    renderDetailPage(mockApi);

    expect(await screen.findByText('marketplace.orders.poll')).toBeInTheDocument();
    expect(screen.getByText('conn_allegro_1')).toBeInTheDocument();
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(screen.getByText('idem_key_1')).toBeInTheDocument();
  });

  it('should show error state when fetch fails', async () => {
    const mockApi = createMockApiClient({
      syncJobs: { getById: vi.fn().mockRejectedValue(new Error('Not found')) },
    });

    renderDetailPage(mockApi);

    expect(await screen.findByText('Unable to load job')).toBeInTheDocument();
  });
});

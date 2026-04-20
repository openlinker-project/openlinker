import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, it, expect, vi } from 'vitest';
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
  afterEach(cleanup);

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

  it('surfaces a retry banner with the error preview when the job is dead', async () => {
    const deadJob: SyncJob = {
      ...sampleJob,
      status: 'dead',
      attempts: 3,
      lastError: 'insert or update on table inventory_items violates foreign key constraint',
    };
    const mockApi = createMockApiClient({
      syncJobs: { getById: vi.fn().mockResolvedValue(deadJob) },
    });

    renderDetailPage(mockApi);

    await screen.findByText('Job failed after 3 attempts');
    expect(screen.getAllByText(/foreign key constraint/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('invokes the retry mutation when the banner Retry button is clicked', async () => {
    const user = userEvent.setup();
    const retry = vi.fn().mockResolvedValue({ ...sampleJob, status: 'queued' });
    const mockApi = createMockApiClient({
      syncJobs: {
        getById: vi.fn().mockResolvedValue({
          ...sampleJob,
          status: 'dead',
          attempts: 3,
          lastError: 'timeout',
        }),
        retry,
      },
    });

    renderDetailPage(mockApi);

    await screen.findByText('Job failed after 3 attempts');
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(retry).toHaveBeenCalledWith(sampleJob.id);
  });

  it('does not show the retry banner for succeeded jobs', async () => {
    const mockApi = createMockApiClient({
      syncJobs: { getById: vi.fn().mockResolvedValue(sampleJob) },
    });

    renderDetailPage(mockApi);

    await screen.findByText('marketplace.orders.poll');
    expect(screen.queryByText(/Job failed/)).toBeNull();
  });
});

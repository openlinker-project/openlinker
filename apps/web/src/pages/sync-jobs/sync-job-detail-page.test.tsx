import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { renderWithProviders, createMockApiClient, createAuthenticatedSessionAdapter } from '../../test/test-utils';
import { SyncJobDetailPage } from './sync-job-detail-page';
import type { SyncJob } from '../../features/sync-jobs/api/sync-jobs.types';

const sampleJob: SyncJob = {
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
    {
      apiClient,
      route: '/sync-jobs/job_abc12345-1111-2222-3333-444444444444',
      sessionAdapter: createAuthenticatedSessionAdapter(),
    },
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

  describe('OfferCreationRecord panel for marketplace.offer.create jobs (#391)', () => {
    const offerCreateJob: SyncJob = {
      ...sampleJob,
      jobType: 'marketplace.offer.create',
      payloadJson: {
        connectionId: 'conn_allegro_1',
        internalVariantId: 'ol_variant_abc',
        offerCreationRecordId: 'rec-1',
      },
    };

    it('fetches and renders the linked OfferCreationRecord with status and validation errors when failed', async () => {
      const getOfferCreationStatus = vi.fn().mockResolvedValue({
        id: 'rec-1',
        connectionId: 'conn_allegro_1',
        internalVariantId: 'ol_variant_abc',
        externalOfferId: null,
        status: 'failed',
        errors: [
          { field: 'parameters.EAN', code: 'MISSING_EAN', message: 'EAN is required.' },
        ],
        publishImmediately: false,
        createdAt: '2026-04-25T10:00:00Z',
        updatedAt: '2026-04-25T10:01:00Z',
        request: null,
      });
      const mockApi = createMockApiClient({
        syncJobs: { getById: vi.fn().mockResolvedValue(offerCreateJob) },
        listings: { getOfferCreationStatus },
      });

      renderDetailPage(mockApi);

      // Status surfaces the failed badge and the structured error, not just the green job badge.
      expect(await screen.findByText('Failed')).toBeInTheDocument();
      // Field path renders as a breadcrumb copy-button (#486 design refresh).
      expect(
        screen.getByRole('button', { name: /Copy field path parameters\.EAN/i }),
      ).toBeInTheDocument();
      expect(screen.getByText('EAN is required.')).toBeInTheDocument();
      expect(getOfferCreationStatus).toHaveBeenCalledWith('conn_allegro_1', 'rec-1');
    });

    it('renders no panel when the payload omits offerCreationRecordId', async () => {
      const job: SyncJob = {
        ...offerCreateJob,
        payloadJson: { connectionId: 'conn_allegro_1', internalVariantId: 'ol_variant_abc' },
      };
      const getOfferCreationStatus = vi.fn();
      const mockApi = createMockApiClient({
        syncJobs: { getById: vi.fn().mockResolvedValue(job) },
        listings: { getOfferCreationStatus },
      });

      renderDetailPage(mockApi);

      await screen.findByText('marketplace.offer.create');
      expect(getOfferCreationStatus).not.toHaveBeenCalled();
      expect(screen.queryByText(/^Offer creation$/)).toBeNull();
    });

    it('renders no panel when payloadJson is null (orchestrator threw before record creation)', async () => {
      const job: SyncJob = { ...offerCreateJob, payloadJson: null };
      const getOfferCreationStatus = vi.fn();
      const mockApi = createMockApiClient({
        syncJobs: { getById: vi.fn().mockResolvedValue(job) },
        listings: { getOfferCreationStatus },
      });

      renderDetailPage(mockApi);

      await screen.findByText('marketplace.offer.create');
      expect(getOfferCreationStatus).not.toHaveBeenCalled();
      expect(screen.queryByText(/^Offer creation$/)).toBeNull();
    });

    it('renders no panel when offerCreationRecordId is present but not a string', async () => {
      const job: SyncJob = {
        ...offerCreateJob,
        // Defensive: a future schema drift or a corrupt payload could carry a non-string here.
        // The type-guard rejects it; the page must not crash and must not call the API.
        payloadJson: { ...offerCreateJob.payloadJson, offerCreationRecordId: 42 },
      };
      const getOfferCreationStatus = vi.fn();
      const mockApi = createMockApiClient({
        syncJobs: { getById: vi.fn().mockResolvedValue(job) },
        listings: { getOfferCreationStatus },
      });

      renderDetailPage(mockApi);

      await screen.findByText('marketplace.offer.create');
      expect(getOfferCreationStatus).not.toHaveBeenCalled();
      expect(screen.queryByText(/^Offer creation$/)).toBeNull();
    });

    it('renders no panel for non-marketplace.offer.create job types even when payload happens to carry the field', async () => {
      // Defensive: the type-guard is keyed on jobType. If a future job type accidentally
      // adds an offerCreationRecordId field to its payload, the panel must not appear.
      const job: SyncJob = {
        ...sampleJob,
        jobType: 'marketplace.orders.poll',
        payloadJson: { offerCreationRecordId: 'rec-1' },
      };
      const getOfferCreationStatus = vi.fn();
      const mockApi = createMockApiClient({
        syncJobs: { getById: vi.fn().mockResolvedValue(job) },
        listings: { getOfferCreationStatus },
      });

      renderDetailPage(mockApi);

      await screen.findByText('marketplace.orders.poll');
      expect(getOfferCreationStatus).not.toHaveBeenCalled();
    });
  });
});

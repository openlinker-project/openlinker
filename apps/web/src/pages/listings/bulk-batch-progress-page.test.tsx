import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../test/test-utils';
import { Routes, Route } from 'react-router-dom';
import { BulkBatchProgressPage } from './bulk-batch-progress-page';
import type { BulkBatchSummary } from '../../features/listings/api/bulk-listings.types';

const BATCH_ID = 'b1d05bc3-9a6e-4c8d-9ff0-12cd0acddc7a';

function makeBatch(overrides: Partial<BulkBatchSummary> = {}): BulkBatchSummary {
  return {
    id: BATCH_ID,
    connectionId: 'conn_1',
    status: 'running',
    totalCount: 5,
    succeededCount: 1,
    failedCount: 0,
    createdAt: '2026-05-18T15:00:00.000Z',
    updatedAt: '2026-05-18T15:01:00.000Z',
    records: [
      {
        id: 'rec_1',
        internalVariantId: 'ol_variant_111',
        status: 'pending',
        externalOfferId: null,
        createdAt: '2026-05-18T15:00:00.000Z',
        updatedAt: '2026-05-18T15:00:00.000Z',
        errors: null,
      },
      {
        id: 'rec_2',
        internalVariantId: 'ol_variant_222',
        status: 'active',
        externalOfferId: '99988877',
        createdAt: '2026-05-18T15:00:01.000Z',
        updatedAt: '2026-05-18T15:00:30.000Z',
        errors: null,
      },
    ],
    ...overrides,
  };
}

function renderPage(apiClient: ReturnType<typeof createMockApiClient>) {
  return renderWithProviders(
    <Routes>
      <Route path="/listings/bulk-batches/:batchId" element={<BulkBatchProgressPage />} />
    </Routes>,
    {
      apiClient,
      route: `/listings/bulk-batches/${BATCH_ID}`,
    },
  );
}

describe('BulkBatchProgressPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
  });
  afterEach(cleanup);

  it('renders KPI counts when batch loads', async () => {
    const apiClient = createMockApiClient({
      listings: {
        getBulkBatch: vi.fn().mockResolvedValue(makeBatch()),
      },
    });

    renderPage(apiClient);

    expect(await screen.findByText('Total')).toBeInTheDocument();
    // Total count "5"
    const totals = screen.getAllByText('5');
    expect(totals.length).toBeGreaterThan(0);
  });

  it('shows the partially-failed banner with Retry button when terminal with failures', async () => {
    const apiClient = createMockApiClient({
      listings: {
        getBulkBatch: vi.fn().mockResolvedValue(
          makeBatch({
            status: 'partially-failed',
            succeededCount: 3,
            failedCount: 2,
          }),
        ),
      },
    });

    renderPage(apiClient);

    expect(
      await screen.findByRole('button', { name: /Retry all failed/ }),
    ).toBeInTheDocument();
  });

  it('does not show the Retry banner when batch is still running', async () => {
    const apiClient = createMockApiClient({
      listings: {
        getBulkBatch: vi.fn().mockResolvedValue(makeBatch({ status: 'running' })),
      },
    });

    renderPage(apiClient);

    await screen.findByText('Total');
    expect(
      screen.queryByRole('button', { name: /Retry all failed/ }),
    ).not.toBeInTheDocument();
  });

  it('shows error state when the fetch fails', async () => {
    const apiClient = createMockApiClient({
      listings: {
        getBulkBatch: vi.fn().mockRejectedValue(new Error('Network is down')),
      },
    });

    renderPage(apiClient);

    expect(await screen.findByText('Could not load batch')).toBeInTheDocument();
    expect(screen.getByText('Network is down')).toBeInTheDocument();
  });

  it('renders one record row per record', async () => {
    const apiClient = createMockApiClient({
      listings: {
        getBulkBatch: vi.fn().mockResolvedValue(makeBatch()),
      },
    });

    renderPage(apiClient);

    expect(await screen.findByText('ol_variant_111')).toBeInTheDocument();
    expect(screen.getByText('ol_variant_222')).toBeInTheDocument();
  });

  it('clicking Retry calls the retry mutation', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const retryFn = vi.fn().mockResolvedValue({
      retriedRecordIds: ['rec_a'],
      retriedCount: 1,
      batchStatus: 'running',
    });
    const apiClient = createMockApiClient({
      listings: {
        getBulkBatch: vi.fn().mockResolvedValue(
          makeBatch({
            status: 'partially-failed',
            succeededCount: 3,
            failedCount: 2,
          }),
        ),
        retryBulkFailed: retryFn,
      },
    });

    renderPage(apiClient);

    const retryBtn = await screen.findByRole('button', {
      name: /Retry all failed/,
    });
    await user.click(retryBtn);

    expect(retryFn).toHaveBeenCalledWith(BATCH_ID);
  });
});

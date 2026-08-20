import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  renderWithProviders,
  createMockApiClient,
  createAuthenticatedSessionAdapter,
} from '../../test/test-utils';
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

function failedRecord(
  overrides: Partial<BulkBatchSummary['records'][number]> = {},
): BulkBatchSummary['records'][number] {
  return {
    id: 'rec_f',
    internalVariantId: 'ol_variant_333',
    status: 'failed',
    externalOfferId: null,
    createdAt: '2026-05-18T15:00:02.000Z',
    updatedAt: '2026-05-18T15:01:00.000Z',
    errors: [{ code: 'REJECTED', message: 'Produkt juz istnieje w Katalogu' }],
    productId: 'ol_product_aaa',
    ...overrides,
  };
}

function renderPage(
  apiClient: ReturnType<typeof createMockApiClient>,
  options: { authenticated?: boolean } = {},
) {
  const { authenticated = true } = options;
  return renderWithProviders(
    <Routes>
      <Route path="/listings/bulk-batches/:batchId" element={<BulkBatchProgressPage />} />
    </Routes>,
    {
      apiClient,
      route: `/listings/bulk-batches/${BATCH_ID}`,
      // The recovery actions are permission-gated (#2234), so the default
      // no-op (anonymous) adapter would hide them.
      ...(authenticated ? { sessionAdapter: createAuthenticatedSessionAdapter() } : {}),
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

  it('shows the recovery bar with both actions when terminal with failures', async () => {
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
      await screen.findByRole('button', { name: /Retry unchanged/ }),
    ).toBeInTheDocument();
  });

  it('does not show the recovery bar when batch is still running', async () => {
    const apiClient = createMockApiClient({
      listings: {
        getBulkBatch: vi.fn().mockResolvedValue(makeBatch({ status: 'running' })),
      },
    });

    renderPage(apiClient);

    await screen.findByText('Total');
    expect(
      screen.queryByRole('button', { name: /Retry unchanged/ }),
    ).not.toBeInTheDocument();
  });

  it('shows the recovery bar on a fully failed batch', async () => {
    const apiClient = createMockApiClient({
      listings: {
        getBulkBatch: vi.fn().mockResolvedValue(
          makeBatch({
            status: 'failed',
            totalCount: 1,
            succeededCount: 0,
            failedCount: 1,
            records: [failedRecord()],
          }),
        ),
      },
    });

    renderPage(apiClient);

    expect(
      await screen.findByText('1 variant failed. Nothing went live.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry unchanged \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Fix and resubmit \(1\)/ })).toBeInTheDocument();
  });

  it('links Fix and resubmit to the wizard with the failed products, variants and connection', async () => {
    const apiClient = createMockApiClient({
      listings: {
        getBulkBatch: vi.fn().mockResolvedValue(
          makeBatch({
            status: 'partially-failed',
            totalCount: 3,
            succeededCount: 2,
            failedCount: 1,
            records: [failedRecord()],
          }),
        ),
      },
    });

    renderPage(apiClient);

    const link = await screen.findByRole('link', { name: /Fix and resubmit \(1\) →/ });
    const href = link.getAttribute('href') ?? '';
    const query = new URLSearchParams(href.slice(href.indexOf('?')));
    expect(href.startsWith('/listings/bulk-create/wizard?')).toBe(true);
    expect(query.get('productIds')).toBe('ol_product_aaa');
    expect(query.get('variantIds')).toBe('ol_variant_333');
    expect(query.get('connectionId')).toBe('conn_1');
    expect(query.get('fromBatch')).toBe(BATCH_ID);
  });

  it('disables Fix and resubmit and states why when no record carries a product link', async () => {
    const apiClient = createMockApiClient({
      listings: {
        getBulkBatch: vi.fn().mockResolvedValue(
          makeBatch({
            status: 'failed',
            totalCount: 1,
            succeededCount: 0,
            failedCount: 1,
            records: [failedRecord({ productId: null })],
          }),
        ),
      },
    });

    renderPage(apiClient);

    expect(
      await screen.findByRole('button', { name: /Fix and resubmit/ }),
    ).toBeDisabled();
    expect(
      screen.getByText(/needs the product link, which this batch did not record/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry unchanged/ })).toBeEnabled();
  });

  it('hides the recovery bar for a session without listings:write', async () => {
    const apiClient = createMockApiClient({
      listings: {
        getBulkBatch: vi.fn().mockResolvedValue(
          makeBatch({
            status: 'failed',
            totalCount: 1,
            succeededCount: 0,
            failedCount: 1,
            records: [failedRecord()],
          }),
        ),
      },
    });

    renderPage(apiClient, { authenticated: false });

    await screen.findByText('Total');
    expect(screen.queryByRole('button', { name: /Retry unchanged/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Fix and resubmit/ })).not.toBeInTheDocument();
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
      name: /Retry unchanged/,
    });
    await user.click(retryBtn);

    expect(retryFn).toHaveBeenCalledWith(BATCH_ID);
  });
});

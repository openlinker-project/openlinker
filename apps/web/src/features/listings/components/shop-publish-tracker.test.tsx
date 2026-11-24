import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';
import type { BulkShopPublishBatchResponse } from '../api/listings.types';
import { ShopPublishTracker } from './shop-publish-tracker';

const batch = {
  id: 'b1',
  connectionId: 'c1',
  status: 'partially-failed',
  totalCount: 2,
  succeededCount: 1,
  failedCount: 1,
  records: [
    {
      id: 'r1',
      internalVariantId: 'v1',
      connectionId: 'c1',
      status: 'failed',
      externalProductId: null,
      bulkBatchId: 'b1',
      errors: [{ code: 'shopify_too_many_options', message: 'Product has more than 3 options.' }],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
} as unknown as BulkShopPublishBatchResponse;

const operator = createAuthenticatedSessionAdapter({
  id: 'u1',
  username: 'op',
  email: 'op@example.com',
  role: 'operator',
  permissions: ['listings:write'],
});

function renderTracker(retry = vi.fn().mockResolvedValue({ retriedRecordIds: ['r1'], retriedCount: 1, batchStatus: 'running' })) {
  const apiClient = createMockApiClient({
    listings: {
      getBulkShopPublishBatch: vi.fn().mockResolvedValue(batch),
      retryBulkShopPublishFailed: retry,
    },
    system: { getConfig: vi.fn().mockResolvedValue({ demoMode: false }) },
  });
  renderWithProviders(<ShopPublishTracker connectionId="c1" batchId="b1" />, {
    apiClient,
    sessionAdapter: operator,
  });
  return retry;
}

describe('ShopPublishTracker bulk', () => {
  afterEach(() => cleanup());

  it('should show the readable message for a failed row, with the code as secondary text', async () => {
    renderTracker();

    expect(await screen.findByText(/Product has more than 3 options\./)).toBeInTheDocument();
    expect(screen.getByText(/shopify_too_many_options/)).toBeInTheDocument();
  });

  it('should retry the failed children through the shop-publish endpoint', async () => {
    const retry = renderTracker();

    await userEvent.click(await screen.findByRole('button', { name: 'Retry failed' }));

    await waitFor(() => expect(retry).toHaveBeenCalledWith('b1'));
  });
});

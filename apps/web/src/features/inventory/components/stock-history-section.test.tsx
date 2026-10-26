import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuthenticatedSessionAdapter, createMockApiClient, renderWithProviders } from '../../../test/test-utils';

import { StockHistorySection } from './stock-history-section';

const SIGNED_IN = createAuthenticatedSessionAdapter();
const PACKER = createAuthenticatedSessionAdapter({
  id: 'user_p',
  username: 'packer',
  email: 'packer@example.com',
  role: 'packer',
  permissions: ['bench:write'],
});

const variants = [
  { id: 'v1', sku: 'KUB-BIA', attributes: { Kolor: 'biały' } },
  { id: 'v2', sku: 'KUB-GRA', attributes: { Kolor: 'granatowy' } },
];

describe('StockHistorySection', () => {
  afterEach(cleanup);

  it('should scope history to the chosen variant and link to the filtered global page', async () => {
    const listMovements = vi.fn().mockResolvedValue({ items: [], limit: 10, offset: 0 });
    const apiClient = createMockApiClient({ inventory: { listMovements } });
    renderWithProviders(<StockHistorySection productId="p1" productName="Kubek" variants={variants} />, { apiClient, sessionAdapter: SIGNED_IN });

    await waitFor(() =>
      expect(listMovements).toHaveBeenCalledWith(
        expect.objectContaining({ productVariantId: 'v1' }),
        { limit: 10, offset: 0 },
      ),
    );
    expect(screen.getByTestId('stock-history-view-all')).toHaveAttribute(
      'href',
      '/inventory/movements?productVariantId=v1',
    );
    await userEvent.selectOptions(screen.getByTestId('stock-history-variant'), 'v2');
    expect(screen.getByTestId('stock-history-view-all')).toHaveAttribute(
      'href',
      '/inventory/movements?productVariantId=v2',
    );
    expect(await screen.findByTestId('stock-history-empty')).toBeInTheDocument();
  });

  it('should show the newest movement time with its status from a dedicated query, even when refused', async () => {
    const refused = {
      kind: 'movement', id: 'm1', productId: 'p1', productVariantId: 'v1', sku: 'KUB-BIA', productName: 'Kubek',
      locationId: null, sourceConnectionId: null, reason: 'return_restock', status: 'refused', quantityDelta: 1,
      quantityBefore: 5, quantityAfter: null, sourceKind: 'return', sourceRef: 'r1', operatorReason: null, note: null,
      actorUserId: null, actorName: null, refusalReason: null, refusalDetail: 'no', occurredAt: '2026-09-26T08:41:00.000Z',
    };
    const listMovements = vi.fn().mockImplementation((filters: { kind?: string }) =>
      Promise.resolve({ items: filters.kind === 'movements' ? [refused] : [], limit: 1, offset: 0 }),
    );
    const apiClient = createMockApiClient({ inventory: { listMovements } });
    renderWithProviders(<StockHistorySection productId="p1" variants={variants} />, { apiClient, sessionAdapter: SIGNED_IN });

    expect(await screen.findByTestId('stock-history-last-change-status')).toHaveTextContent('Refused');
    expect(listMovements).toHaveBeenCalledWith(expect.objectContaining({ kind: 'movements' }), { limit: 1, offset: 0 });
  });

  it('should say the history is not available, and send no read, for a role without inventory:read', async () => {
    const listMovements = vi.fn();
    const apiClient = createMockApiClient({ inventory: { listMovements } });
    renderWithProviders(<StockHistorySection productId="p1" variants={variants} />, {
      apiClient,
      sessionAdapter: PACKER,
    });

    expect(await screen.findByTestId('stock-history-restricted')).toBeInTheDocument();
    expect(listMovements).not.toHaveBeenCalled();
  });
});

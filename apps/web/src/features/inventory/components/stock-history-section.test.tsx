import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { StockHistorySection } from './stock-history-section';

const variants = [
  { id: 'v1', sku: 'KUB-BIA', attributes: { Kolor: 'biały' } },
  { id: 'v2', sku: 'KUB-GRA', attributes: { Kolor: 'granatowy' } },
];

describe('StockHistorySection', () => {
  afterEach(cleanup);

  it('should scope history to the chosen variant and link to the filtered global page', async () => {
    const listMovements = vi.fn().mockResolvedValue({ items: [], limit: 10, offset: 0 });
    const apiClient = createMockApiClient({ inventory: { listMovements } });
    renderWithProviders(<StockHistorySection productId="p1" productName="Kubek" variants={variants} />, { apiClient });

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
});

import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductsListPage } from './products-list-page';
import { createMockApiClient, renderWithProviders } from '../../test/test-utils';
import { costCoverage, costSummary } from '../../test/cost-test-fixtures';

beforeEach(() => {
  window.sessionStorage.clear();
});
afterEach(cleanup);

function renderList(trackMargin: boolean): { getSettings: ReturnType<typeof vi.fn> } {
  const getSettings = vi.fn().mockResolvedValue({
    displayCurrency: 'PLN',
    displayCurrencySource: 'default',
    rateBasis: 'current',
    includeBackfilledTaxRatesInNetSales: false,
    netGrossBasis: 'gross',
    trackMargin,
    updatedAt: null,
    updatedByUserId: null,
  });
  renderWithProviders(<ProductsListPage />, {
    apiClient: createMockApiClient({
      products: {
        getCostCoverage: vi.fn().mockResolvedValue(costCoverage()),
        getCostSummary: vi.fn().mockResolvedValue(costSummary()),
      },
      analyticsSettings: { getSettings },
    }),
  });
  return { getSettings };
}

describe('ProductsListPage cost reminders (#3588, #4027)', () => {
  it('should offer Cost prices and a "no cost price" group that links to the work list', async () => {
    const user = userEvent.setup();
    renderList(true);
    expect(screen.getByTestId('products-open-cost-prices')).toHaveAttribute(
      'href',
      '/products/cost-prices'
    );
    // The cost banner's sentence and link live in Needs a look now.
    const group = await screen.findByRole('button', { name: /9\s*no cost price/ });
    await user.click(group);
    expect(await screen.findByText(/9 variants you sold in the last 30 days have no cost price/)).toBeInTheDocument();
    expect(screen.getByTestId('products-attention-cost-link')).toHaveAttribute(
      'href',
      '/products/cost-prices?tab=all'
    );
  });

  it('should leave the cost group out but keep the Cost prices action when margin tracking is off', async () => {
    const { getSettings } = renderList(false);
    await screen.findByTestId('products-open-cost-prices');
    // Positive signal first: the settings read was made and React re-rendered.
    await waitFor(() => {
      expect(getSettings).toHaveBeenCalled();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByRole('button', { name: /no cost price/ })).not.toBeInTheDocument();
  });
});

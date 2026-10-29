import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductsListPage } from './products-list-page';
import { createMockApiClient, renderWithProviders } from '../../test/test-utils';
import { costCoverage, costSummary } from '../../test/cost-test-fixtures';

beforeEach(() => {
  window.sessionStorage.clear();
});
afterEach(cleanup);

function renderList(trackMargin: boolean): void {
  renderWithProviders(<ProductsListPage />, {
    apiClient: createMockApiClient({
      products: {
        getCostCoverage: vi.fn().mockResolvedValue(costCoverage()),
        getCostSummary: vi.fn().mockResolvedValue(costSummary()),
      },
      analyticsSettings: {
        getSettings: vi.fn().mockResolvedValue({
          displayCurrency: 'PLN',
          displayCurrencySource: 'default',
          rateBasis: 'current',
          includeBackfilledTaxRatesInNetSales: false,
          netGrossBasis: 'gross',
          trackMargin,
          updatedAt: null,
          updatedByUserId: null,
        }),
      },
    }),
  });
}

describe('ProductsListPage cost reminders (#3588)', () => {
  it('should offer Cost prices, the banner and the No cost price chip', async () => {
    renderList(true);
    expect(await screen.findByTestId('cost-coverage-banner')).toBeInTheDocument();
    expect(screen.getByTestId('products-open-cost-prices')).toHaveAttribute(
      'href',
      '/products/cost-prices'
    );
    const chip = await screen.findByTestId('products-filter-no-cost');
    expect(chip).toHaveTextContent('146');
    expect(chip).toHaveAttribute('href', '/products/cost-prices?tab=all');
  });

  it('should hide the banner and the chip but keep the Cost prices action when margin tracking is off', async () => {
    renderList(false);
    await screen.findByTestId('products-open-cost-prices');
    await waitFor(() => {
      expect(screen.queryByTestId('cost-coverage-banner')).not.toBeInTheDocument();
      expect(screen.queryByTestId('products-filter-no-cost')).not.toBeInTheDocument();
    });
  });
});

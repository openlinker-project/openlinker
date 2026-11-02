import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CostCoverageBanner } from './cost-coverage-banner';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { costCoverage } from '../../../test/cost-test-fixtures';

beforeEach(() => {
  window.sessionStorage.clear();
});
afterEach(cleanup);

function renderBanner(soldVariantsWithoutCost: number): void {
  renderWithProviders(<CostCoverageBanner />, {
    apiClient: createMockApiClient({
      products: {
        getCostCoverage: vi.fn().mockResolvedValue(costCoverage({ soldVariantsWithoutCost })),
      },
    }),
  });
}

describe('CostCoverageBanner', () => {
  it('should show how many sold variants have no cost when there are some', async () => {
    renderBanner(9);
    expect(await screen.findByTestId('cost-coverage-banner')).toHaveTextContent(
      '9 variants you sold in the last 30 days have no cost price'
    );
    expect(screen.getByTestId('cost-coverage-banner-open')).toHaveAttribute(
      'href',
      '/products/cost-prices'
    );
  });

  it('should render nothing when every sold variant has a cost', async () => {
    renderBanner(0);
    await waitFor(() => {
      expect(screen.queryByTestId('cost-coverage-banner')).not.toBeInTheDocument();
    });
  });

  it('should hide for the session when dismissed', async () => {
    renderBanner(9);
    await userEvent.click(await screen.findByTestId('cost-coverage-banner-dismiss'));
    expect(screen.queryByTestId('cost-coverage-banner')).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem('ol.cost-coverage-banner.dismissed')).toBe('1');
  });

  it('should stay hidden on the next mount in the same session', async () => {
    window.sessionStorage.setItem('ol.cost-coverage-banner.dismissed', '1');
    renderBanner(9);
    await waitFor(() => {
      expect(screen.queryByTestId('cost-coverage-banner')).not.toBeInTheDocument();
    });
  });
});

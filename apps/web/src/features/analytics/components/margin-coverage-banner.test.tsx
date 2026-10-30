import { act, cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarginCoverageBanner } from './margin-coverage-banner';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { MarginAnalytics } from '../api/margin-analytics.types';

afterEach(cleanup);

function margin(costCoveragePct: number | null): MarginAnalytics {
  return {
    currency: 'PLN',
    bucket: 'week',
    headline: {
      netRevenue: 85630,
      coveredNetRevenue: 75740,
      costOfGoods: 44000,
      grossMargin: 31740,
      marginPct: 0.419,
      costCoveragePct,
      gaps: [
        { reason: 'no-cost', lineCount: 12, netAmount: 7750 },
        { reason: 'cost-entered-after-sale', lineCount: 4, netAmount: 2140 },
      ],
    },
    trend: [],
    channels: [],
    excludedLineCount: 16,
  };
}

interface Reads {
  getSettings: ReturnType<typeof vi.fn>;
  getMargin: ReturnType<typeof vi.fn>;
}

function renderBanner(pct: number | null, trackMargin = true): Reads {
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
  const getMargin = vi.fn().mockResolvedValue(margin(pct));
  renderWithProviders(<MarginCoverageBanner filters={{ from: '2026-09-01', to: '2026-09-30' }} />, {
    apiClient: createMockApiClient({
      analytics: { getMargin },
      analyticsSettings: { getSettings },
    }),
  });
  return { getSettings, getMargin };
}

/** Both reads were made and React has re-rendered with their answers. */
async function settled(reads: Reads): Promise<void> {
  await waitFor(() => {
    expect(reads.getSettings).toHaveBeenCalled();
    expect(reads.getMargin).toHaveBeenCalled();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('MarginCoverageBanner', () => {
  it('should split the gap into no cost and ordered before the cost was entered when coverage is below 98%', async () => {
    renderBanner(0.884);
    const banner = await screen.findByTestId('cost-coverage-banner');
    expect(banner).toHaveTextContent('Margin covers 88.4% of net sales in this range');
    expect(banner).toHaveTextContent('some variants have no cost price');
    expect(banner).toHaveTextContent('some orders came in before their cost was entered');
    expect(screen.getByTestId('cost-coverage-banner-open')).toHaveAttribute(
      'href',
      '/products/cost-prices'
    );
  });

  it('should render nothing when coverage is at or above 98%', async () => {
    await settled(renderBanner(0.98));
    expect(screen.queryByTestId('cost-coverage-banner')).not.toBeInTheDocument();
  });

  it('should render nothing when there is no net revenue to cover', async () => {
    await settled(renderBanner(null));
    expect(screen.queryByTestId('cost-coverage-banner')).not.toBeInTheDocument();
  });

  it('should render nothing when margin tracking is off', async () => {
    await settled(renderBanner(0.5, false));
    expect(screen.queryByTestId('cost-coverage-banner')).not.toBeInTheDocument();
  });
});

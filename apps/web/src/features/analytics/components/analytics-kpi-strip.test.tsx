import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { SalesAndChannelAnalytics } from '../api/sales-analytics.types';
import { AnalyticsKpiStrip } from './analytics-kpi-strip';

const FILTERS = { from: '2026-08-01', to: '2026-08-14' };

function analytics(overrides: Partial<SalesAndChannelAnalytics['headline']> = {}): SalesAndChannelAnalytics {
  return {
    headline: {
      revenue: 4800,
      currency: 'PLN',
      orderCount: 40,
      averageOrderValue: 120,
      medianOrderValue: 100,
      unitsSold: 60,
      cancelledCount: 2,
      cancelledValue: 200,
      unconvertedCount: 0,
      unconvertedValue: 0,
      unconvertedCurrency: null,
      trend: [],
      ...overrides,
    },
    channels: [],
  };
}

describe('AnalyticsKpiStrip', () => {
  it('should show a loading state before the query resolves', () => {
    const apiClient = createMockApiClient({
      analytics: { getSales: vi.fn(() => new Promise<SalesAndChannelAnalytics>(() => {})) },
    });

    renderWithProviders(<AnalyticsKpiStrip filters={FILTERS} />, { apiClient });

    expect(screen.getByText('Loading sales figures')).toBeInTheDocument();
  });

  it('should show an error state with a retry action when the request fails', async () => {
    const apiClient = createMockApiClient({
      analytics: { getSales: vi.fn().mockRejectedValue(new Error('boom')) },
    });

    renderWithProviders(<AnalyticsKpiStrip filters={FILTERS} />, { apiClient });

    expect(await screen.findByText('Unable to load sales figures')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('should render orders, order value and units in the reporting currency', async () => {
    const apiClient = createMockApiClient({
      analytics: { getSales: vi.fn().mockResolvedValue(analytics()) },
    });

    renderWithProviders(<AnalyticsKpiStrip filters={FILTERS} />, { apiClient });

    expect(await screen.findByText('40')).toBeInTheDocument();
    expect(screen.getByText('PLN 120.00')).toBeInTheDocument();
    expect(screen.getByText('PLN 100.00')).toBeInTheDocument();
    expect(screen.getByText('60')).toBeInTheDocument();
    expect(screen.getByText('PLN 200.00')).toBeInTheDocument();
  });

  it('should label the sparklines with the actual selected range, not a hardcoded "last 7 days"', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getSales: vi.fn().mockResolvedValue(
          analytics({
            trend: [
              { date: '2026-08-01', revenue: 100, orderCount: 1 },
              { date: '2026-08-02', revenue: 200, orderCount: 2 },
            ],
          })
        ),
      },
    });

    renderWithProviders(<AnalyticsKpiStrip filters={FILTERS} />, { apiClient });

    // FILTERS spans 2026-08-01..2026-08-14 inclusive — 14 days, not 7.
    expect(await screen.findByLabelText('GMV trend, the last 14 days')).toBeInTheDocument();
    expect(screen.getByLabelText('Order count trend, the last 14 days')).toBeInTheDocument();
  });

  it('should render the cancellation rate, not the cancelled value, as the Cancellations headline', async () => {
    const apiClient = createMockApiClient({
      analytics: { getSales: vi.fn().mockResolvedValue(analytics()) },
    });

    renderWithProviders(<AnalyticsKpiStrip filters={FILTERS} />, { apiClient });

    // cancelledCount=2, totalOrders=40 (orderCount) + 0 (unconverted) → 2 / (40 + 2) = 4.8%
    expect(await screen.findByText('4.8%')).toBeInTheDocument();
    expect(screen.getByText('PLN 200.00')).toBeInTheDocument();
  });

  it('should disclose the FX-stamp gap when some placed orders have no stamp yet', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getSales: vi.fn().mockResolvedValue(analytics({ orderCount: 35, unconvertedCount: 5 })),
      },
    });

    renderWithProviders(<AnalyticsKpiStrip filters={FILTERS} />, { apiClient });

    expect(
      await screen.findAllByTitle(
        'Order value is computed only from orders an FX rate has been stamped onto — recently ingested, not-yet-stamped orders are excluded from this figure until the FX stamp sweep reaches them.'
      )
    ).not.toHaveLength(0);
    // Orders headline counts every placed order: 35 stamped + 5 unconverted = 40.
    expect(screen.getByText('40')).toBeInTheDocument();
  });

  it('should fall back to a bare number when nothing in range has been FX-stamped yet', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getSales: vi.fn().mockResolvedValue(
          analytics({
            revenue: 0,
            currency: null,
            orderCount: 0,
            averageOrderValue: 0,
            medianOrderValue: 17.5,
            unconvertedCount: 3,
            unconvertedValue: 450,
            unconvertedCurrency: 'EUR',
          })
        ),
      },
    });

    renderWithProviders(<AnalyticsKpiStrip filters={FILTERS} />, { apiClient });

    expect((await screen.findAllByText('0.00')).length).toBeGreaterThan(0);
    expect(screen.getByText('17.50')).toBeInTheDocument();
  });

  it('should render Revenue headline as unavailable and Returns & refunds as planned', async () => {
    const apiClient = createMockApiClient({
      analytics: { getSales: vi.fn().mockResolvedValue(analytics()) },
    });

    renderWithProviders(<AnalyticsKpiStrip filters={FILTERS} />, { apiClient });

    expect(
      await screen.findByLabelText('Not computable until refunds are captured')
    ).toBeInTheDocument();
    expect(screen.getByLabelText('No return/refund entity exists yet')).toBeInTheDocument();
  });
});

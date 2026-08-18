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
      reportingCurrency: 'PLN',
      orderCount: 40,
      stampedOrderCount: 40,
      averageOrderValue: 120,
      medianOrderValue: 100,
      unitsSold: 60,
      cancelledCount: 2,
      cancelledValue: 200,
      taxTreatmentMixed: false,
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

  it('should disclose the stamped/placed order gap when not every order is FX-stamped', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getSales: vi.fn().mockResolvedValue(analytics({ orderCount: 40, stampedOrderCount: 35 })),
      },
    });

    renderWithProviders(<AnalyticsKpiStrip filters={FILTERS} />, { apiClient });

    expect(
      await screen.findAllByTitle(
        'Order value is computed only from orders an FX rate has been stamped onto — recently ingested, not-yet-stamped orders are excluded from this figure until the FX stamp sweep reaches them.'
      )
    ).not.toHaveLength(0);
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

import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { ConnectionIngestionTrust } from '../api/analytics-trust.types';
import type { SalesAndChannelAnalytics, SalesAnalyticsFilters } from '../api/sales-analytics.types';
import { AnalyticsKpiStrip } from './analytics-kpi-strip';

const FILTERS = { from: '2026-08-01', to: '2026-08-14' };

function connectionWithEarliestOrder(earliestOrderDate: string | null): ConnectionIngestionTrust {
  return {
    connectionId: 'conn-1',
    connectionName: 'Allegro — main',
    platformType: 'allegro',
    connectionStatus: 'active',
    status: 'fresh',
    lastPollAt: null,
    lastOrderIngestedAt: null,
    connectionCreatedAt: '2020-01-01T00:00:00.000Z',
    earliestOrderDate,
    expectedIntervalMs: null,
    staleAfterMs: null,
  };
}

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
      netRevenue: 4200,
      netAverageOrderValue: 105,
      netMedianOrderValue: 90,
      netExcludedCount: 0,
      netExcludedValue: 0,
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

    renderWithProviders(<AnalyticsKpiStrip filters={FILTERS} connections={[]} />, { apiClient });

    expect(screen.getByText('Loading sales figures')).toBeInTheDocument();
  });

  it('should show an error state with a retry action when the request fails', async () => {
    const apiClient = createMockApiClient({
      analytics: { getSales: vi.fn().mockRejectedValue(new Error('boom')) },
    });

    renderWithProviders(<AnalyticsKpiStrip filters={FILTERS} connections={[]} />, { apiClient });

    expect(await screen.findByText('Unable to load sales figures')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('should render orders, order value and units in the reporting currency', async () => {
    const apiClient = createMockApiClient({
      analytics: { getSales: vi.fn().mockResolvedValue(analytics()) },
    });

    renderWithProviders(<AnalyticsKpiStrip filters={FILTERS} connections={[]} />, { apiClient });

    expect(await screen.findByText('40')).toBeInTheDocument();
    expect(screen.getByText('PLN 105.00')).toBeInTheDocument();
    expect(screen.getByText('PLN 90.00')).toBeInTheDocument();
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

    renderWithProviders(<AnalyticsKpiStrip filters={FILTERS} connections={[]} />, { apiClient });

    // FILTERS spans 2026-08-01..2026-08-14 inclusive — 14 days, not 7.
    expect(await screen.findByLabelText('GMV trend, the last 14 days')).toBeInTheDocument();
    expect(screen.getByLabelText('Order count trend, the last 14 days')).toBeInTheDocument();
  });

  it('should render the cancellation rate, not the cancelled value, as the Cancellations headline', async () => {
    const apiClient = createMockApiClient({
      analytics: { getSales: vi.fn().mockResolvedValue(analytics()) },
    });

    renderWithProviders(<AnalyticsKpiStrip filters={FILTERS} connections={[]} />, { apiClient });

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

    renderWithProviders(<AnalyticsKpiStrip filters={FILTERS} connections={[]} />, { apiClient });

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
            netAverageOrderValue: 0,
            netMedianOrderValue: 17.5,
            unconvertedCount: 3,
            unconvertedValue: 450,
            unconvertedCurrency: 'EUR',
          })
        ),
      },
    });

    renderWithProviders(<AnalyticsKpiStrip filters={FILTERS} connections={[]} />, { apiClient });

    expect((await screen.findAllByText('0.00')).length).toBeGreaterThan(0);
    expect(screen.getByText('17.50')).toBeInTheDocument();
  });

  it('renders the real net-sales headline (net-sales tax-rate epic) and keeps Returns & refunds planned', async () => {
    const apiClient = createMockApiClient({
      analytics: { getSales: vi.fn().mockResolvedValue(analytics()) },
    });

    renderWithProviders(<AnalyticsKpiStrip filters={FILTERS} connections={[]} />, { apiClient });

    expect(await screen.findByText('Net sales')).toBeInTheDocument();
    expect(screen.getByLabelText('No return/refund entity exists yet')).toBeInTheDocument();
  });

  it('renders a period-over-period delta on the Orders card when the previous period is fully covered by history', async () => {
    const getSales = vi.fn((filters: SalesAnalyticsFilters) =>
      Promise.resolve(
        filters.from === FILTERS.from
          ? analytics({ orderCount: 40, unconvertedCount: 0 })
          : analytics({ orderCount: 20, unconvertedCount: 0 })
      )
    );
    const apiClient = createMockApiClient({ analytics: { getSales } });

    renderWithProviders(
      <AnalyticsKpiStrip
        filters={FILTERS}
        connections={[connectionWithEarliestOrder('2020-01-01T00:00:00.000Z')]}
      />,
      { apiClient }
    );

    // current totalOrders=40, previous totalOrders=20 → (40-20)/20*100 = 100.0%
    // (a count delta is relative "%", never "pp" — that's reserved for
    // rate deltas like Cancellation rate).
    expect(await screen.findByText('100.0%')).toBeInTheDocument();
    // Every card with a delta shares the same basis label — assert at least one renders it.
    expect(screen.getAllByText(/vs previous 14 days/).length).toBeGreaterThan(0);
    expect(getSales).toHaveBeenCalledTimes(2);
  });

  it('shows a not-enough-history GapMark instead of a delta when the previous period predates the earliest order', async () => {
    const apiClient = createMockApiClient({
      analytics: { getSales: vi.fn().mockResolvedValue(analytics({ orderCount: 40 })) },
    });

    // Earliest order is inside the naive previous-period window (2026-07-25),
    // so the previous period is only partially covered — delta must refuse.
    renderWithProviders(
      <AnalyticsKpiStrip
        filters={FILTERS}
        connections={[connectionWithEarliestOrder('2026-08-10T00:00:00.000Z')]}
      />,
      { apiClient }
    );

    await screen.findByText('40');
    expect(screen.queryByText(/pp$/)).not.toBeInTheDocument();
    expect(
      screen.getAllByTitle(/Not enough order history to compare a full previous period/).length
    ).toBeGreaterThan(0);
  });

  it('shows a no-history GapMark when no connection has ever ingested an order', async () => {
    const apiClient = createMockApiClient({
      analytics: { getSales: vi.fn().mockResolvedValue(analytics({ orderCount: 40 })) },
    });

    renderWithProviders(
      <AnalyticsKpiStrip filters={FILTERS} connections={[connectionWithEarliestOrder(null)]} />,
      { apiClient }
    );

    await screen.findByText('40');
    expect(
      screen.getAllByTitle('No order history yet — nothing to compare against.').length
    ).toBeGreaterThan(0);
  });
});

import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../test/test-utils';
import { AnalyticsPage } from './analytics-page';
import type { AnalyticsTrustSnapshot } from '../../features/analytics';

const ROUTE = '/analytics?from=2026-07-16&to=2026-08-14';

function snapshot(overrides: Partial<AnalyticsTrustSnapshot> = {}): AnalyticsTrustSnapshot {
  return {
    generatedAt: '2026-08-14T14:32:00.000Z',
    worstStatus: 'fresh',
    connections: [],
    ...overrides,
  };
}

describe('AnalyticsPage', () => {
  it('should show the loading state before the trust snapshot resolves', () => {
    const apiClient = createMockApiClient({
      analyticsTrust: {
        getTrust: vi.fn(() => new Promise<AnalyticsTrustSnapshot>(() => {})),
      },
    });

    renderWithProviders(<AnalyticsPage />, { apiClient, route: ROUTE });

    expect(screen.getByText('Loading data coverage')).toBeInTheDocument();
  });

  it('should show the empty-instance state when there are no OrderSource connections', async () => {
    const apiClient = createMockApiClient({
      analyticsTrust: { getTrust: vi.fn().mockResolvedValue(snapshot({ connections: [] })) },
    });

    renderWithProviders(<AnalyticsPage />, { apiClient, route: ROUTE });

    expect(
      await screen.findByText('Connect a sales channel to see figures here'),
    ).toBeInTheDocument();
  });

  it('should show the "still arriving" card when every connection is never-ingested', async () => {
    const apiClient = createMockApiClient({
      analyticsTrust: {
        getTrust: vi.fn().mockResolvedValue(
          snapshot({
            worstStatus: 'never-ingested',
            connections: [
              {
                connectionId: 'conn-1',
                connectionName: 'Erli',
                platformType: 'erli',
                connectionStatus: 'active',
                status: 'never-ingested',
                lastPollAt: null,
                lastOrderIngestedAt: null,
                connectionCreatedAt: '2026-08-14T14:12:00.000Z',
                earliestOrderDate: null,
                expectedIntervalMs: null,
                staleAfterMs: null,
              },
            ],
          }),
        ),
      },
    });

    renderWithProviders(<AnalyticsPage />, { apiClient, route: ROUTE });

    expect(await screen.findByText('First orders are still arriving')).toBeInTheDocument();
    expect(screen.getByText('Erli')).toBeInTheDocument();
  });

  it('should render the trust header for a populated, healthy instance', async () => {
    const apiClient = createMockApiClient({
      analyticsTrust: {
        getTrust: vi.fn().mockResolvedValue(
          snapshot({
            connections: [
              {
                connectionId: 'conn-1',
                connectionName: 'Allegro — main',
                platformType: 'allegro',
                connectionStatus: 'active',
                status: 'fresh',
                lastPollAt: '2026-08-14T14:32:00.000Z',
                lastOrderIngestedAt: '2026-08-14T12:00:00.000Z',
                connectionCreatedAt: '2026-01-01T00:00:00.000Z',
                earliestOrderDate: '2026-01-05T00:00:00.000Z',
                expectedIntervalMs: 300000,
                staleAfterMs: 900000,
              },
            ],
          }),
        ),
      },
    });

    renderWithProviders(<AnalyticsPage />, { apiClient, route: ROUTE });

    expect(await screen.findByText('Allegro — main')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('should render the degradation banner for a stalled connection', async () => {
    const apiClient = createMockApiClient({
      analyticsTrust: {
        getTrust: vi.fn().mockResolvedValue(
          snapshot({
            worstStatus: 'stalled',
            connections: [
              {
                connectionId: 'conn-1',
                connectionName: 'Allegro — main',
                platformType: 'allegro',
                connectionStatus: 'active',
                status: 'stalled',
                lastPollAt: '2026-08-03T14:02:00.000Z',
                lastOrderIngestedAt: '2026-08-03T14:02:00.000Z',
                connectionCreatedAt: '2026-01-01T00:00:00.000Z',
                earliestOrderDate: '2026-01-05T00:00:00.000Z',
                expectedIntervalMs: 300000,
                staleAfterMs: 900000,
              },
            ],
          }),
        ),
      },
    });

    renderWithProviders(<AnalyticsPage />, { apiClient, route: ROUTE });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('should show an error state with a retry action when the request fails', async () => {
    const apiClient = createMockApiClient({
      analyticsTrust: {
        getTrust: vi.fn().mockRejectedValue(new Error('Network error')),
      },
    });

    renderWithProviders(<AnalyticsPage />, { apiClient, route: ROUTE });

    expect(await screen.findByText('Unable to load data coverage')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  function healthySnapshot(): AnalyticsTrustSnapshot {
    return snapshot({
      connections: [
        {
          connectionId: 'conn-1',
          connectionName: 'Allegro — main',
          platformType: 'allegro',
          connectionStatus: 'active',
          status: 'fresh',
          lastPollAt: '2026-08-14T14:32:00.000Z',
          lastOrderIngestedAt: '2026-08-14T12:00:00.000Z',
          connectionCreatedAt: '2026-01-01T00:00:00.000Z',
          earliestOrderDate: '2026-01-05T00:00:00.000Z',
          expectedIntervalMs: 300000,
          staleAfterMs: 900000,
        },
      ],
    });
  }

  it('should render the KPI strip and by-channel table once trust data loads with real ingestion', async () => {
    const apiClient = createMockApiClient({
      analyticsTrust: { getTrust: vi.fn().mockResolvedValue(healthySnapshot()) },
      analytics: {
        getSales: vi.fn().mockResolvedValue({
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
            netRevenue: 4300,
            netAverageOrderValue: 107.5,
            netMedianOrderValue: 90,
            netExcludedCount: 0,
            netExcludedValue: 0,
            trend: [],
          },
          channels: [],
        }),
      },
    });

    renderWithProviders(<AnalyticsPage />, { apiClient, route: ROUTE });

    expect(await screen.findByRole('region', { name: 'Key sales figures' })).toBeInTheDocument();
    expect(screen.getByText('Sales by channel')).toBeInTheDocument();
    expect(screen.getByText('Top products')).toBeInTheDocument();
  });

  it('should label the currency picker with the true reporting currency from the sales headline, never the operator-saved display-currency default', async () => {
    // Regression guard: `AnalyticsSettingsView.displayCurrency` (mocked here
    // as 'EUR' by `createMockApiClient`'s default) is a saved *view*
    // preference, a different axis from the actual stamped reporting
    // currency the sales headline reports ('PLN'). Conflating the two once
    // made the toolbar/dialog show 'EUR' as the "native" currency the
    // moment an admin had a non-default preference saved.
    const apiClient = createMockApiClient({
      analyticsTrust: { getTrust: vi.fn().mockResolvedValue(healthySnapshot()) },
      analytics: {
        getSales: vi.fn().mockResolvedValue({
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
            netRevenue: 4300,
            netAverageOrderValue: 107.5,
            netMedianOrderValue: 90,
            netExcludedCount: 0,
            netExcludedValue: 0,
            trend: [],
          },
          channels: [],
        }),
      },
      analyticsSettings: {
        getSettings: vi.fn().mockResolvedValue({
          displayCurrency: 'EUR',
          displayCurrencySource: 'setting',
          rateBasis: 'current',
          includeBackfilledTaxRatesInNetSales: false,
          updatedAt: null,
          updatedByUserId: null,
        }),
      },
    });

    renderWithProviders(<AnalyticsPage />, { apiClient, route: ROUTE });

    expect(await screen.findByText('Current rate · PLN')).toBeInTheDocument();
    expect(screen.queryByText('Current rate · EUR')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Display currency' })).toHaveValue('');
  });

  it('should render each section its own error state, never a blank page, when the sales request fails', async () => {
    const apiClient = createMockApiClient({
      analyticsTrust: { getTrust: vi.fn().mockResolvedValue(healthySnapshot()) },
      analytics: {
        getSales: vi.fn().mockRejectedValue(new Error('sales endpoint down')),
      },
    });

    renderWithProviders(<AnalyticsPage />, { apiClient, route: ROUTE });

    expect(await screen.findByText('Unable to load sales figures')).toBeInTheDocument();
    expect(screen.getByText('Unable to load by-channel figures')).toBeInTheDocument();
  });

  it('should keep the trust header rendered when only the needs-attention fetch fails (#1989)', async () => {
    const apiClient = createMockApiClient({
      analyticsTrust: {
        getTrust: vi.fn().mockResolvedValue(
          snapshot({
            connections: [
              {
                connectionId: 'conn-1',
                connectionName: 'Allegro — main',
                platformType: 'allegro',
                connectionStatus: 'active',
                status: 'fresh',
                lastPollAt: '2026-08-14T14:32:00.000Z',
                lastOrderIngestedAt: '2026-08-14T12:00:00.000Z',
                connectionCreatedAt: '2026-01-01T00:00:00.000Z',
                earliestOrderDate: '2026-01-05T00:00:00.000Z',
                expectedIntervalMs: 300000,
                staleAfterMs: 900000,
              },
            ],
          }),
        ),
        getNeedsAttention: vi.fn().mockRejectedValue(new Error('needs-attention unavailable')),
      },
    });

    renderWithProviders(<AnalyticsPage />, { apiClient, route: ROUTE });

    expect(await screen.findByText('Allegro — main')).toBeInTheDocument();
    expect(await screen.findByText('Unable to check for open items')).toBeInTheDocument();
  });
});

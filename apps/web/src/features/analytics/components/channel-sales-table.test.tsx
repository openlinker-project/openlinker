import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { ChannelSalesAnalytics, SalesAndChannelAnalytics } from '../api/sales-analytics.types';
import { ChannelSalesTable } from './channel-sales-table';

const FILTERS = { from: '2026-08-01', to: '2026-08-14' };

function channel(overrides: Partial<ChannelSalesAnalytics> = {}): ChannelSalesAnalytics {
  return {
    sourceConnectionId: 'conn-1',
    revenue: 3000,
    revenueBasis: 'reporting',
    nativeCurrency: null,
    orderCount: 25,
    stampedOrderCount: 25,
    averageOrderValue: 120,
    unitsSold: 40,
    cancelledCount: 0,
    cancelledValue: 0,
    revenueShare: 0.625,
    taxTreatment: 'inclusive',
    trend: [],
    coverageComplete: true,
    ...overrides,
  };
}

function analytics(channels: ChannelSalesAnalytics[]): SalesAndChannelAnalytics {
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
    },
    channels,
  };
}

describe('ChannelSalesTable', () => {
  it('should show a loading state before the query resolves', () => {
    const apiClient = createMockApiClient({
      analytics: { getSales: vi.fn(() => new Promise(() => {})) },
    });

    renderWithProviders(<ChannelSalesTable filters={FILTERS} />, { apiClient });

    expect(screen.getByText('Loading by-channel figures')).toBeInTheDocument();
  });

  it('should show an error state with a retry action when the request fails', async () => {
    const apiClient = createMockApiClient({
      analytics: { getSales: vi.fn().mockRejectedValue(new Error('boom')) },
    });

    renderWithProviders(<ChannelSalesTable filters={FILTERS} />, { apiClient });

    expect(await screen.findByText('Unable to load by-channel figures')).toBeInTheDocument();
  });

  it('should render a reporting-basis channel with its revenue share', async () => {
    const apiClient = createMockApiClient({
      analytics: { getSales: vi.fn().mockResolvedValue(analytics([channel()])) },
      connections: {
        list: vi.fn().mockResolvedValue([
          { id: 'conn-1', name: 'Allegro — main', platformType: 'allegro' },
        ]),
      },
    });

    renderWithProviders(<ChannelSalesTable filters={FILTERS} />, { apiClient });

    expect(await screen.findByRole('link', { name: 'Allegro — main' })).toBeInTheDocument();
    expect(screen.getByText('PLN 3,000.00')).toBeInTheDocument();
    expect(screen.getByText('62.5%')).toBeInTheDocument();
  });

  it('should render a partial-history channel with a coverage flag', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getSales: vi.fn().mockResolvedValue(analytics([channel({ coverageComplete: false })])),
      },
      connections: {
        list: vi.fn().mockResolvedValue([{ id: 'conn-1', name: 'Erli', platformType: 'erli' }]),
      },
    });

    renderWithProviders(<ChannelSalesTable filters={FILTERS} />, { apiClient });

    expect(await screen.findByText('Partial history')).toBeInTheDocument();
  });

  it('should never render a revenue-share percentage for a non-reporting-basis channel', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getSales: vi.fn().mockResolvedValue(
          analytics([
            channel({
              revenueBasis: 'native',
              nativeCurrency: 'EUR',
              revenue: 500,
              revenueShare: null,
            }),
          ])
        ),
      },
      connections: {
        list: vi.fn().mockResolvedValue([{ id: 'conn-1', name: 'Erli', platformType: 'erli' }]),
      },
    });

    renderWithProviders(<ChannelSalesTable filters={FILTERS} />, { apiClient });

    expect(await screen.findByText('Own currency')).toBeInTheDocument();
    expect(screen.queryByText('62.5%')).not.toBeInTheDocument();
  });

  it('should render an empty revenue value for an unavailable-basis channel', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getSales: vi.fn().mockResolvedValue(
          analytics([channel({ revenueBasis: 'unavailable', revenue: null, revenueShare: null })])
        ),
      },
      connections: {
        list: vi.fn().mockResolvedValue([{ id: 'conn-1', name: 'Erli', platformType: 'erli' }]),
      },
    });

    renderWithProviders(<ChannelSalesTable filters={FILTERS} />, { apiClient });

    expect(await screen.findByRole('link', { name: 'Erli' })).toBeInTheDocument();
    expect(
      screen.getByLabelText('No revenue figure can be given for this channel in range')
    ).toBeInTheDocument();
  });
});

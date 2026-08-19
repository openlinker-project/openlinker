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
    currency: 'PLN',
    orderCount: 25,
    averageOrderValue: 120,
    unitsSold: 40,
    cancelledCount: 0,
    cancelledValue: 0,
    unconvertedCount: 0,
    unconvertedValue: 0,
    unconvertedCurrency: null,
    revenueShare: 0.625,
    trend: [],
    coverageComplete: true,
    ...overrides,
  };
}

function analytics(channels: ChannelSalesAnalytics[]): SalesAndChannelAnalytics {
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
    },
    channels,
  };
}

describe('ChannelSalesTable', () => {
  it('should show a loading state before the query resolves', () => {
    const apiClient = createMockApiClient({
      analytics: { getSales: vi.fn(() => new Promise<SalesAndChannelAnalytics>(() => {})) },
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

  it('should render a channel with its FX-stamped revenue and share', async () => {
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

  it('should flag a channel carrying not-yet-FX-stamped orders and fall back to its unconverted evidence', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getSales: vi.fn().mockResolvedValue(
          analytics([
            channel({
              revenue: 0,
              currency: null,
              orderCount: 0,
              averageOrderValue: 0,
              revenueShare: 0,
              unconvertedCount: 5,
              unconvertedValue: 500,
              unconvertedCurrency: 'EUR',
            }),
          ])
        ),
      },
      connections: {
        list: vi.fn().mockResolvedValue([{ id: 'conn-1', name: 'Shop DE', platformType: 'woocommerce' }]),
      },
    });

    renderWithProviders(<ChannelSalesTable filters={FILTERS} />, { apiClient });

    expect(await screen.findByText('Awaiting FX stamp')).toBeInTheDocument();
    expect(screen.getByText('€500.00')).toBeInTheDocument();
    // Share is 0 (nothing FX-stamped), still rendered as a real percentage, not an empty state.
    expect(screen.getByText('0.0%')).toBeInTheDocument();
  });

  it('should render a reporting-currency Total row summing more than one channel', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getSales: vi.fn().mockResolvedValue(
          analytics([
            channel({ sourceConnectionId: 'conn-1', revenue: 3000, orderCount: 25, revenueShare: 0.6 }),
            channel({ sourceConnectionId: 'conn-2', revenue: 2000, orderCount: 15, revenueShare: 0.4 }),
          ])
        ),
      },
      connections: {
        list: vi.fn().mockResolvedValue([
          { id: 'conn-1', name: 'Allegro — main', platformType: 'allegro' },
          { id: 'conn-2', name: 'Sklep główny', platformType: 'prestashop' },
        ]),
      },
    });

    renderWithProviders(<ChannelSalesTable filters={FILTERS} />, { apiClient });

    expect(await screen.findByText('Total · PLN')).toBeInTheDocument();
    expect(screen.getByText('PLN 5,000.00')).toBeInTheDocument();
  });

  it('should render a separate unconverted-currency Total row when more than one channel shares one', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getSales: vi.fn().mockResolvedValue(
          analytics([
            channel({ sourceConnectionId: 'conn-1', revenue: 3000, orderCount: 25, revenueShare: 1 }),
            channel({
              sourceConnectionId: 'conn-2',
              revenue: 0,
              currency: null,
              orderCount: 0,
              revenueShare: 0,
              unconvertedCount: 5,
              unconvertedValue: 500,
              unconvertedCurrency: 'EUR',
            }),
            channel({
              sourceConnectionId: 'conn-3',
              revenue: 0,
              currency: null,
              orderCount: 0,
              revenueShare: 0,
              unconvertedCount: 3,
              unconvertedValue: 300,
              unconvertedCurrency: 'EUR',
            }),
          ])
        ),
      },
      connections: {
        list: vi.fn().mockResolvedValue([
          { id: 'conn-1', name: 'Allegro — main', platformType: 'allegro' },
          { id: 'conn-2', name: 'Shop DE', platformType: 'woocommerce' },
          { id: 'conn-3', name: 'Shop AT', platformType: 'woocommerce' },
        ]),
      },
    });

    renderWithProviders(<ChannelSalesTable filters={FILTERS} />, { apiClient });

    expect(await screen.findByText('Total · PLN')).toBeInTheDocument();
    expect(screen.getByText('Total · EUR (unconverted)')).toBeInTheDocument();
    expect(screen.getByText('€800.00')).toBeInTheDocument();
  });

  it('should not render a Total row when only one channel is present', async () => {
    const apiClient = createMockApiClient({
      analytics: { getSales: vi.fn().mockResolvedValue(analytics([channel()])) },
      connections: {
        list: vi.fn().mockResolvedValue([{ id: 'conn-1', name: 'Allegro — main', platformType: 'allegro' }]),
      },
    });

    renderWithProviders(<ChannelSalesTable filters={FILTERS} />, { apiClient });

    expect(await screen.findByRole('link', { name: 'Allegro — main' })).toBeInTheDocument();
    expect(screen.queryByText('Total · PLN')).not.toBeInTheDocument();
  });

  it('should render an empty revenue value for a channel with no revenue and no unconverted evidence', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getSales: vi.fn().mockResolvedValue(
          analytics([
            channel({ revenue: 0, currency: null, orderCount: 0, averageOrderValue: 0, revenueShare: 0 }),
          ])
        ),
      },
      connections: {
        list: vi.fn().mockResolvedValue([{ id: 'conn-1', name: 'Erli', platformType: 'erli' }]),
      },
    });

    renderWithProviders(<ChannelSalesTable filters={FILTERS} />, { apiClient });

    expect(await screen.findByRole('link', { name: 'Erli' })).toBeInTheDocument();
    expect(
      screen.getByLabelText('No non-cancelled revenue recorded for this channel in range')
    ).toBeInTheDocument();
  });
});

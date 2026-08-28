import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, createMockApiClient } from '../../../test/test-utils';
import { AnalyticsConvertNote } from './analytics-convert-note';
import type { SalesAnalyticsFilters, SalesAndChannelAnalytics } from '../api/sales-analytics.types';

const baseFilters: SalesAnalyticsFilters = { from: '2026-01-01', to: '2026-01-31' };

describe('AnalyticsConvertNote', () => {
  it('should render nothing when no displayCurrency is selected', () => {
    renderWithProviders(<AnalyticsConvertNote filters={baseFilters} onSwitchBack={vi.fn()} />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('should show a converting message while the query is in flight', () => {
    const apiClient = createMockApiClient({
      analytics: {
        getSales: vi.fn(() => new Promise<SalesAndChannelAnalytics>(() => {})),
      },
    });

    renderWithProviders(
      <AnalyticsConvertNote
        filters={{ ...baseFilters, displayCurrency: 'EUR', rateBasis: 'current-rate' }}
        onSwitchBack={vi.fn()}
      />,
      { apiClient }
    );

    expect(screen.getByText('Converting to EUR…')).toBeInTheDocument();
  });

  it('should show the converted state with a switch-back action once resolved', async () => {
    const onSwitchBack = vi.fn();
    const apiClient = createMockApiClient({
      analytics: {
        getSales: vi.fn().mockResolvedValue({
          headline: {
            revenue: 100,
            currency: 'PLN',
            orderCount: 1,
            averageOrderValue: 100,
            medianOrderValue: 100,
            unitsSold: 1,
            cancelledCount: 0,
            cancelledValue: 0,
            unconvertedCount: 0,
            unconvertedValue: 0,
            unconvertedCurrency: null,
            trend: [],
            netRevenue: 100,
            netAverageOrderValue: 100,
            netMedianOrderValue: 100,
            netExcludedCount: 0,
            netExcludedValue: 0,
            displayCurrencyConversion: {
              displayCurrency: 'EUR',
              rateBasis: 'current-rate',
              convertedRevenue: 23.21,
              unresolvedNativeCurrencies: [],
            },
          },
          channels: [],
        }),
      },
    });

    renderWithProviders(
      <AnalyticsConvertNote
        filters={{ ...baseFilters, displayCurrency: 'EUR', rateBasis: 'current-rate' }}
        onSwitchBack={onSwitchBack}
      />,
      { apiClient }
    );

    expect(await screen.findByText(/Converted to EUR/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Switch back' }));
    expect(onSwitchBack).toHaveBeenCalled();
  });

  it('should show an unavailable state when the conversion could not be resolved', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getSales: vi.fn().mockResolvedValue({
          headline: {
            revenue: 100,
            currency: 'PLN',
            orderCount: 1,
            averageOrderValue: 100,
            medianOrderValue: 100,
            unitsSold: 1,
            cancelledCount: 0,
            cancelledValue: 0,
            unconvertedCount: 0,
            unconvertedValue: 0,
            unconvertedCurrency: null,
            trend: [],
            netRevenue: 100,
            netAverageOrderValue: 100,
            netMedianOrderValue: 100,
            netExcludedCount: 0,
            netExcludedValue: 0,
            displayCurrencyConversion: {
              displayCurrency: 'EUR',
              rateBasis: 'current-rate',
              convertedRevenue: null,
              unresolvedNativeCurrencies: ['PLN'],
            },
          },
          channels: [],
        }),
      },
    });

    renderWithProviders(
      <AnalyticsConvertNote
        filters={{ ...baseFilters, displayCurrency: 'EUR', rateBasis: 'current-rate' }}
        onSwitchBack={vi.fn()}
      />,
      { apiClient }
    );

    await waitFor(() => {
      expect(screen.getByText(/Couldn.t get today.s EUR rate/)).toBeInTheDocument();
    });
  });
});

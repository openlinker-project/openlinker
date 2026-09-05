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
              appliedRates: [],
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

    // Names the active rate-basis mode (matching the Analytics Settings
    // dialog's own labels), never a generic "Converted to EUR" that implies
    // both modes answer the same question.
    expect(await screen.findByText('Current rate:', { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/converted to EUR/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Switch back' }));
    expect(onSwitchBack).toHaveBeenCalled();
  });

  it('should label the order-date mode distinctly from current-rate', async () => {
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
              rateBasis: 'order-date',
              convertedRevenue: 23.21,
              unresolvedNativeCurrencies: [],
              appliedRates: [],
            },
          },
          channels: [],
        }),
      },
    });

    renderWithProviders(
      <AnalyticsConvertNote
        filters={{ ...baseFilters, displayCurrency: 'EUR', rateBasis: 'order-date' }}
        onSwitchBack={vi.fn()}
      />,
      { apiClient }
    );

    expect(await screen.findByText('Rate on order date:', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText('Current rate:', { exact: false })).not.toBeInTheDocument();
  });

  it('should replace the "converted" claim with an in-progress note while a currency recalculation is running', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getSales: vi.fn().mockResolvedValue({
          headline: {
            revenue: 0,
            currency: null,
            orderCount: 0,
            averageOrderValue: 0,
            medianOrderValue: 0,
            unitsSold: 0,
            cancelledCount: 0,
            cancelledValue: 0,
            unconvertedCount: 40,
            unconvertedValue: 4800,
            unconvertedCurrency: 'PLN',
            trend: [],
            netRevenue: 0,
            netAverageOrderValue: 0,
            netMedianOrderValue: 0,
            netExcludedCount: 0,
            netExcludedValue: 0,
            displayCurrencyConversion: {
              displayCurrency: 'EUR',
              rateBasis: 'current-rate',
              convertedRevenue: 0,
              unresolvedNativeCurrencies: [],
              appliedRates: [],
            },
          },
          channels: [],
        }),
      },
    });

    renderWithProviders(
      <AnalyticsConvertNote
        filters={{ ...baseFilters, displayCurrency: 'EUR', rateBasis: 'current-rate' }}
        coverage={{
          categories: [
            { category: 'currency', status: 'in-progress', affectedCount: 40, sampleOrderIds: [], activeRunId: 'ol_remrun_1' },
            { category: 'tax-a', status: 'open', affectedCount: 0, sampleOrderIds: [] },
            { category: 'tax-b', status: 'open', affectedCount: 0, sampleOrderIds: [] },
            { category: 'tax-c', status: 'open', affectedCount: 0, sampleOrderIds: [] },
            { category: 'product-matching', status: 'open', affectedCount: 0, sampleOrderIds: [] },
          ],
        }}
        onSwitchBack={vi.fn()}
      />,
      { apiClient }
    );

    expect(
      await screen.findByText(/A currency recalculation is running for this range/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/converted to EUR/)).not.toBeInTheDocument();
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
              appliedRates: [],
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

import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { Connection } from '../../connections';
import type { TopProductVariantsResult } from '../api/top-products.types';
import { VariantChannelMatrix } from './variant-channel-matrix';

const FILTERS = { from: '2026-08-01', to: '2026-08-14' };

const CONNECTIONS_BY_ID = new Map<string, Connection>([
  ['conn-a', { id: 'conn-a', name: 'Allegro — main', platformType: 'allegro' } as Connection],
  ['conn-b', { id: 'conn-b', name: 'Shop', platformType: 'woocommerce' } as Connection],
]);

function variantSalesResult(overrides: Partial<TopProductVariantsResult> = {}): TopProductVariantsResult {
  return {
    productId: 'p1',
    variants: [],
    ...overrides,
  };
}

describe('VariantChannelMatrix', () => {
  it('shows a loading state before the query resolves', () => {
    const apiClient = createMockApiClient({
      analytics: { getTopProductVariantSales: vi.fn(() => new Promise<TopProductVariantsResult>(() => {})) },
    });

    renderWithProviders(
      <VariantChannelMatrix
        productId="p1"
        filters={FILTERS}
        channelColumns={['conn-a']}
        connectionsById={CONNECTIONS_BY_ID}
      />,
      { apiClient }
    );

    expect(screen.getByText('Loading variant sales')).toBeInTheDocument();
  });

  it('shows an error state when the request fails', async () => {
    const apiClient = createMockApiClient({
      analytics: { getTopProductVariantSales: vi.fn().mockRejectedValue(new Error('boom')) },
    });

    renderWithProviders(
      <VariantChannelMatrix
        productId="p1"
        filters={FILTERS}
        channelColumns={['conn-a']}
        connectionsById={CONNECTIONS_BY_ID}
      />,
      { apiClient }
    );

    expect(await screen.findByText('Unable to load variant sales')).toBeInTheDocument();
  });

  it('shows an empty state when the product has no variant sales in range', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getTopProductVariantSales: vi.fn().mockResolvedValue(variantSalesResult({ variants: [] })),
      },
    });

    renderWithProviders(
      <VariantChannelMatrix
        productId="p1"
        filters={FILTERS}
        channelColumns={['conn-a']}
        connectionsById={CONNECTIONS_BY_ID}
      />,
      { apiClient }
    );

    expect(await screen.findByLabelText('No variant sales in this range')).toBeInTheDocument();
  });

  it('renders a single variant as a one-row matrix with no Total row', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getTopProductVariantSales: vi.fn().mockResolvedValue(
          variantSalesResult({
            variants: [
              {
                variantId: 'v1',
                sku: 'MX-200-BLK',
                attributes: null,
                totalAvailable: 40,
                units: 5,
                revenue: 50,
                unconvertedRevenue: 0,
                unconvertedOrderCount: 0,
                currency: 'PLN',
                unconvertedCurrency: null,
                netRevenue: 50,
                netExcludedRevenue: 0,
                netExcludedLineCount: 0,
                channels: [
                  {
                    sourceConnectionId: 'conn-a',
                    units: 5,
                    revenue: 50,
                    unconvertedRevenue: 0,
                    currency: 'PLN',
                    unconvertedCurrency: null,
                    netRevenue: 50,
                    netExcludedRevenue: 0,
                    netExcludedLineCount: 0,
                  },
                ],
              },
            ],
          })
        ),
      },
    });

    renderWithProviders(
      <VariantChannelMatrix
        productId="p1"
        filters={FILTERS}
        channelColumns={['conn-a']}
        connectionsById={CONNECTIONS_BY_ID}
      />,
      { apiClient }
    );

    expect(await screen.findByText('MX-200-BLK')).toBeInTheDocument();
    expect(screen.getByText('In stock')).toBeInTheDocument();
    // Only the "Total" COLUMN header exists — no Total ROW for a single variant.
    expect(screen.getAllByText('Total')).toHaveLength(1);
    expect(
      screen.getByText('Matches the Net sales, Units and channel figures shown above — one variant, so nothing to sum.')
    ).toBeInTheDocument();
  });

  it('shows a Total row that reconciles to the sum of every variant, for a multi-variant product', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getTopProductVariantSales: vi.fn().mockResolvedValue(
          variantSalesResult({
            variants: [
              {
                variantId: 'v1',
                sku: 'JCK-S',
                attributes: { Size: 'S' },
                totalAvailable: 12,
                units: 3,
                revenue: 30,
                unconvertedRevenue: 0,
                unconvertedOrderCount: 0,
                currency: 'PLN',
                unconvertedCurrency: null,
                netRevenue: 30,
                netExcludedRevenue: 0,
                netExcludedLineCount: 0,
                channels: [
                  {
                    sourceConnectionId: 'conn-a',
                    units: 3,
                    revenue: 30,
                    unconvertedRevenue: 0,
                    currency: 'PLN',
                    unconvertedCurrency: null,
                    netRevenue: 30,
                    netExcludedRevenue: 0,
                    netExcludedLineCount: 0,
                  },
                ],
              },
              {
                variantId: 'v2',
                sku: 'JCK-M',
                attributes: { Size: 'M' },
                totalAvailable: 0,
                units: 2,
                revenue: 20,
                unconvertedRevenue: 0,
                unconvertedOrderCount: 0,
                currency: 'PLN',
                unconvertedCurrency: null,
                netRevenue: 20,
                netExcludedRevenue: 0,
                netExcludedLineCount: 0,
                channels: [
                  {
                    sourceConnectionId: 'conn-a',
                    units: 2,
                    revenue: 20,
                    unconvertedRevenue: 0,
                    currency: 'PLN',
                    unconvertedCurrency: null,
                    netRevenue: 20,
                    netExcludedRevenue: 0,
                    netExcludedLineCount: 0,
                  },
                ],
              },
            ],
          })
        ),
      },
    });

    renderWithProviders(
      <VariantChannelMatrix
        productId="p1"
        filters={FILTERS}
        channelColumns={['conn-a']}
        connectionsById={CONNECTIONS_BY_ID}
      />,
      { apiClient }
    );

    expect(await screen.findByText('Size: S')).toBeInTheDocument();
    expect(screen.getByText('Size: M')).toBeInTheDocument();
    expect(screen.getByText('Out of stock')).toBeInTheDocument();
    // The Total COLUMN header plus the Total ROW label — both present now.
    expect(screen.getAllByText('Total')).toHaveLength(2);
    // Grand total units (3 + 2 = 5) reconciles the two rows.
    expect(screen.getAllByText('5').length).toBeGreaterThan(0);
    expect(
      screen.getByText('Adds up to the Net sales, Units and channel figures shown above.')
    ).toBeInTheDocument();
  });

  it('renders "Unassigned" for the null-variantId bucket, with no stock badge', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getTopProductVariantSales: vi.fn().mockResolvedValue(
          variantSalesResult({
            variants: [
              {
                variantId: null,
                sku: null,
                attributes: null,
                totalAvailable: null,
                units: 1,
                revenue: 10,
                unconvertedRevenue: 0,
                unconvertedOrderCount: 0,
                currency: 'PLN',
                unconvertedCurrency: null,
                netRevenue: 10,
                netExcludedRevenue: 0,
                netExcludedLineCount: 0,
                channels: [],
              },
            ],
          })
        ),
      },
    });

    renderWithProviders(
      <VariantChannelMatrix
        productId="p1"
        filters={FILTERS}
        channelColumns={['conn-a']}
        connectionsById={CONNECTIONS_BY_ID}
      />,
      { apiClient }
    );

    expect(await screen.findByText('Unassigned')).toBeInTheDocument();
    expect(screen.queryByText('In stock')).not.toBeInTheDocument();
    expect(screen.queryByText('Out of stock')).not.toBeInTheDocument();
  });
});

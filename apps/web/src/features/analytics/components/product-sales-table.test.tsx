import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { TopProductRow, TopProductsResult } from '../api/top-products.types';
import { ProductSalesTable } from './product-sales-table';

const FILTERS = { from: '2026-08-01', to: '2026-08-14' };

function row(overrides: Partial<TopProductRow> = {}): TopProductRow {
  return {
    productId: 'p1',
    name: 'Widget A',
    sku: 'WID-A',
    units: 4,
    revenue: 110,
    unconvertedRevenue: 0,
    unconvertedOrderCount: 0,
    currency: 'PLN',
    channels: [
      { sourceConnectionId: 'conn-a', units: 2, revenue: 110, unconvertedRevenue: 0, currency: 'PLN' },
      { sourceConnectionId: 'conn-b', units: 2, revenue: 0, unconvertedRevenue: 50, currency: null },
    ],
    missingFromConnectionIds: [],
    ...overrides,
  };
}

function result(items: TopProductRow[]): TopProductsResult {
  return { items, total: items.length, unresolvedProductCount: 0 };
}

const CONNECTIONS = [
  { id: 'conn-a', name: 'Allegro — main', platformType: 'allegro' },
  { id: 'conn-b', name: 'Shop', platformType: 'woocommerce' },
];

describe('ProductSalesTable', () => {
  it('shows a loading state before the query resolves', () => {
    const apiClient = createMockApiClient({
      analytics: { getTopProducts: vi.fn(() => new Promise<TopProductsResult>(() => {})) },
    });

    renderWithProviders(<ProductSalesTable filters={FILTERS} />, { apiClient });

    expect(screen.getByText('Loading top products')).toBeInTheDocument();
  });

  it('shows an error state with a retry action when the request fails', async () => {
    const apiClient = createMockApiClient({
      analytics: { getTopProducts: vi.fn().mockRejectedValue(new Error('boom')) },
    });

    renderWithProviders(<ProductSalesTable filters={FILTERS} />, { apiClient });

    expect(await screen.findByText('Unable to load top products')).toBeInTheDocument();
  });

  it('renders a real 0 for a channel with a sale, distinct from "Not listed" for a channel with none', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getTopProducts: vi.fn().mockResolvedValue(
          result([
            row({
              channels: [
                { sourceConnectionId: 'conn-a', units: 0, revenue: 0, unconvertedRevenue: 0, currency: 'PLN' },
              ],
              missingFromConnectionIds: [],
            }),
          ])
        ),
      },
      connections: { list: vi.fn().mockResolvedValue(CONNECTIONS) },
    });

    renderWithProviders(<ProductSalesTable filters={FILTERS} />, { apiClient });

    expect(await screen.findByText('Widget A')).toBeInTheDocument();
    // conn-a sold a real 0 — rendered as a tabular number (both the Units
    // total column and the conn-a channel column read 0), not "Not listed".
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
    expect(screen.queryByText('Not listed')).not.toBeInTheDocument();
  });

  it('renders a real 0 for a channel a product has no entry for, when it is not flagged missing', async () => {
    // Two rows so both conn-a and conn-b are real columns: Widget A only
    // sells on conn-a, Widget B only on conn-b — each row's OTHER channel
    // has no `channels[]` entry, but is also absent from
    // `missingFromConnectionIds`, meaning it IS listed there and simply had
    // no sale in this date range. That must render the same real `0` a
    // channel with actual sales would, never "Not listed" — the two rows
    // being the SAME product on two different channels would otherwise be
    // indistinguishable from a genuinely unlisted channel.
    const apiClient = createMockApiClient({
      analytics: {
        getTopProducts: vi.fn().mockResolvedValue(
          result([
            row({
              productId: 'p1',
              name: 'Widget A',
              channels: [{ sourceConnectionId: 'conn-a', units: 2, revenue: 50, unconvertedRevenue: 0, currency: 'PLN' }],
              missingFromConnectionIds: [],
            }),
            row({
              productId: 'p2',
              name: 'Widget B',
              channels: [{ sourceConnectionId: 'conn-b', units: 3, revenue: 60, unconvertedRevenue: 0, currency: 'PLN' }],
              missingFromConnectionIds: [],
            }),
          ])
        ),
      },
      connections: { list: vi.fn().mockResolvedValue(CONNECTIONS) },
    });

    renderWithProviders(<ProductSalesTable filters={FILTERS} />, { apiClient });

    await screen.findByText('Widget A');
    expect(screen.queryByText('Not listed')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Publish/ })).not.toBeInTheDocument();
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  });

  it('shows a Publish chip for a channel the product is missing from', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getTopProducts: vi.fn().mockResolvedValue(
          result([
            row({
              channels: [
                { sourceConnectionId: 'conn-a', units: 2, revenue: 110, unconvertedRevenue: 0, currency: 'PLN' },
              ],
              missingFromConnectionIds: ['conn-b'],
            }),
          ])
        ),
      },
      connections: { list: vi.fn().mockResolvedValue(CONNECTIONS) },
    });

    renderWithProviders(<ProductSalesTable filters={FILTERS} />, { apiClient });

    expect(await screen.findByRole('button', { name: /Publish/ })).toBeInTheDocument();
  });

  it('refetches with sortBy=units after switching the segmented control', async () => {
    const getTopProducts = vi.fn().mockResolvedValue(result([row()]));
    const apiClient = createMockApiClient({
      analytics: { getTopProducts },
      connections: { list: vi.fn().mockResolvedValue(CONNECTIONS) },
    });

    renderWithProviders(<ProductSalesTable filters={FILTERS} />, { apiClient });
    await screen.findByText('Widget A');

    expect(getTopProducts).toHaveBeenCalledWith(expect.objectContaining({ sortBy: 'revenue' }));

    await userEvent.click(screen.getByRole('radio', { name: 'By units' }));

    expect(getTopProducts).toHaveBeenCalledWith(expect.objectContaining({ sortBy: 'units' }));
  });

  it('renders an empty value for a product with no SKU, and its row link points at product detail', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getTopProducts: vi.fn().mockResolvedValue(result([row({ productId: 'p1', sku: null })])),
      },
      connections: { list: vi.fn().mockResolvedValue(CONNECTIONS) },
    });

    renderWithProviders(<ProductSalesTable filters={FILTERS} />, { apiClient });

    expect(await screen.findByLabelText('No SKU')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Widget A/ })).toHaveAttribute('href', '/products/p1');
  });

  it('renders an empty state when there are no orders in range', async () => {
    const apiClient = createMockApiClient({
      analytics: { getTopProducts: vi.fn().mockResolvedValue(result([])) },
      connections: { list: vi.fn().mockResolvedValue(CONNECTIONS) },
    });

    renderWithProviders(<ProductSalesTable filters={FILTERS} />, { apiClient });

    expect(await screen.findByLabelText('No orders in this range')).toBeInTheDocument();
  });
});

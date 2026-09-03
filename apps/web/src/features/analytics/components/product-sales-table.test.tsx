import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';
import type { SessionUser } from '../../../shared/auth/session.types';
import type { TopProductRow, TopProductsResult } from '../api/top-products.types';
import { ProductSalesTable } from './product-sales-table';

const FILTERS = { from: '2026-08-01', to: '2026-08-14' };

// The Publish action is gated on `listings:write` (#2191 tech review) — a
// genuinely unauthorized, non-demo viewer sees it neither as a link nor as a
// disabled button, so a viewer session only differs from admin by omitting it.
const viewerUser: SessionUser = {
  id: 'user_viewer',
  username: 'viewer',
  email: 'viewer@example.com',
  role: 'viewer',
  permissions: [],
};

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
    unconvertedCurrency: null,
    channels: [
      {
        sourceConnectionId: 'conn-a',
        units: 2,
        revenue: 110,
        unconvertedRevenue: 0,
        currency: 'PLN',
        netRevenue: 0,
        netExcludedRevenue: 0,
        netExcludedLineCount: 0,
      },
      {
        sourceConnectionId: 'conn-b',
        units: 2,
        revenue: 0,
        unconvertedRevenue: 50,
        currency: null,
        netRevenue: 0,
        netExcludedRevenue: 0,
        netExcludedLineCount: 0,
      },
    ],
    missingFromConnectionIds: [],
    netRevenue: 100,
    netExcludedRevenue: 0,
    netExcludedLineCount: 0,
    ...overrides,
  };
}

function result(
  items: TopProductRow[],
  overrides: Partial<TopProductsResult> = {}
): TopProductsResult {
  return {
    items,
    total: items.length,
    unresolvedProductCount: 0,
    coverageGapAvailable: true,
    ...overrides,
  };
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
                {
                  sourceConnectionId: 'conn-a',
                  units: 0,
                  revenue: 0,
                  unconvertedRevenue: 0,
                  currency: 'PLN',
                  netRevenue: 0,
                  netExcludedRevenue: 0,
                  netExcludedLineCount: 0,
                },
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
              channels: [
                {
                  sourceConnectionId: 'conn-a',
                  units: 2,
                  revenue: 50,
                  unconvertedRevenue: 0,
                  currency: 'PLN',
                  netRevenue: 0,
                  netExcludedRevenue: 0,
                  netExcludedLineCount: 0,
                },
              ],
              missingFromConnectionIds: [],
            }),
            row({
              productId: 'p2',
              name: 'Widget B',
              channels: [
                {
                  sourceConnectionId: 'conn-b',
                  units: 3,
                  revenue: 60,
                  unconvertedRevenue: 0,
                  currency: 'PLN',
                  netRevenue: 0,
                  netExcludedRevenue: 0,
                  netExcludedLineCount: 0,
                },
              ],
              missingFromConnectionIds: [],
            }),
          ])
        ),
      },
      connections: { list: vi.fn().mockResolvedValue(CONNECTIONS) },
    });

    renderWithProviders(<ProductSalesTable filters={FILTERS} />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await screen.findByText('Widget A');
    expect(screen.queryByText('Not listed')).not.toBeInTheDocument();
    // Full write access is granted here, so an absent Publish link proves the
    // "not flagged missing" branch, not the permission gate tested above.
    expect(screen.queryByRole('link', { name: /Publish/ })).not.toBeInTheDocument();
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  });

  it('shows a Publish link for a channel the product is missing from', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getTopProducts: vi.fn().mockResolvedValue(
          result([
            row({
              channels: [
                {
                  sourceConnectionId: 'conn-a',
                  units: 2,
                  revenue: 110,
                  unconvertedRevenue: 0,
                  currency: 'PLN',
                  netRevenue: 0,
                  netExcludedRevenue: 0,
                  netExcludedLineCount: 0,
                },
              ],
              missingFromConnectionIds: ['conn-b'],
            }),
          ])
        ),
      },
      connections: { list: vi.fn().mockResolvedValue(CONNECTIONS) },
    });

    renderWithProviders(<ProductSalesTable filters={FILTERS} />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    const publishLink = await screen.findByRole('link', { name: /Publish/ });
    expect(publishLink).toBeInTheDocument();
    expect(publishLink).toHaveAttribute(
      'href',
      '/listings/bulk-create/wizard?productIds=p1&connectionId=conn-b'
    );
  });

  it('hides the Publish action entirely for a genuinely unauthorized non-demo session', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getTopProducts: vi.fn().mockResolvedValue(
          result([
            row({
              channels: [
                {
                  sourceConnectionId: 'conn-a',
                  units: 2,
                  revenue: 110,
                  unconvertedRevenue: 0,
                  currency: 'PLN',
                  netRevenue: 0,
                  netExcludedRevenue: 0,
                  netExcludedLineCount: 0,
                },
              ],
              missingFromConnectionIds: ['conn-b'],
            }),
          ])
        ),
      },
      connections: { list: vi.fn().mockResolvedValue(CONNECTIONS) },
    });

    renderWithProviders(<ProductSalesTable filters={FILTERS} />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(viewerUser),
    });

    await screen.findByText('Not listed');
    expect(screen.queryByRole('link', { name: /Publish/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Publish/ })).not.toBeInTheDocument();
  });

  it('renders the Publish action disabled with a read-only tooltip for a demo read-only session', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getTopProducts: vi.fn().mockResolvedValue(
          result([
            row({
              channels: [
                {
                  sourceConnectionId: 'conn-a',
                  units: 2,
                  revenue: 110,
                  unconvertedRevenue: 0,
                  currency: 'PLN',
                  netRevenue: 0,
                  netExcludedRevenue: 0,
                  netExcludedLineCount: 0,
                },
              ],
              missingFromConnectionIds: ['conn-b'],
            }),
          ])
        ),
      },
      connections: { list: vi.fn().mockResolvedValue(CONNECTIONS) },
      system: { getConfig: vi.fn().mockResolvedValue({ demoMode: true }) },
    });

    renderWithProviders(<ProductSalesTable filters={FILTERS} />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(viewerUser),
    });

    const publishButton = await screen.findByRole('button', { name: /Publish/ });
    expect(publishButton).toBeDisabled();
    expect(screen.queryByRole('link', { name: /Publish/ })).not.toBeInTheDocument();
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

  it('renders an empty value for a product with no SKU', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getTopProducts: vi.fn().mockResolvedValue(result([row({ productId: 'p1', sku: null })])),
      },
      connections: { list: vi.fn().mockResolvedValue(CONNECTIONS) },
    });

    renderWithProviders(<ProductSalesTable filters={FILTERS} />, { apiClient });

    expect(await screen.findByLabelText('No SKU')).toBeInTheDocument();
  });

  it('expands an inline detail panel on row click instead of navigating away (#2765)', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getTopProducts: vi.fn().mockResolvedValue(result([row({ productId: 'p1' })])),
      },
      connections: { list: vi.fn().mockResolvedValue(CONNECTIONS) },
    });

    renderWithProviders(<ProductSalesTable filters={FILTERS} />, { apiClient });
    await screen.findByText('Widget A');

    // No row-level navigation link exists any more — the whole row is a
    // toggle instead of a rowHref-backed <Link>.
    expect(screen.queryByRole('link', { name: /Widget A/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Open the full product page/)).not.toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: 'Expand details for Widget A' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Collapse details for Widget A' })).toBe(toggle);
    // The deliberate, explicit navigation links live inside the panel —
    // distinct from the accidental whole-row navigation being removed.
    const openProductLink = screen.getByRole('link', { name: /Product details/ });
    expect(openProductLink).toHaveAttribute('href', '/products/p1');
    expect(screen.getByRole('link', { name: /Edit content/ })).toHaveAttribute(
      'href',
      '/products/p1?view=content',
    );

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: /Product details/ })).not.toBeInTheDocument();
  });

  it('fetches and renders the variant × channel sales matrix when a row expands (#2765)', async () => {
    const getTopProductVariantSales = vi.fn().mockResolvedValue({
      productId: 'p1',
      variants: [
        {
          variantId: 'v1',
          sku: 'WID-A-VARIANT',
          attributes: null,
          totalAvailable: 10,
          units: 4,
          revenue: 110,
          unconvertedRevenue: 0,
          unconvertedOrderCount: 0,
          currency: 'PLN',
          unconvertedCurrency: null,
          netRevenue: 100,
          netExcludedRevenue: 0,
          netExcludedLineCount: 0,
          channels: [
            {
              sourceConnectionId: 'conn-a',
              units: 4,
              revenue: 110,
              unconvertedRevenue: 0,
              currency: 'PLN',
              unconvertedCurrency: null,
              netRevenue: 100,
              netExcludedRevenue: 0,
              netExcludedLineCount: 0,
            },
          ],
        },
      ],
    });
    const apiClient = createMockApiClient({
      analytics: {
        getTopProducts: vi.fn().mockResolvedValue(result([row({ productId: 'p1' })])),
        getTopProductVariantSales,
      },
      connections: { list: vi.fn().mockResolvedValue(CONNECTIONS) },
    });

    renderWithProviders(<ProductSalesTable filters={FILTERS} />, { apiClient });
    await screen.findByText('Widget A');

    await userEvent.click(screen.getByRole('button', { name: 'Expand details for Widget A' }));

    expect(getTopProductVariantSales).toHaveBeenCalledWith('p1', FILTERS);
    expect(await screen.findByText('WID-A-VARIANT')).toBeInTheDocument();
    expect(screen.getByText('In stock')).toBeInTheDocument();
  });

  it('renders an empty Net sales value for a product with no current-era FX stamp, with no unconverted fallback (net requires the same stamp as gross)', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getTopProducts: vi.fn().mockResolvedValue(
          result([
            row({
              currency: null,
              netRevenue: 0,
              unconvertedRevenue: 100,
              unconvertedCurrency: 'EUR',
              unconvertedOrderCount: 1,
            }),
          ])
        ),
      },
      connections: { list: vi.fn().mockResolvedValue(CONNECTIONS) },
    });

    renderWithProviders(<ProductSalesTable filters={FILTERS} />, { apiClient });

    expect(
      await screen.findByLabelText('No Net sales figure for this product in range')
    ).toBeInTheDocument();
  });

  it('never renders "Not listed" when coverageGapAvailable is false, even for a flagged-missing channel (#2172 review, IMPORTANT 1)', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getTopProducts: vi.fn().mockResolvedValue(
          result(
            [
              row({
                channels: [
                  {
                    sourceConnectionId: 'conn-a',
                    units: 2,
                    revenue: 110,
                    unconvertedRevenue: 0,
                    currency: 'PLN',
                    netRevenue: 0,
                    netExcludedRevenue: 0,
                    netExcludedLineCount: 0,
                  },
                ],
                // Unreliable when coverageGapAvailable is false — must NOT be trusted.
                missingFromConnectionIds: ['conn-b'],
              }),
            ],
            { coverageGapAvailable: false }
          )
        ),
      },
      connections: { list: vi.fn().mockResolvedValue(CONNECTIONS) },
    });

    renderWithProviders(<ProductSalesTable filters={FILTERS} />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await screen.findByText('Widget A');
    expect(screen.queryByText('Not listed')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Publish/ })).not.toBeInTheDocument();
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
    expect(screen.getByText(/Listing-coverage check unavailable/)).toBeInTheDocument();
  });

  it('shows an unresolved-products footnote when unresolvedProductCount is positive (#2172 review, IMPORTANT 2)', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getTopProducts: vi
          .fn()
          .mockResolvedValue(
            result([row({ productId: 'p1', name: null, sku: null })], { unresolvedProductCount: 1 })
          ),
      },
      connections: { list: vi.fn().mockResolvedValue(CONNECTIONS) },
    });

    renderWithProviders(<ProductSalesTable filters={FILTERS} />, { apiClient });

    expect(
      await screen.findByText('1 product on this page could not be resolved to a catalogue entry.')
    ).toBeInTheDocument();
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

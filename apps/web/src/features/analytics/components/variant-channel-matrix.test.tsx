import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';
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
        productName="Widget"
        filters={FILTERS}
        channelColumns={['conn-a']}
        connectionsById={CONNECTIONS_BY_ID}
        notListedConnectionIds={[]}
        demoMode={false}
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
        productName="Widget"
        filters={FILTERS}
        channelColumns={['conn-a']}
        connectionsById={CONNECTIONS_BY_ID}
        notListedConnectionIds={[]}
        demoMode={false}
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
        productName="Widget"
        filters={FILTERS}
        channelColumns={['conn-a']}
        connectionsById={CONNECTIONS_BY_ID}
        notListedConnectionIds={[]}
        demoMode={false}
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
        productName="Widget"
        filters={FILTERS}
        channelColumns={['conn-a']}
        connectionsById={CONNECTIONS_BY_ID}
        notListedConnectionIds={[]}
        demoMode={false}
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
        productName="Widget"
        filters={FILTERS}
        channelColumns={['conn-a']}
        connectionsById={CONNECTIONS_BY_ID}
        notListedConnectionIds={[]}
        demoMode={false}
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
        productName="Widget"
        filters={FILTERS}
        channelColumns={['conn-a']}
        connectionsById={CONNECTIONS_BY_ID}
        notListedConnectionIds={[]}
        demoMode={false}
      />,
      { apiClient }
    );

    expect(await screen.findByText('Unassigned')).toBeInTheDocument();
    expect(screen.queryByText('In stock')).not.toBeInTheDocument();
    expect(screen.queryByText('Out of stock')).not.toBeInTheDocument();
  });

  it('says "Unresolved variant" — never "Unassigned" — for a real variant the catalog could not resolve', async () => {
    // #2765 review, finding 3: a variant that sold but no longer exists in
    // the catalog (delete-then-recreate leaves stale mappings behind) has a
    // non-null id and no sku/attributes. Calling that "Unassigned" made it
    // indistinguishable from the genuinely unattributed bucket.
    const apiClient = createMockApiClient({
      analytics: {
        getTopProductVariantSales: vi.fn().mockResolvedValue(
          variantSalesResult({
            variants: [
              {
                variantId: 'ol_variant_stale',
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
        productName="Widget"
        filters={FILTERS}
        channelColumns={['conn-a']}
        connectionsById={CONNECTIONS_BY_ID}
        notListedConnectionIds={[]}
        demoMode={false}
      />,
      { apiClient }
    );

    expect(await screen.findByText('Unresolved variant')).toBeInTheDocument();
    expect(screen.queryByText('Unassigned')).not.toBeInTheDocument();
    // The raw id is the only handle an operator has to chase it.
    expect(screen.getByText('ol_variant_stale')).toBeInTheDocument();
  });

  it('says "Not listed" once per not-listed channel column, with a publish affordance, instead of "no figure in range"', async () => {
    // #2765 review, findings 6 + 7: the matrix used to render an empty
    // "No Net sales figure in range" cell for a channel the collapsed row
    // above reported as "Not listed" — two statements about one fact — and
    // the mobile card had no other surface carrying that fact at all.
    const apiClient = createMockApiClient({
      analytics: {
        getTopProductVariantSales: vi.fn().mockResolvedValue(
          variantSalesResult({
            variants: [
              {
                variantId: 'v1',
                sku: 'MX-1',
                attributes: null,
                totalAvailable: 4,
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
        productName="Widget"
        filters={FILTERS}
        channelColumns={['conn-a', 'conn-b']}
        connectionsById={CONNECTIONS_BY_ID}
        notListedConnectionIds={['conn-b']}
        demoMode={false}
      />,
      { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() }
    );

    expect(await screen.findByText('Not listed')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Publish Widget on this channel — it already sells elsewhere')
    ).toBeInTheDocument();
    // Stated once in the header, and the body cell defers to it rather than
    // claiming there was simply no sale in range.
    expect(screen.getAllByText('Not listed')).toHaveLength(1);
    expect(screen.getByLabelText('Not listed on this channel')).toBeInTheDocument();
  });

  it('still reports real sales on a not-listed channel, and keeps the Total row reconciling', async () => {
    // #2766 review, findings 2 + 3: coverage is a statement about the
    // listing NOW and is range-independent, so a channel delisted mid-range
    // legitimately carries real net sales for this window. Checking
    // "not listed" BEFORE the data discarded those figures — the collapsed
    // row above showed them while this panel called the cell blank — and
    // left the Total row not reconciling against its own grand total, which
    // sums every variant unconditionally.
    const apiClient = createMockApiClient({
      analytics: {
        getTopProductVariantSales: vi.fn().mockResolvedValue(
          variantSalesResult({
            variants: [
              {
                variantId: 'v1',
                sku: 'DL-1',
                attributes: null,
                totalAvailable: 4,
                units: 7,
                revenue: 70,
                unconvertedRevenue: 0,
                unconvertedOrderCount: 0,
                currency: 'PLN',
                unconvertedCurrency: null,
                netRevenue: 70,
                netExcludedRevenue: 0,
                netExcludedLineCount: 0,
                channels: [
                  {
                    sourceConnectionId: 'conn-b',
                    units: 7,
                    revenue: 70,
                    unconvertedRevenue: 0,
                    currency: 'PLN',
                    unconvertedCurrency: null,
                    netRevenue: 70,
                    netExcludedRevenue: 0,
                    netExcludedLineCount: 0,
                  },
                ],
              },
              {
                variantId: 'v2',
                sku: 'DL-2',
                attributes: null,
                totalAvailable: 4,
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
                    sourceConnectionId: 'conn-b',
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
            ],
          })
        ),
      },
    });

    renderWithProviders(
      <VariantChannelMatrix
        productId="p1"
        productName="Widget"
        filters={FILTERS}
        channelColumns={['conn-b']}
        connectionsById={CONNECTIONS_BY_ID}
        notListedConnectionIds={['conn-b']}
        demoMode={false}
      />,
      { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() }
    );

    // The coverage claim + its remediation stay, stated once in the header.
    expect(await screen.findByText('Not listed')).toBeInTheDocument();
    // …and the real figures are NOT discarded: no cell claims the channel
    // is blank, and the delisted column's own total (7 + 3 = 10 units)
    // matches the grand total beside it.
    expect(screen.queryByLabelText('Not listed on this channel')).not.toBeInTheDocument();
    expect(screen.getAllByText('7').length).toBeGreaterThan(0);
    expect(screen.getAllByText('3').length).toBeGreaterThan(0);
    expect(screen.getAllByText('10')).toHaveLength(2);
  });
});

import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { ChannelSalesAnalytics, SalesAndChannelAnalytics } from '../api/sales-analytics.types';
import type { AnalyticsCoverage } from '../api/analytics-coverage.types';
import { ChannelSalesTable } from './channel-sales-table';

const FILTERS = { from: '2026-08-01', to: '2026-08-14' };
const COVERAGE_FILTERS = { from: '2026-08-01T00:00:00.000Z', to: '2026-08-15T00:00:00.000Z' };

function coverage(overrides: Partial<Record<string, number>> = {}): AnalyticsCoverage {
  return {
    categories: [
      { category: 'currency', status: 'open', affectedCount: overrides.currency ?? 0, sampleOrderIds: [] },
      { category: 'tax-a', status: 'open', affectedCount: overrides['tax-a'] ?? 0, sampleOrderIds: [] },
      { category: 'tax-b', status: 'open', affectedCount: overrides['tax-b'] ?? 0, sampleOrderIds: [] },
      { category: 'tax-c', status: 'open', affectedCount: overrides['tax-c'] ?? 0, sampleOrderIds: [] },
      { category: 'product-matching', status: 'open', affectedCount: 0, sampleOrderIds: [] },
    ],
  };
}

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
    cancelledUnconvertedCount: 0,
    cancelledUnconvertedValue: 0,
    unconvertedCount: 0,
    unconvertedValue: 0,
    unconvertedCurrency: null,
    netRevenue: 2700,
    netAverageOrderValue: 108,
    netExcludedCount: 0,
    netExcludedValue: 0,
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
      cancelledUnconvertedCount: 0,
      cancelledUnconvertedValue: 0,
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
    // Appears twice: the channel's own row, plus the Total · PLN row it
    // fully composes (a single-contributor Total is intentionally still
    // emitted, matching groupChannelTotalsByCurrency's documented rule).
    expect(screen.getAllByText('PLN 2,700.00')).toHaveLength(2);
    expect(screen.getAllByText('62.5%')).toHaveLength(2);
    // AOV reads netAverageOrderValue (108), never gross averageOrderValue
    // (120) — pins the bug where Net sales read net while AOV still read
    // gross, so a net-ineligible channel could show a real, nonzero AOV
    // next to "Net sales 0.00".
    expect(screen.getAllByText('PLN 108.00')).toHaveLength(2);
    expect(screen.queryByText('PLN 120.00')).not.toBeInTheDocument();
  });

  it('should render net figures and a "Net sales" header when basis is omitted (default, #2895)', async () => {
    const apiClient = createMockApiClient({
      analytics: { getSales: vi.fn().mockResolvedValue(analytics([channel()])) },
      connections: {
        list: vi.fn().mockResolvedValue([
          { id: 'conn-1', name: 'Allegro — main', platformType: 'allegro' },
        ]),
      },
    });

    renderWithProviders(<ChannelSalesTable filters={FILTERS} />, { apiClient });

    expect(await screen.findByRole('columnheader', { name: 'Net sales' })).toBeInTheDocument();
    expect(screen.getAllByText('PLN 2,700.00')).toHaveLength(2);
  });

  it('should switch to gross revenue/AOV and relabel the header "GMV" when basis="gross" (#2895)', async () => {
    const apiClient = createMockApiClient({
      analytics: { getSales: vi.fn().mockResolvedValue(analytics([channel()])) },
      connections: {
        list: vi.fn().mockResolvedValue([
          { id: 'conn-1', name: 'Allegro — main', platformType: 'allegro' },
        ]),
      },
    });

    renderWithProviders(<ChannelSalesTable filters={FILTERS} basis="gross" />, { apiClient });

    expect(await screen.findByRole('columnheader', { name: 'GMV' })).toBeInTheDocument();
    // Gross revenue (3000), never net (2700) — appears on the channel row
    // and its Total · PLN row.
    expect(screen.getAllByText('PLN 3,000.00')).toHaveLength(2);
    expect(screen.queryByText('PLN 2,700.00')).not.toBeInTheDocument();
    // AOV switches to gross (120), never net (108).
    expect(screen.getAllByText('PLN 120.00')).toHaveLength(2);
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

  it('should flag a channel carrying not-yet-FX-stamped orders and render an empty Net sales figure (no unconverted fallback for net)', async () => {
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
    // Net sales has no unconverted counterpart to fall back to — an
    // unconverted amount is a GROSS figure and would misrepresent itself as
    // net — so the cell renders the plain empty state instead.
    expect(
      screen.getByLabelText('No Net sales figure can be given for this channel in range')
    ).toBeInTheDocument();
    // Share is 0 (nothing FX-stamped), still rendered as a real percentage, not an empty state.
    expect(screen.getByText('0.0%')).toBeInTheDocument();
    // No "Total · X" row at all — nothing has a stamped currency yet — and
    // the footnote reports the count, never a "Total · EUR (unconverted)" row.
    expect(screen.queryByText(/^Total ·/)).not.toBeInTheDocument();
    expect(screen.getByText('5 orders not yet converted to the reporting currency — excluded from the figures above.')).toBeInTheDocument();
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
    // Both channels keep their default netRevenue (2700 each) — the
    // overrides above only touch revenue/orderCount/revenueShare.
    expect(screen.getByText('PLN 5,400.00')).toBeInTheDocument();
  });

  it('should NOT render a separate unconverted-currency Total row — only a footnote count', async () => {
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
    expect(screen.queryByText(/^Total · EUR/)).not.toBeInTheDocument();
    expect(screen.queryByText('€800.00')).not.toBeInTheDocument();
    expect(screen.getByText('8 orders not yet converted to the reporting currency — excluded from the figures above.')).toBeInTheDocument();
  });

  it('should still render a Total row for a single contributing channel', async () => {
    const apiClient = createMockApiClient({
      analytics: { getSales: vi.fn().mockResolvedValue(analytics([channel()])) },
      connections: {
        list: vi.fn().mockResolvedValue([{ id: 'conn-1', name: 'Allegro — main', platformType: 'allegro' }]),
      },
    });

    renderWithProviders(<ChannelSalesTable filters={FILTERS} />, { apiClient });

    expect(await screen.findByRole('link', { name: 'Allegro — main' })).toBeInTheDocument();
    expect(screen.getByText('Total · PLN')).toBeInTheDocument();
  });

  it('should render an empty Net sales value for a channel with no FX-stamped revenue', async () => {
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
      screen.getByLabelText('No Net sales figure can be given for this channel in range')
    ).toBeInTheDocument();
  });

  // #2481 regression guards — the mockup's own two found bugs: a row
  // wrongly labeled with a *different* category's issue, and a row with
  // orders in an open category's affected set missing its annotation
  // entirely. Both fixtures cross-reference against the aggregate-by-
  // connection endpoint (#2713/#2714), grouped by `sourceConnectionId`
  // server-side.
  describe('.excl-note cross-reference (#2481, ported to the aggregate endpoint by #2714)', () => {
    it("should attribute each channel's exclusion note to its own category, never the other channel's", async () => {
      const apiClient = createMockApiClient({
        analytics: {
          getSales: vi.fn().mockResolvedValue(
            analytics([
              channel({ sourceConnectionId: 'conn-1' }),
              channel({ sourceConnectionId: 'conn-2' }),
            ])
          ),
          getCoverageByConnection: vi.fn().mockResolvedValue({
            categories: [
              { category: 'currency', rows: [{ sourceConnectionId: 'conn-1', affectedCount: 1 }] },
              { category: 'tax-a', rows: [] },
              { category: 'tax-b', rows: [{ sourceConnectionId: 'conn-2', affectedCount: 1 }] },
              { category: 'tax-c', rows: [] },
            ],
          }),
        },
        connections: {
          list: vi.fn().mockResolvedValue([
            { id: 'conn-1', name: 'Allegro — main', platformType: 'allegro' },
            { id: 'conn-2', name: 'Sklep główny', platformType: 'prestashop' },
          ]),
        },
      });

      renderWithProviders(
        <ChannelSalesTable
          filters={FILTERS}
          coverage={coverage({ currency: 1, 'tax-b': 1 })}
          coverageFilters={COVERAGE_FILTERS}
          onOpenCategory={() => {}}
        />,
        { apiClient }
      );

      const conn1Row = (await screen.findByRole('link', { name: 'Allegro — main' })).closest('tr');
      const conn2Row = (await screen.findByRole('link', { name: 'Sklep główny' })).closest('tr');
      expect(conn1Row).not.toBeNull();
      expect(conn2Row).not.toBeNull();

      // conn-1's own order is a currency exclusion — its note must say so,
      // and must NOT carry conn-2's tax-B note (the exact mislabeling bug
      // the mockup's own design review caught).
      const conn1Notes = conn1Row!.querySelectorAll('.excl-note');
      expect(conn1Notes).toHaveLength(1);
      expect(conn1Notes[0]).toHaveTextContent('1 order counted in an outdated currency');

      const conn2Notes = conn2Row!.querySelectorAll('.excl-note');
      expect(conn2Notes).toHaveLength(1);
      expect(conn2Notes[0]).toHaveTextContent('1 order have no tax rate at all');
    });

    it('should annotate a channel for every cross-referenceable category it has an excluded order in', async () => {
      const apiClient = createMockApiClient({
        analytics: {
          getSales: vi.fn().mockResolvedValue(analytics([channel({ sourceConnectionId: 'conn-1' })])),
          getCoverageByConnection: vi.fn().mockResolvedValue({
            categories: [
              { category: 'currency', rows: [{ sourceConnectionId: 'conn-1', affectedCount: 1 }] },
              { category: 'tax-a', rows: [{ sourceConnectionId: 'conn-1', affectedCount: 1 }] },
              { category: 'tax-b', rows: [{ sourceConnectionId: 'conn-1', affectedCount: 1 }] },
              { category: 'tax-c', rows: [{ sourceConnectionId: 'conn-1', affectedCount: 1 }] },
            ],
          }),
        },
        connections: {
          list: vi.fn().mockResolvedValue([{ id: 'conn-1', name: 'Allegro — main', platformType: 'allegro' }]),
        },
      });

      renderWithProviders(
        <ChannelSalesTable
          filters={FILTERS}
          coverage={coverage({ currency: 1, 'tax-a': 1, 'tax-b': 1, 'tax-c': 1 })}
          coverageFilters={COVERAGE_FILTERS}
          onOpenCategory={() => {}}
        />,
        { apiClient }
      );

      const row = (await screen.findByRole('link', { name: 'Allegro — main' })).closest('tr');
      expect(row).not.toBeNull();
      // One note per open category this channel has an order in — every
      // category is represented, none silently dropped.
      expect(row!.querySelectorAll('.excl-note')).toHaveLength(4);
    });
  });

  it('shows "Recalculating…" for Net sales/AOV instead of a bare 0 while a currency remediation run is in progress', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getSales: vi.fn().mockResolvedValue(
          analytics([
            channel({
              revenue: 0,
              currency: null,
              netRevenue: 0,
              netAverageOrderValue: 0,
              orderCount: 0,
              revenueShare: 0,
              unconvertedCount: 25,
              unconvertedValue: 3000,
              unconvertedCurrency: 'PLN',
            }),
          ])
        ),
      },
      connections: {
        list: vi.fn().mockResolvedValue([{ id: 'conn-1', name: 'Allegro — main', platformType: 'allegro' }]),
      },
    });
    const inProgressCoverage: AnalyticsCoverage = {
      categories: [
        { category: 'currency', status: 'in-progress', affectedCount: 25, sampleOrderIds: [], activeRunId: 'ol_remrun_1' },
        { category: 'tax-a', status: 'open', affectedCount: 0, sampleOrderIds: [] },
        { category: 'tax-b', status: 'open', affectedCount: 0, sampleOrderIds: [] },
        { category: 'tax-c', status: 'open', affectedCount: 0, sampleOrderIds: [] },
        { category: 'product-matching', status: 'open', affectedCount: 0, sampleOrderIds: [] },
      ],
    };

    renderWithProviders(<ChannelSalesTable filters={FILTERS} coverage={inProgressCoverage} />, { apiClient });

    await screen.findByRole('link', { name: 'Allegro — main' });
    // The one channel row's Net sales + AOV cells — no Total row is emitted
    // here since nothing is stamped yet (groupChannelTotalsByCurrency's own
    // rule), so exactly 2 occurrences, never a bare "PLN 0.00".
    expect(screen.getAllByText('Recalculating…')).toHaveLength(2);
    expect(screen.queryByText(/0\.00/)).not.toBeInTheDocument();
  });

  it('converts per-channel Net sales/AOV and the Total row using the real headline rate (#2779 course correction)', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getSales: vi.fn().mockResolvedValue({
          ...analytics([channel({ netRevenue: 2700, netAverageOrderValue: 108, currency: 'PLN' })]),
          headline: {
            ...analytics([]).headline,
            currency: 'PLN',
            displayCurrencyConversion: {
              displayCurrency: 'EUR',
              rateBasis: 'current-rate',
              convertedRevenue: 1132.8,
              unresolvedNativeCurrencies: [],
              appliedRates: [
                {
                  from: 'PLN',
                  to: 'EUR',
                  rate: '0.236',
                  rateDate: '2026-08-29',
                  source: 'nbp',
                  derivation: 'direct',
                  sourceRef: '167/A/NBP/2026',
                },
              ],
            },
          },
        }),
      },
      connections: {
        list: vi.fn().mockResolvedValue([{ id: 'conn-1', name: 'Allegro — main', platformType: 'allegro' }]),
      },
    });

    renderWithProviders(<ChannelSalesTable filters={{ ...FILTERS, displayCurrency: 'EUR' }} />, { apiClient });

    await screen.findByRole('link', { name: 'Allegro — main' });
    // Channel row + Total row both read €637.20 (one channel), so 2 occurrences.
    expect(screen.getAllByText('€637.20')).toHaveLength(2); // Net sales: 2700 * 0.236
    expect(screen.getAllByText('€25.49')).toHaveLength(2); // AOV: 108 * 0.236
    expect(screen.getByText('Total · EUR')).toBeInTheDocument();
    expect(screen.queryByText(/^PLN /)).not.toBeInTheDocument();
  });
});

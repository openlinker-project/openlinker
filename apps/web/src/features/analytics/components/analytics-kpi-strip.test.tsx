import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { ConnectionIngestionTrust } from '../api/analytics-trust.types';
import type { SalesAndChannelAnalytics, SalesAnalyticsFilters } from '../api/sales-analytics.types';
import type { AnalyticsCoverage } from '../api/analytics-coverage.types';
import { AnalyticsKpiStrip } from './analytics-kpi-strip';

const FILTERS = { from: '2026-08-01', to: '2026-08-14' };

function coverage(overrides: Partial<Record<string, number>> = {}): AnalyticsCoverage {
  return {
    categories: [
      {
        category: 'currency',
        status: 'open',
        affectedCount: overrides.currency ?? 0,
        sampleOrderIds: [],
      },
      {
        category: 'tax-a',
        status: 'open',
        affectedCount: overrides['tax-a'] ?? 0,
        sampleOrderIds: [],
      },
      {
        category: 'tax-b',
        status: 'open',
        affectedCount: overrides['tax-b'] ?? 0,
        sampleOrderIds: [],
      },
      {
        category: 'tax-c',
        status: 'open',
        affectedCount: overrides['tax-c'] ?? 0,
        sampleOrderIds: [],
      },
      { category: 'product-matching', status: 'open', affectedCount: 0, sampleOrderIds: [] },
    ],
  };
}

function connectionWithEarliestOrder(earliestOrderDate: string | null): ConnectionIngestionTrust {
  return {
    connectionId: 'conn-1',
    connectionName: 'Allegro — main',
    platformType: 'allegro',
    connectionStatus: 'active',
    status: 'fresh',
    lastPollAt: null,
    lastOrderIngestedAt: null,
    connectionCreatedAt: '2020-01-01T00:00:00.000Z',
    earliestOrderDate,
    expectedIntervalMs: null,
    staleAfterMs: null,
  };
}

function analytics(
  overrides: Partial<SalesAndChannelAnalytics['headline']> = {}
): SalesAndChannelAnalytics {
  return {
    headline: {
      revenue: 4800,
      currency: 'PLN',
      orderCount: 40,
      averageOrderValue: 120,
      medianOrderValue: 100,
      unitsSold: 60,
      unconvertedUnitsSold: 0,
      cancelledCount: 2,
      cancelledValue: 200,
      cancelledUnconvertedCount: 0,
      cancelledUnconvertedValue: 0,
      unconvertedCount: 0,
      unconvertedValue: 0,
      unconvertedCurrency: null,
      netRevenue: 4200,
      netAverageOrderValue: 105,
      netMedianOrderValue: 90,
      netExcludedCount: 0,
      netExcludedValue: 0,
      trend: [],
      ...overrides,
    },
    channels: [],
  };
}

describe('AnalyticsKpiStrip', () => {
  it('should show a loading state before the query resolves', () => {
    const apiClient = createMockApiClient({
      analytics: { getSales: vi.fn(() => new Promise<SalesAndChannelAnalytics>(() => {})) },
    });

    renderWithProviders(<AnalyticsKpiStrip filters={FILTERS} connections={[]} />, { apiClient });

    expect(screen.getByText('Loading sales figures')).toBeInTheDocument();
  });

  it('should show an error state with a retry action when the request fails', async () => {
    const apiClient = createMockApiClient({
      analytics: { getSales: vi.fn().mockRejectedValue(new Error('boom')) },
    });

    renderWithProviders(<AnalyticsKpiStrip filters={FILTERS} connections={[]} />, { apiClient });

    expect(await screen.findByText('Unable to load sales figures')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('should render orders, order value and units in the reporting currency', async () => {
    const apiClient = createMockApiClient({
      analytics: { getSales: vi.fn().mockResolvedValue(analytics()) },
    });

    renderWithProviders(<AnalyticsKpiStrip filters={FILTERS} connections={[]} />, { apiClient });

    expect(await screen.findByText('40')).toBeInTheDocument();
    // AOV/Median render the GROSS headline fields (#2894) — same FX-stamped
    // order set as Number of Orders, not the VAT-exclusive net-eligible ones.
    expect(screen.getByText('PLN 120.00')).toBeInTheDocument();
    expect(screen.getByText('PLN 100.00')).toBeInTheDocument();
    expect(screen.getByText('60')).toBeInTheDocument();
    expect(screen.getByText('PLN 200.00')).toBeInTheDocument();
  });

  it('should render the gross AOV/Median fields when netGrossBasis is omitted (#2903 gross-mode regression)', async () => {
    // Byte-identical to the pre-#2895 rendering (#2894's own fix) — the
    // omitted prop must default to 'gross', never silently switch basis.
    const apiClient = createMockApiClient({
      analytics: { getSales: vi.fn().mockResolvedValue(analytics()) },
    });

    renderWithProviders(<AnalyticsKpiStrip filters={FILTERS} connections={[]} />, { apiClient });

    expect(await screen.findByText('PLN 120.00')).toBeInTheDocument(); // averageOrderValue
    expect(screen.getByText('PLN 100.00')).toBeInTheDocument(); // medianOrderValue
    expect(screen.queryByText('PLN 105.00')).not.toBeInTheDocument(); // netAverageOrderValue
    expect(screen.queryByText('PLN 90.00')).not.toBeInTheDocument(); // netMedianOrderValue
  });

  it('should render the net AOV/Median fields when netGrossBasis="net" (#2903)', async () => {
    const apiClient = createMockApiClient({
      analytics: { getSales: vi.fn().mockResolvedValue(analytics()) },
    });

    renderWithProviders(
      <AnalyticsKpiStrip filters={FILTERS} connections={[]} netGrossBasis="net" />,
      { apiClient }
    );

    expect(await screen.findByText('PLN 105.00')).toBeInTheDocument(); // netAverageOrderValue
    expect(screen.getByText('PLN 90.00')).toBeInTheDocument(); // netMedianOrderValue
    expect(screen.queryByText('PLN 120.00')).not.toBeInTheDocument(); // averageOrderValue
    expect(screen.queryByText('PLN 100.00')).not.toBeInTheDocument(); // medianOrderValue
  });

  it('should count unconverted-order units into Units sold and Units per order, matching the Orders card population', async () => {
    // 40 stamped orders + 10 unconverted = 50 total orders (same population
    // the Orders card renders, per `totalOrders = orderCount +
    // unconvertedCount`). Units must follow the same rule: a unit count
    // needs no currency conversion, so `unconvertedUnitsSold` must be added
    // in unconditionally rather than silently dropped (#2893).
    const apiClient = createMockApiClient({
      analytics: {
        getSales: vi.fn().mockResolvedValue(
          analytics({
            orderCount: 40,
            unconvertedCount: 10,
            unitsSold: 60,
            unconvertedUnitsSold: 15,
          })
        ),
      },
    });

    renderWithProviders(<AnalyticsKpiStrip filters={FILTERS} connections={[]} />, { apiClient });

    // Total orders: 40 + 10 = 50.
    expect(await screen.findByText('50')).toBeInTheDocument();
    // Total units sold: 60 + 15 = 75, never the FX-stamped-only 60.
    expect(screen.getByText('75')).toBeInTheDocument();
    expect(screen.queryByText('60')).not.toBeInTheDocument();
    // Units per order: 75 / 50 = 1.5.
    expect(screen.getByText('1.5')).toBeInTheDocument();
  });

  it('should label the sparklines with the actual selected range, not a hardcoded "last 7 days"', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getSales: vi.fn().mockResolvedValue(
          analytics({
            trend: [
              { date: '2026-08-01', revenue: 100, orderCount: 1 },
              { date: '2026-08-02', revenue: 200, orderCount: 2 },
            ],
          })
        ),
      },
    });

    renderWithProviders(<AnalyticsKpiStrip filters={FILTERS} connections={[]} />, { apiClient });

    // FILTERS spans 2026-08-01..2026-08-14 inclusive — 14 days, not 7.
    expect(await screen.findByLabelText('GMV trend, the last 14 days')).toBeInTheDocument();
    expect(screen.getByLabelText('Order count trend, the last 14 days')).toBeInTheDocument();
  });

  it('should render the cancellation rate, not the cancelled value, as the Cancellations headline', async () => {
    const apiClient = createMockApiClient({
      analytics: { getSales: vi.fn().mockResolvedValue(analytics()) },
    });

    renderWithProviders(<AnalyticsKpiStrip filters={FILTERS} connections={[]} />, { apiClient });

    // cancelledCount=2, totalOrders=40 (orderCount) + 0 (unconverted) → 2 / (40 + 2) = 4.8%
    expect(await screen.findByText('4.8%')).toBeInTheDocument();
    expect(screen.getByText('PLN 200.00')).toBeInTheDocument();
  });

  it('should disclose the FX-stamp gap when some placed orders have no stamp yet', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getSales: vi.fn().mockResolvedValue(analytics({ orderCount: 35, unconvertedCount: 5 })),
      },
    });

    renderWithProviders(<AnalyticsKpiStrip filters={FILTERS} connections={[]} />, { apiClient });

    expect(
      await screen.findAllByTitle(
        'Order value is computed only from orders an FX rate has been stamped onto — recently ingested, not-yet-stamped orders are excluded from this figure until the FX stamp sweep reaches them.'
      )
    ).not.toHaveLength(0);
    // Orders headline counts every placed order: 35 stamped + 5 unconverted = 40.
    expect(screen.getByText('40')).toBeInTheDocument();
  });

  it('should fall back to a bare number when nothing in range has been FX-stamped yet', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getSales: vi.fn().mockResolvedValue(
          analytics({
            revenue: 0,
            currency: null,
            orderCount: 0,
            averageOrderValue: 0,
            medianOrderValue: 17.5,
            netAverageOrderValue: 0,
            netMedianOrderValue: 17.5,
            unconvertedCount: 3,
            unconvertedValue: 450,
            unconvertedCurrency: 'EUR',
          })
        ),
      },
    });

    renderWithProviders(<AnalyticsKpiStrip filters={FILTERS} connections={[]} />, { apiClient });

    expect((await screen.findAllByText('0.00')).length).toBeGreaterThan(0);
    expect(screen.getByText('17.50')).toBeInTheDocument();
  });

  it('renders the real net-sales headline (net-sales tax-rate epic) and keeps Returns & refunds planned', async () => {
    const apiClient = createMockApiClient({
      analytics: { getSales: vi.fn().mockResolvedValue(analytics()) },
    });

    renderWithProviders(<AnalyticsKpiStrip filters={FILTERS} connections={[]} />, { apiClient });

    expect(await screen.findByText('Net sales')).toBeInTheDocument();
    expect(screen.getByLabelText('No return/refund entity exists yet')).toBeInTheDocument();
  });

  it('renders a period-over-period delta on the Orders card when the previous period is fully covered by history', async () => {
    const getSales = vi.fn((filters: SalesAnalyticsFilters) =>
      Promise.resolve(
        filters.from === FILTERS.from
          ? analytics({ orderCount: 40, unconvertedCount: 0 })
          : analytics({ orderCount: 20, unconvertedCount: 0 })
      )
    );
    const apiClient = createMockApiClient({ analytics: { getSales } });

    renderWithProviders(
      <AnalyticsKpiStrip
        filters={FILTERS}
        connections={[connectionWithEarliestOrder('2020-01-01T00:00:00.000Z')]}
      />,
      { apiClient }
    );

    // current totalOrders=40, previous totalOrders=20 → (40-20)/20*100 = 100.0%
    // (a count delta is relative "%", never "pp" — that's reserved for
    // rate deltas like Cancellation rate).
    expect(await screen.findByText('100.0%')).toBeInTheDocument();
    // Every card with a delta shares the same basis label — assert at least one renders it.
    expect(screen.getAllByText(/vs previous 14 days/).length).toBeGreaterThan(0);
    expect(getSales).toHaveBeenCalledTimes(2);
  });

  it('shows a not-enough-history GapMark instead of a delta when the previous period predates the earliest order', async () => {
    const apiClient = createMockApiClient({
      analytics: { getSales: vi.fn().mockResolvedValue(analytics({ orderCount: 40 })) },
    });

    // Earliest order is inside the naive previous-period window (2026-07-25),
    // so the previous period is only partially covered — delta must refuse.
    renderWithProviders(
      <AnalyticsKpiStrip
        filters={FILTERS}
        connections={[connectionWithEarliestOrder('2026-08-10T00:00:00.000Z')]}
      />,
      { apiClient }
    );

    await screen.findByText('40');
    expect(screen.queryByText(/pp$/)).not.toBeInTheDocument();
    expect(
      screen.getAllByTitle(/Not enough order history to compare a full previous period/).length
    ).toBeGreaterThan(0);
  });

  it('shows a no-history GapMark when no connection has ever ingested an order', async () => {
    const apiClient = createMockApiClient({
      analytics: { getSales: vi.fn().mockResolvedValue(analytics({ orderCount: 40 })) },
    });

    renderWithProviders(
      <AnalyticsKpiStrip filters={FILTERS} connections={[connectionWithEarliestOrder(null)]} />,
      { apiClient }
    );

    await screen.findByText('40');
    expect(
      screen.getAllByTitle('No order history yet — nothing to compare against.').length
    ).toBeGreaterThan(0);
  });

  // #2480 — GapMark becomes a real, category-specific, clickable affordance
  // once `coverage` + `onOpenCategory` are wired, instead of the generic
  // pre-Phase-8 tooltip-only text.
  describe('coverage-aware GapMarks (#2480)', () => {
    it('opens the currency category on the GMV GapMark when the currency row is genuinely open', async () => {
      const user = userEvent.setup();
      const onOpenCategory = vi.fn();
      const apiClient = createMockApiClient({
        analytics: { getSales: vi.fn().mockResolvedValue(analytics({ unconvertedCount: 5 })) },
      });

      renderWithProviders(
        <AnalyticsKpiStrip
          filters={FILTERS}
          connections={[]}
          coverage={coverage({ currency: 5 })}
          onOpenCategory={onOpenCategory}
        />,
        { apiClient }
      );

      // The same currency GapMark renders on BOTH the Revenue card's GMV
      // qualifier and the Order value card's Average qualifier — clicking
      // either must open the same 'currency' category.
      const buttons = await screen.findAllByRole('button', {
        name: 'The reporting currency changed — these orders are still tagged with the old one.',
      });
      expect(buttons).toHaveLength(2);
      await user.click(buttons[0]);

      expect(onOpenCategory).toHaveBeenCalledWith('currency');
    });

    it('picks the tax category with the LARGEST affectedCount for the Net Sales GapMark, never just tax-a', async () => {
      const user = userEvent.setup();
      const onOpenCategory = vi.fn();
      const apiClient = createMockApiClient({
        analytics: { getSales: vi.fn().mockResolvedValue(analytics({ netExcludedCount: 10 })) },
      });

      renderWithProviders(
        <AnalyticsKpiStrip
          filters={FILTERS}
          connections={[]}
          // tax-b (7) is the largest of the three — must win over tax-a/tax-c
          // despite tax-a being the "remediable" fallback category.
          coverage={coverage({ 'tax-a': 2, 'tax-b': 7, 'tax-c': 1 })}
          onOpenCategory={onOpenCategory}
        />,
        { apiClient }
      );

      const button = await screen.findByRole('button', {
        name: 'The product has no tax rate set at the source — fix it there, not here.',
      });
      await user.click(button);

      expect(onOpenCategory).toHaveBeenCalledWith('tax-b');
    });

    it('renders no Net Sales GapMark at all when netExcludedCount disagrees with a stale/zeroed coverage read', async () => {
      const onOpenCategory = vi.fn();
      const apiClient = createMockApiClient({
        analytics: { getSales: vi.fn().mockResolvedValue(analytics({ netExcludedCount: 5 })) },
      });

      renderWithProviders(
        <AnalyticsKpiStrip
          filters={FILTERS}
          connections={[]}
          // Every tax category reads 0 despite netExcludedCount > 0 — a data
          // mismatch. `resolveNetExcludedTaxCategory` must not paper over
          // that by pointing a clickable button at an empty category — the
          // component falls back to the plain, gap-mark-free "Net sales"
          // label instead (the caveat is still available in the info-tip
          // popover via the coverage-independent `netExcludedVisible` gate).
          coverage={coverage()}
          onOpenCategory={onOpenCategory}
        />,
        { apiClient }
      );

      await screen.findByText('Net sales');
      expect(
        screen.queryByTitle(
          '5 order(s) predate per-line tax rates or carry a line with an unresolvable rate, and are excluded from NOV.'
        )
      ).not.toBeInTheDocument();
      expect(onOpenCategory).not.toHaveBeenCalled();
    });
  });

  it('leaves every money figure in the native reporting currency when no rate resolves for it (ADR-064)', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getSales: vi.fn().mockResolvedValue(
          analytics({
            revenue: 1000,
            netRevenue: 900,
            averageOrderValue: 90,
            medianOrderValue: 85,
            cancelledValue: 50,
            displayCurrencyConversion: {
              displayCurrency: 'EUR',
              rateBasis: 'current-rate',
              // NOT `revenue * a plain rate` — in current-rate mode this is
              // revenue PLUS the separate unconverted bucket, both converted
              // and summed (see SalesAnalyticsController.
              // buildNativeCurrencyAmounts). Deriving a "rate" from this by
              // dividing by revenue is exactly the unsound shortcut this
              // test guards against reintroducing.
              convertedRevenue: 232.1,
              unresolvedNativeCurrencies: [],
              // No entry for PLN (headline.currency) — resolveReportingCurrencyRate
              // must return null here, so every other figure stays native.
              appliedRates: [],
            },
          })
        ),
      },
    });

    renderWithProviders(
      <AnalyticsKpiStrip filters={{ ...FILTERS, displayCurrency: 'EUR' }} connections={[]} />,
      { apiClient }
    );

    // GMV qualifier renders the backend's own convertedRevenue, verbatim.
    // EUR has a well-known symbol in Intl's default (en-US-shaped) locale,
    // unlike PLN elsewhere in this file, which renders as a bare "PLN 0.00".
    expect(await screen.findByText('€232.10')).toBeInTheDocument();
    // Every other money figure has no resolvable rate for its own native
    // currency (PLN) and MUST stay native — never a client-derived
    // approximation (see display-currency.lib.ts's "REJECTED APPROACH" note).
    expect(screen.getByText('PLN 900.00')).toBeInTheDocument(); // Net sales
    expect(screen.getByText('PLN 90.00')).toBeInTheDocument(); // AOV
    expect(screen.getByText('PLN 85.00')).toBeInTheDocument(); // Median
    expect(screen.getByText('PLN 50.00')).toBeInTheDocument(); // Cancelled value
  });

  it('converts every money figure using the real per-bucket rate for headline.currency (#2779 course correction)', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getSales: vi.fn().mockResolvedValue(
          analytics({
            revenue: 1000,
            netRevenue: 900,
            averageOrderValue: 90,
            medianOrderValue: 85,
            cancelledValue: 50,
            displayCurrencyConversion: {
              displayCurrency: 'EUR',
              rateBasis: 'current-rate',
              convertedRevenue: 236.0,
              unresolvedNativeCurrencies: [],
              // The one real rate the backend applied to the PLN bucket —
              // reused here for every other PLN-denominated figure, never
              // derived by dividing convertedRevenue by revenue.
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
          })
        ),
      },
    });

    renderWithProviders(
      <AnalyticsKpiStrip filters={{ ...FILTERS, displayCurrency: 'EUR' }} connections={[]} />,
      { apiClient }
    );

    expect(await screen.findByText('€236.00')).toBeInTheDocument(); // GMV, backend-converted verbatim
    expect(screen.getByText('€212.40')).toBeInTheDocument(); // Net sales: 900 * 0.236
    expect(screen.getByText('€21.24')).toBeInTheDocument(); // AOV: 90 * 0.236
    expect(screen.getByText('€20.06')).toBeInTheDocument(); // Median: 85 * 0.236
    expect(screen.getByText('€11.80')).toBeInTheDocument(); // Cancelled value: 50 * 0.236
    expect(screen.queryByText(/^PLN /)).not.toBeInTheDocument();
  });

  it('renders the inline rate provenance line under GMV when exactly one rate was applied (#2778/#2779 AC)', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getSales: vi.fn().mockResolvedValue(
          analytics({
            revenue: 1000,
            displayCurrencyConversion: {
              displayCurrency: 'EUR',
              rateBasis: 'current-rate',
              convertedRevenue: 232.1,
              unresolvedNativeCurrencies: [],
              appliedRates: [
                {
                  from: 'PLN',
                  to: 'EUR',
                  rate: '4.2368',
                  rateDate: '2026-08-29',
                  source: 'nbp',
                  derivation: 'direct',
                  sourceRef: '167/A/NBP/2026',
                },
              ],
            },
          })
        ),
      },
    });

    renderWithProviders(
      <AnalyticsKpiStrip filters={{ ...FILTERS, displayCurrency: 'EUR' }} connections={[]} />,
      { apiClient }
    );

    expect(await screen.findByText('€232.10')).toBeInTheDocument();
    expect(screen.getByText('1 PLN = 4.2368 EUR (NBP, 2026-08-29)')).toBeInTheDocument();
  });

  it('opens a disclosure stating derivation, sourceRef, and that this is not an invoice rate', async () => {
    const user = userEvent.setup();
    const apiClient = createMockApiClient({
      analytics: {
        getSales: vi.fn().mockResolvedValue(
          analytics({
            revenue: 1000,
            displayCurrencyConversion: {
              displayCurrency: 'EUR',
              rateBasis: 'order-date',
              convertedRevenue: 232.1,
              unresolvedNativeCurrencies: [],
              appliedRates: [
                {
                  from: 'PLN',
                  to: 'EUR',
                  rate: '4.2368',
                  rateDate: '2026-08-29',
                  source: 'nbp',
                  derivation: 'inverted',
                  sourceRef: null,
                },
              ],
            },
          })
        ),
      },
    });

    renderWithProviders(
      <AnalyticsKpiStrip
        filters={{ ...FILTERS, displayCurrency: 'EUR', rateBasis: 'order-date' }}
        connections={[]}
      />,
      { apiClient }
    );

    await screen.findByText('€232.10');
    await user.click(screen.getByRole('button', { name: 'About this conversion' }));

    expect(screen.getByText(/whole period's total/)).toBeInTheDocument();
    expect(screen.getByText('Derived (inverted)')).toBeInTheDocument();
    expect(screen.getByText(/never the statutory rate used on an invoice/)).toBeInTheDocument();
  });

  it('renders no rate line for an unresolved conversion — the existing unavailable copy still owns that state', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getSales: vi.fn().mockResolvedValue(
          analytics({
            revenue: 1000,
            displayCurrencyConversion: {
              displayCurrency: 'EUR',
              rateBasis: 'current-rate',
              convertedRevenue: null,
              unresolvedNativeCurrencies: ['PLN'],
              appliedRates: [],
            },
          })
        ),
      },
    });

    renderWithProviders(
      <AnalyticsKpiStrip filters={{ ...FILTERS, displayCurrency: 'EUR' }} connections={[]} />,
      { apiClient }
    );

    await screen.findByText('PLN 1,000.00');
    expect(screen.queryByRole('button', { name: 'About this conversion' })).not.toBeInTheDocument();
    expect(screen.queryByText(/^1 .* = /)).not.toBeInTheDocument();
  });

  it('renders no provenance line and no layout change when displayCurrency is omitted (regression)', async () => {
    const apiClient = createMockApiClient({
      analytics: { getSales: vi.fn().mockResolvedValue(analytics({ revenue: 1000 })) },
    });

    renderWithProviders(<AnalyticsKpiStrip filters={FILTERS} connections={[]} />, { apiClient });

    await screen.findByText('PLN 1,000.00');
    expect(screen.queryByRole('button', { name: 'About this conversion' })).not.toBeInTheDocument();
  });

  it('shows "Recalculating…" instead of a bare 0 while a currency remediation run is in progress', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        // Everything reads 0/unconverted while the recalculation is mid-run —
        // exactly the state that used to render as a flat "0.00" with no
        // explanation.
        getSales: vi.fn().mockResolvedValue(
          analytics({
            revenue: 0,
            currency: null,
            averageOrderValue: 0,
            medianOrderValue: 0,
            netRevenue: 0,
            netAverageOrderValue: 0,
            netMedianOrderValue: 0,
            cancelledValue: 0,
            unconvertedCount: 40,
            unconvertedValue: 4800,
            unconvertedCurrency: 'PLN',
          })
        ),
      },
    });
    const inProgressCoverage: AnalyticsCoverage = {
      categories: [
        {
          category: 'currency',
          status: 'in-progress',
          affectedCount: 40,
          sampleOrderIds: [],
          activeRunId: 'ol_remrun_1',
        },
        { category: 'tax-a', status: 'open', affectedCount: 0, sampleOrderIds: [] },
        { category: 'tax-b', status: 'open', affectedCount: 0, sampleOrderIds: [] },
        { category: 'tax-c', status: 'open', affectedCount: 0, sampleOrderIds: [] },
        { category: 'product-matching', status: 'open', affectedCount: 0, sampleOrderIds: [] },
      ],
    };

    renderWithProviders(
      <AnalyticsKpiStrip filters={FILTERS} connections={[]} coverage={inProgressCoverage} />,
      { apiClient }
    );

    // 5 figures go through RECALCULATING_NODE: Net sales, GMV, AOV, Median,
    // Cancelled value — never a bare "0.00" while a run is genuinely in flight.
    expect((await screen.findAllByText('Recalculating…')).length).toBe(5);
    expect(screen.queryByText('PLN 0.00')).not.toBeInTheDocument();
  });
});

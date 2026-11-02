import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type {
  MarginAnalytics,
  MarginFigures,
  MarginProductsResult,
} from '../api/margin-analytics.types';
import { MarginPanel } from './margin-panel';

const FILTERS = { from: '2026-08-01', to: '2026-08-31' };

function figures(overrides: Partial<MarginFigures> = {}): MarginFigures {
  return {
    netRevenue: 1000,
    coveredNetRevenue: 800,
    costOfGoods: 480,
    grossMargin: 320,
    marginPct: 0.4,
    costCoveragePct: 0.8,
    gaps: [
      { reason: 'no-cost', lineCount: 12, netAmount: 150 },
      { reason: 'cost-entered-after-sale', lineCount: 3, netAmount: 50 },
      { reason: 'no-variant', lineCount: 0, netAmount: 0 },
      { reason: 'currency-mismatch', lineCount: 0, netAmount: 0 },
    ],
    ...overrides,
  };
}

function margin(overrides: Partial<MarginAnalytics> = {}): MarginAnalytics {
  return {
    currency: 'PLN',
    bucket: 'week',
    headline: figures(),
    trend: [
      { date: '2026-08-03', ...figures() },
      { date: '2026-08-10', ...figures({ marginPct: null, grossMargin: 0, coveredNetRevenue: 0 }) },
    ],
    channels: [{ sourceConnectionId: 'conn-a', revenueShare: 1, ...figures() }],
    excludedLineCount: 0,
    ...overrides,
  };
}

function products(): MarginProductsResult {
  return {
    currency: 'PLN',
    total: 2,
    unresolvedProductCount: 0,
    items: [
      { productId: 'p1', name: 'Mug', sku: 'MUG-1', ...figures() },
      {
        productId: 'p2',
        name: 'Plate',
        sku: 'PLT-1',
        ...figures({
          coveredNetRevenue: 0,
          costOfGoods: 0,
          grossMargin: 0,
          marginPct: null,
          costCoveragePct: 0,
        }),
      },
    ],
  };
}

function render(
  getMargin: unknown,
  getMarginProducts: unknown = vi.fn().mockResolvedValue(products())
): void {
  const apiClient = createMockApiClient({
    analytics: {
      getMargin: getMargin as never,
      getMarginProducts: getMarginProducts as never,
    },
    connections: { list: vi.fn().mockResolvedValue([]) },
  });
  renderWithProviders(<MarginPanel filters={FILTERS} pageBasis="gross" />, { apiClient });
}

describe('MarginPanel (#3588)', () => {
  it('should render the net-basis note, the four KPIs and both tables when costs exist', async () => {
    render(vi.fn().mockResolvedValue(margin()));

    expect(await screen.findByTestId('margin-kpi-margin')).toBeInTheDocument();
    expect(screen.getByText('Net revenue · VAT-exclusive')).toBeInTheDocument();
    expect(screen.getByText(/even though this page is set to Gross/)).toBeInTheDocument();
    expect(within(screen.getByTestId('margin-kpi-margin-pct')).getByText('40.0%')).toBeInTheDocument();
    expect(screen.getByTestId('margin-by-channel-table')).toBeInTheDocument();
    expect(await screen.findByTestId('margin-product-row-mug-1')).toBeInTheDocument();
    expect(screen.getByTestId('margin-trend')).toBeInTheDocument();
  });

  it('should show an absent value, never 0%, when margin % has no covered revenue', async () => {
    render(
      vi.fn().mockResolvedValue(
        margin({
          headline: figures({
            coveredNetRevenue: 0,
            costOfGoods: 0,
            grossMargin: 0,
            marginPct: null,
            gaps: [{ reason: 'cost-entered-after-sale', lineCount: 4, netAmount: 100 }],
          }),
        })
      )
    );

    const card = await screen.findByTestId('margin-kpi-margin-pct');
    expect(card).not.toHaveTextContent('0%');
    expect(
      within(card).getByLabelText('Margin % needs at least one line with a cost')
    ).toBeInTheDocument();
  });

  it('should expand the coverage chip into the reasons table', async () => {
    render(vi.fn().mockResolvedValue(margin()));

    const toggle = await screen.findByTestId('margin-coverage-toggle');
    expect(toggle).toHaveTextContent('15 lines are not in margin');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const details = screen.getByTestId('margin-coverage-details');
    expect(details).toBeVisible();
    expect(within(details).getByText('No cost recorded for the variant')).toBeInTheDocument();
    expect(within(details).getByText('Ordered before the cost was entered')).toBeInTheDocument();
    expect(within(details).queryByText(/matched to a product variant/)).not.toBeInTheDocument();
  });

  it('should flag a product with no covered revenue and link to its page to add a cost', async () => {
    render(vi.fn().mockResolvedValue(margin()));

    const row = await screen.findByTestId('margin-product-row-plt-1');
    expect(within(row).getByText('No cost recorded')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Add cost' })).toHaveAttribute(
      'href',
      '/products/p2'
    );
  });

  it('should render the missing-cost empty state with the best sellers lacking a cost', async () => {
    const noCost = figures({
      coveredNetRevenue: 0,
      costOfGoods: 0,
      grossMargin: 0,
      marginPct: null,
      costCoveragePct: 0,
      gaps: [
        { reason: 'no-cost', lineCount: 20, netAmount: 1000 },
        { reason: 'cost-entered-after-sale', lineCount: 0, netAmount: 0 },
        { reason: 'no-variant', lineCount: 0, netAmount: 0 },
        { reason: 'currency-mismatch', lineCount: 0, netAmount: 0 },
      ],
    });
    render(
      vi.fn().mockResolvedValue(margin({ headline: noCost, trend: [], channels: [] })),
      vi.fn().mockResolvedValue({
        currency: 'PLN',
        total: 1,
        unresolvedProductCount: 0,
        items: [{ productId: 'p1', name: 'Mug', sku: 'MUG-1', ...noCost }],
      })
    );

    expect(await screen.findByTestId('margin-missing-cost-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('margin-kpi-margin')).not.toBeInTheDocument();
    expect(await screen.findByTestId('margin-missing-cost-list')).toBeInTheDocument();
    expect(screen.getByTestId('margin-add-cost-link-mug-1')).toBeInTheDocument();
    expect(screen.getByTestId('export-csv-margin-channel')).toBeDisabled();
  });

  it('should not claim "no cost" for a range that simply has no sales', async () => {
    render(
      vi.fn().mockResolvedValue(
        margin({
          headline: figures({
            netRevenue: 0,
            coveredNetRevenue: 0,
            costOfGoods: 0,
            grossMargin: 0,
            marginPct: null,
            costCoveragePct: null,
            gaps: [],
          }),
          trend: [],
          channels: [],
        })
      )
    );

    expect(await screen.findByTestId('margin-kpi-net-revenue')).toBeInTheDocument();
    expect(screen.queryByTestId('margin-missing-cost-empty')).not.toBeInTheDocument();
  });
});

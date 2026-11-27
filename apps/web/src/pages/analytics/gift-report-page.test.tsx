import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GiftReportPage } from './gift-report-page';
import { createMockApiClient, renderWithProviders } from '../../test/test-utils';

const GROUP = {
  key: 'rule:r1|v1|PLN',
  giftSource: 'ol-rule',
  ruleRef: 'r1',
  ruleName: 'Spoon promotion',
  productId: 'p1',
  variantId: 'v1',
  sku: 'SPOON',
  name: 'Spoon',
  currency: 'PLN',
  units: 40,
  orders: 34,
  paidGross: 0,
  costNet: 156,
  unknownCostUnits: 0,
  sourceConnectionIds: ['c1'],
};

const SERIES = [
  {
    currency: 'PLN',
    granularity: 'week',
    points: [
      { start: '2026-10-01T00:00:00.000Z', costNet: 100, units: 20, unknownCostUnits: 0, partial: false },
      { start: '2026-10-08T00:00:00.000Z', costNet: 56, units: 20, unknownCostUnits: 0, partial: true },
    ],
  },
];

function renderPage(
  report: unknown,
  extra: Record<string, unknown> = {},
): { getGiftReport: ReturnType<typeof vi.fn>; exportCsv: ReturnType<typeof vi.fn> } {
  const getGiftReport = vi.fn().mockResolvedValue(report);
  const exportCsv = vi.fn().mockResolvedValue({ blob: new Blob(['x']), filename: 'gifts.csv' });
  renderWithProviders(<GiftReportPage />, {
    apiClient: createMockApiClient({
      giftReport: { getGiftReport, ...extra },
      analytics: { exportCsv },
    }),
    route: '/analytics/gifts?from=2026-10-01&to=2026-10-31',
  });
  return { getGiftReport, exportCsv };
}

describe('GiftReportPage', () => {
  it('should show what the gifts cost and the units, by promotion', async () => {
    renderPage({
      groups: [GROUP],
      totals: [{ currency: 'PLN', orders: 34, units: 40, paidGross: 0, costNet: 156, unknownCostUnits: 0 }],
      series: SERIES,
    });

    expect(await screen.findByTestId('gift-report-total-units')).toHaveTextContent('40');
    expect(screen.getByTestId('gift-report-total-cost')).toHaveTextContent('156');
    expect(screen.getByText('Spoon promotion')).toBeInTheDocument();
    expect(screen.queryByTestId('gift-report-unknown-alert')).toBeNull();
  });

  it('should say gifts without a purchase cost are not in the amount', async () => {
    renderPage({
      groups: [{ ...GROUP, units: 5, unknownCostUnits: 5, costNet: 0, key: 'k2' }],
      totals: [{ currency: 'PLN', orders: 5, units: 5, paidGross: 0, costNet: 0, unknownCostUnits: 5 }],
      series: [],
    });

    expect(await screen.findByTestId('gift-report-unknown-alert')).toBeInTheDocument();
    expect(screen.getByTestId('gift-report-cost-k2-unknown')).toBeInTheDocument();
  });

  it('should show the empty state when no order carried a gift', async () => {
    renderPage({ groups: [], totals: [], series: [] });

    expect(await screen.findByTestId('gift-report-empty')).toBeInTheDocument();
  });

  it('should request the per-customer export for the chosen range', async () => {
    const { exportCsv } = renderPage({ groups: [], totals: [], series: [] });

    await userEvent.click(await screen.findByTestId('gift-report-export'));
    await userEvent.click(screen.getByTestId('gift-report-export-download'));

    await waitFor(() =>
      expect(exportCsv).toHaveBeenCalledWith(
        expect.objectContaining({
          report: 'gifts-customer',
          filters: expect.objectContaining({ from: '2026-10-01', to: '2026-10-31' }),
        })
      )
    );
  });

  it('should draw the cost over time with the open week marked', async () => {
    renderPage({
      groups: [GROUP],
      totals: [{ currency: 'PLN', orders: 34, units: 40, paidGross: 0, costNet: 156, unknownCostUnits: 0 }],
      series: SERIES,
    });

    const chart = await screen.findByTestId('gift-report-chart');
    expect(chart.querySelectorAll('.gift-bar')).toHaveLength(2);
    expect(chart.querySelectorAll('.gift-bar.is-part')).toHaveLength(1);
  });

  it('should regroup the table by gift product', async () => {
    renderPage({
      groups: [GROUP, { ...GROUP, key: 'manual|v1|PLN', giftSource: 'operator', ruleRef: null, units: 2, orders: 2, costNet: 8 }],
      totals: [{ currency: 'PLN', orders: 36, units: 42, paidGross: 0, costNet: 164, unknownCostUnits: 0 }],
      series: SERIES,
    });

    await userEvent.click(await screen.findByTestId('gift-report-by-product'));

    const table = await screen.findByTestId('gift-report-product-table');
    expect(table).toHaveTextContent('Spoon');
    expect(table.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('should not fetch the gift cost report while the bundles view is open', async () => {
    const getGiftReport = vi.fn().mockResolvedValue({ groups: [], totals: [], series: [] });
    const getGiftBundleReport = vi.fn().mockResolvedValue({ bundles: [], demand: [] });
    renderWithProviders(<GiftReportPage />, {
      apiClient: createMockApiClient({
        giftReport: { getGiftReport, getGiftBundleReport },
      }),
      route: '/analytics/gifts?from=2026-10-01&to=2026-10-31&view=bundles',
    });

    expect(await screen.findByTestId('gift-report-bundle-empty')).toBeInTheDocument();
    expect(getGiftReport).not.toHaveBeenCalled();
  });
});

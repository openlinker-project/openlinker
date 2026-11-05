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
};

function renderPage(report: unknown, extra: Record<string, unknown> = {}) {
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
      totals: [{ currency: 'PLN', units: 40, paidGross: 0, costNet: 156, unknownCostUnits: 0 }],
    });

    expect(await screen.findByTestId('gift-report-total-units')).toHaveTextContent('40');
    expect(screen.getByTestId('gift-report-total-cost')).toHaveTextContent('156');
    expect(screen.getByText('Spoon promotion')).toBeInTheDocument();
    expect(screen.queryByTestId('gift-report-unknown-alert')).toBeNull();
  });

  it('should say gifts without a purchase cost are not in the amount', async () => {
    renderPage({
      groups: [{ ...GROUP, units: 5, unknownCostUnits: 5, costNet: 0, key: 'k2' }],
      totals: [{ currency: 'PLN', units: 5, paidGross: 0, costNet: 0, unknownCostUnits: 5 }],
    });

    expect(await screen.findByTestId('gift-report-unknown-alert')).toBeInTheDocument();
    expect(screen.getByTestId('gift-report-cost-unknown-badge-k2')).toBeInTheDocument();
  });

  it('should show the empty state when no order carried a gift', async () => {
    renderPage({ groups: [], totals: [] });

    expect(await screen.findByTestId('gift-report-empty')).toBeInTheDocument();
  });

  it('should request the per-customer export for the chosen range', async () => {
    const { exportCsv } = renderPage({ groups: [], totals: [] });

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
});

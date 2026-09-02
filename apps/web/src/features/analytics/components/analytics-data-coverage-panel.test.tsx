import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  renderWithProviders,
  createMockApiClient,
  createAuthenticatedSessionAdapter,
} from '../../../test/test-utils';
import { AnalyticsDataCoveragePanel } from './analytics-data-coverage-panel';
import { ApiError } from '../../../shared/api/api-error';
import type { AnalyticsCoverage } from '../api/analytics-coverage.types';

const FILTERS = { from: '2026-08-01T00:00:00.000Z', to: '2026-08-27T00:00:00.000Z' };

function coverage(overrides: Partial<AnalyticsCoverage> = {}): AnalyticsCoverage {
  return {
    categories: [
      { category: 'currency', status: 'open', affectedCount: 0, sampleOrderIds: [] },
      { category: 'tax-a', status: 'open', affectedCount: 0, sampleOrderIds: [] },
      { category: 'tax-b', status: 'open', affectedCount: 0, sampleOrderIds: [] },
      { category: 'tax-c', status: 'open', affectedCount: 0, sampleOrderIds: [] },
      { category: 'product-matching', status: 'open', affectedCount: 0, sampleOrderIds: [] },
    ],
    ...overrides,
  };
}

describe('AnalyticsDataCoveragePanel (#2474)', () => {
  it('should show the loading state before the coverage aggregate resolves', () => {
    const apiClient = createMockApiClient({
      analytics: { getCoverage: vi.fn(() => new Promise<AnalyticsCoverage>(() => {})) },
    });

    renderWithProviders(<AnalyticsDataCoveragePanel filters={FILTERS} onOpenSettings={() => {}} />, { apiClient });

    expect(screen.getByText('Checking data coverage')).toBeInTheDocument();
  });

  it('should render the all-clear line when every category is empty', async () => {
    const apiClient = createMockApiClient({
      analytics: { getCoverage: vi.fn().mockResolvedValue(coverage()) },
    });

    renderWithProviders(<AnalyticsDataCoveragePanel filters={FILTERS} onOpenSettings={() => {}} />, { apiClient });

    expect(await screen.findByText('Nothing to do')).toBeInTheDocument();
    expect(screen.getByText('5 checks · currency, tax rates, product matching')).toBeInTheDocument();
  });

  it('should render one human-language row per open category, never a raw enum value', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getCoverage: vi.fn().mockResolvedValue(
          coverage({
            categories: [
              { category: 'currency', status: 'open', affectedCount: 23, sampleOrderIds: [] },
              { category: 'tax-a', status: 'open', affectedCount: 18, sampleOrderIds: [] },
              { category: 'tax-b', status: 'open', affectedCount: 7, sampleOrderIds: [] },
              { category: 'tax-c', status: 'open', affectedCount: 2, sampleOrderIds: [] },
              { category: 'product-matching', status: 'open', affectedCount: 4, sampleOrderIds: [] },
            ],
          })
        ),
      },
    });

    renderWithProviders(<AnalyticsDataCoveragePanel filters={FILTERS} onOpenSettings={() => {}} />, { apiClient });

    expect(await screen.findByText('23 orders counted in an outdated currency')).toBeInTheDocument();
    expect(screen.getByText('18 orders have an unconfirmed tax rate')).toBeInTheDocument();
    expect(screen.getByText('7 orders have no tax rate at all')).toBeInTheDocument();
    expect(screen.getByText('2 orders — rate not yet resolved')).toBeInTheDocument();
    expect(screen.getByText('4 orders with a product-matching error')).toBeInTheDocument();

    // Regression guard (mini-epic AC): no raw backend enum value ever reaches the DOM.
    expect(screen.queryByText(/pre-rollout/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/awaiting_mapping/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/source_deleted/i)).not.toBeInTheDocument();
    // Regression guard: country-agnostic wording only.
    expect(screen.queryByText(/VAT/)).not.toBeInTheDocument();
  });

  it('should open the currency detail modal with real pagination, not a "View more" link', async () => {
    const user = userEvent.setup();
    const apiClient = createMockApiClient({
      analytics: {
        getCoverage: vi.fn().mockResolvedValue(
          coverage({
            categories: [
              { category: 'currency', status: 'open', affectedCount: 23, sampleOrderIds: [] },
              { category: 'tax-a', status: 'open', affectedCount: 0, sampleOrderIds: [] },
              { category: 'tax-b', status: 'open', affectedCount: 0, sampleOrderIds: [] },
              { category: 'tax-c', status: 'open', affectedCount: 0, sampleOrderIds: [] },
              { category: 'product-matching', status: 'open', affectedCount: 0, sampleOrderIds: [] },
            ],
          })
        ),
        getCurrencyMismatchOrders: vi.fn().mockResolvedValue({
          items: [
            {
              internalOrderId: 'ol_order_abc12345',
              sourceConnectionId: 'conn-1',
              nativeCurrency: 'EUR',
              stampedCurrency: 'EUR',
              stampedAt: '2026-08-18T00:00:00.000Z',
            },
          ],
          total: 23,
        }),
      },
    });

    renderWithProviders(<AnalyticsDataCoveragePanel filters={FILTERS} onOpenSettings={() => {}} />, { apiClient });

    await user.click(await screen.findByText('23 orders counted in an outdated currency'));

    expect(await screen.findByText('Showing 1–10 of 23')).toBeInTheDocument();
    expect(screen.queryByText(/view more/i)).not.toBeInTheDocument();
  });

  it('should render each row\'s own per-line rate in the tax detail modal, never one hardcoded value shared across rows (#2798)', async () => {
    const user = userEvent.setup();
    const apiClient = createMockApiClient({
      analytics: {
        getCoverage: vi.fn().mockResolvedValue(
          coverage({
            categories: [
              { category: 'currency', status: 'open', affectedCount: 0, sampleOrderIds: [] },
              { category: 'tax-a', status: 'open', affectedCount: 2, sampleOrderIds: [] },
              { category: 'tax-b', status: 'open', affectedCount: 0, sampleOrderIds: [] },
              { category: 'tax-c', status: 'open', affectedCount: 0, sampleOrderIds: [] },
              { category: 'product-matching', status: 'open', affectedCount: 0, sampleOrderIds: [] },
            ],
          })
        ),
        getTaxCoverageOrders: vi.fn().mockResolvedValue({
          items: [
            {
              internalOrderId: 'ol_order_mixed_1',
              sourceConnectionId: 'conn-1',
              placedAt: '2026-08-18T00:00:00.000Z',
              lineRates: [
                { productId: 'p1', variantId: null, rateCode: '23', state: 'known' },
                { productId: 'p2', variantId: 'v2', rateCode: '8', state: 'known' },
              ],
            },
            {
              internalOrderId: 'ol_order_mixed_2',
              sourceConnectionId: 'conn-1',
              placedAt: '2026-08-19T00:00:00.000Z',
              lineRates: [{ productId: 'p3', variantId: null, rateCode: '5', state: 'known' }],
            },
          ],
          total: 2,
        }),
      },
    });

    renderWithProviders(<AnalyticsDataCoveragePanel filters={FILTERS} onOpenSettings={() => {}} />, { apiClient });

    await user.click(await screen.findByText('2 orders have an unconfirmed tax rate'));

    expect(await screen.findByText('23%')).toBeInTheDocument();
    expect(screen.getByText('8%')).toBeInTheDocument();
    expect(screen.getByText('5%')).toBeInTheDocument();
    // Never a single shared value duplicated across every row.
    expect(screen.queryAllByText('23%')).toHaveLength(1);
  });

  it('should transition the currency row through a "Fixed — closing…" sub-state driven by the real run status, then show the dismissible coverage-alert', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    const apiClient = createMockApiClient({
      analytics: {
        getCoverage: vi.fn().mockResolvedValue(
          coverage({
            categories: [
              { category: 'currency', status: 'open', affectedCount: 5, sampleOrderIds: [] },
              { category: 'tax-a', status: 'open', affectedCount: 0, sampleOrderIds: [] },
              { category: 'tax-b', status: 'open', affectedCount: 0, sampleOrderIds: [] },
              { category: 'tax-c', status: 'open', affectedCount: 0, sampleOrderIds: [] },
              { category: 'product-matching', status: 'open', affectedCount: 0, sampleOrderIds: [] },
            ],
          })
        ),
        getCurrencyMismatchOrders: vi.fn().mockResolvedValue({ items: [], total: 5 }),
        recalculateCurrency: vi.fn().mockResolvedValue({
          id: 'ol_remrun_1',
          category: 'currency',
          status: 'in-progress',
          detail: null,
          affectedCount: 5,
          triggeredByUserId: 'user-1',
          createdAt: '2026-08-26T09:00:00.000Z',
          updatedAt: '2026-08-26T09:00:00.000Z',
        }),
        getCurrencyRemediationStatus: vi.fn().mockResolvedValue({
          id: 'ol_remrun_1',
          category: 'currency',
          status: 'resolved',
          detail: null,
          affectedCount: 5,
          triggeredByUserId: 'user-1',
          createdAt: '2026-08-26T09:00:00.000Z',
          updatedAt: '2026-08-26T09:00:05.000Z',
        }),
      },
    });

    renderWithProviders(<AnalyticsDataCoveragePanel filters={FILTERS} onOpenSettings={() => {}} />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await user.click(await screen.findByText('5 orders counted in an outdated currency'));
    await user.click(await screen.findByText('Recalculate all 5 now'));

    expect(await screen.findByText('Recalculated and saved — closing…')).toBeInTheDocument();

    await waitFor(
      () => expect(screen.getByText('Recalculation finished for the 5 orders you selected')).toBeInTheDocument(),
      {
        timeout: 5000,
      }
    );

    await user.click(screen.getByLabelText('Dismiss'));
    expect(
      screen.queryByText('Recalculation finished for the 5 orders you selected')
    ).not.toBeInTheDocument();

    vi.useRealTimers();
  });

  it('should offer "Cancel stuck run" when recalculate answers 409, and clear it once cancelled (#2816)', async () => {
    const user = userEvent.setup();
    const cancelStuckCurrencyRun = vi.fn().mockResolvedValue({
      id: 'ol_remrun_1',
      category: 'currency',
      status: 'failed',
      detail: 'Cancelled by operator - previous attempt did not resolve',
      affectedCount: 5,
      triggeredByUserId: 'user-1',
      createdAt: '2026-08-26T09:00:00.000Z',
      updatedAt: '2026-08-26T09:00:05.000Z',
    });
    const apiClient = createMockApiClient({
      analytics: {
        getCoverage: vi.fn().mockResolvedValue(
          coverage({
            categories: [
              { category: 'currency', status: 'open', affectedCount: 5, sampleOrderIds: [] },
              { category: 'tax-a', status: 'open', affectedCount: 0, sampleOrderIds: [] },
              { category: 'tax-b', status: 'open', affectedCount: 0, sampleOrderIds: [] },
              { category: 'tax-c', status: 'open', affectedCount: 0, sampleOrderIds: [] },
              { category: 'product-matching', status: 'open', affectedCount: 0, sampleOrderIds: [] },
            ],
          })
        ),
        getCurrencyMismatchOrders: vi.fn().mockResolvedValue({ items: [], total: 5 }),
        recalculateCurrency: vi
          .fn()
          .mockRejectedValue(
            new ApiError('A currency recalculation is already in progress', 409, {
              message: 'A currency recalculation is already in progress',
            })
          ),
        cancelStuckCurrencyRun,
      },
    });

    renderWithProviders(<AnalyticsDataCoveragePanel filters={FILTERS} onOpenSettings={() => {}} />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await user.click(await screen.findByText('5 orders counted in an outdated currency'));
    await user.click(await screen.findByText('Recalculate all 5 now'));

    expect(await screen.findByText("Recalculation didn't start")).toBeInTheDocument();
    const cancelButton = await screen.findByText('Cancel stuck run');

    await user.click(cancelButton);

    expect(cancelStuckCurrencyRun).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByText("Recalculation didn't start")).not.toBeInTheDocument()
    );
  });

  describe('admin-only write affordances (tech-review finding)', () => {
    // POST /analytics/coverage/currency/recalculate and
    // POST /analytics/coverage/tax/rerun-backfill are @Roles('admin')-gated
    // server-side — neither action must render as a live, clickable
    // control for a session that would just get a 403.
    const viewerSession = {
      sessionAdapter: createAuthenticatedSessionAdapter({
        id: 'u2',
        username: 'viewer',
        email: null,
        role: 'viewer',
        permissions: ['orders:read'],
      }),
    };

    function apiClientWithOpenCurrencyAndTaxC(): ReturnType<typeof createMockApiClient> {
      return createMockApiClient({
        analytics: {
          getCoverage: vi.fn().mockResolvedValue(
            coverage({
              categories: [
                { category: 'currency', status: 'open', affectedCount: 5, sampleOrderIds: [] },
                { category: 'tax-a', status: 'open', affectedCount: 0, sampleOrderIds: [] },
                { category: 'tax-b', status: 'open', affectedCount: 0, sampleOrderIds: [] },
                { category: 'tax-c', status: 'open', affectedCount: 2, sampleOrderIds: [] },
                { category: 'product-matching', status: 'open', affectedCount: 0, sampleOrderIds: [] },
              ],
            })
          ),
          getCurrencyMismatchOrders: vi.fn().mockResolvedValue({ items: [], total: 5 }),
          getTaxCoverageOrders: vi.fn().mockResolvedValue({
            items: [
              { internalOrderId: 'ol_order_a', sourceConnectionId: 'conn-1', placedAt: null, lineRates: [] },
            ],
            total: 2,
          }),
        },
      });
    }

    it('should hide "Recalculate now" and "Sync the catalog" for a non-admin, non-demo session', async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <AnalyticsDataCoveragePanel filters={FILTERS} onOpenSettings={() => {}} />,
        { apiClient: apiClientWithOpenCurrencyAndTaxC(), ...viewerSession }
      );

      await user.click(await screen.findByText('5 orders counted in an outdated currency'));
      await screen.findByText('Close');
      expect(screen.queryByRole('button', { name: /Recalculate all/ })).not.toBeInTheDocument();
      await user.click(screen.getByText('Close'));

      await user.click(await screen.findByText('2 orders — rate not yet resolved'));
      await screen.findByText('Close');
      expect(screen.queryByRole('button', { name: /Sync the catalog/ })).not.toBeInTheDocument();
    });

    it('should render both admin-only actions visible-but-disabled for a demo read-only viewer', async () => {
      const user = userEvent.setup();
      const apiClient = createMockApiClient({
        ...apiClientWithOpenCurrencyAndTaxC(),
        system: { getConfig: vi.fn().mockResolvedValue({ demoMode: true }) },
      });

      renderWithProviders(<AnalyticsDataCoveragePanel filters={FILTERS} onOpenSettings={() => {}} />, {
        apiClient,
        ...viewerSession,
      });

      await user.click(await screen.findByText('5 orders counted in an outdated currency'));
      expect(await screen.findByRole('button', { name: /Recalculate all/ })).toBeDisabled();
      await user.click(screen.getByText('Close'));

      await user.click(await screen.findByText('2 orders — rate not yet resolved'));
      expect(await screen.findByRole('button', { name: /Sync the catalog/ })).toBeDisabled();
    });
  });
});

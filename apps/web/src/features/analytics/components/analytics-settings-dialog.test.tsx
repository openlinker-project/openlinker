import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  renderWithProviders,
  createMockApiClient,
  createAuthenticatedSessionAdapter,
} from '../../../test/test-utils';
import { AnalyticsSettingsDialog } from './analytics-settings-dialog';

const baseProps = {
  open: true,
  onOpenChange: vi.fn(),
  displayCurrency: null,
  rateBasis: 'current-rate' as const,
  reportingCurrency: 'PLN',
  onApplyView: vi.fn(),
  coverageFilters: { from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z' },
};

describe('AnalyticsSettingsDialog', () => {
  it('should scope the top-level description to the view-preference fields only, never claiming nothing is saved for the whole dialog', () => {
    renderWithProviders(<AnalyticsSettingsDialog {...baseProps} />);

    const description = screen.getByText(/Display currency and rate basis/);
    expect(description).toHaveTextContent(
      'Display currency and rate basis (below) only change what you see on this screen — nothing is saved. Actions further down can write data permanently — each one says so plainly.'
    );
    // Regression guard (#2473): the blanket claim must not appear stripped of
    // its "Actions further down..." qualifier anywhere else in the dialog —
    // that would silently promise the currency-recalculation write is a
    // no-op preview too.
    expect(screen.queryByText('Nothing is saved.')).not.toBeInTheDocument();
  });

  it('should carry its own separate permanent-write caveat on the Currency — recalculation section', () => {
    renderWithProviders(<AnalyticsSettingsDialog {...baseProps} />);

    expect(
      screen.getByText(/This section writes data permanently/)
    ).toBeInTheDocument();
  });

  it('should describe the tax-rate toggle truthfully: org-wide/every-date-range scope, and reverting removes the orders again (#2815)', async () => {
    renderWithProviders(<AnalyticsSettingsDialog {...baseProps} />, {
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    const toggleDescription = await screen.findByText(/Trust a tax rate found retroactively/);
    // Must not claim already-shown figures survive turning the setting off —
    // it is a query-time gate, so reverting removes those orders from Net
    // Sales again at the next query.
    expect(toggleDescription).not.toHaveTextContent(/does not undo/);
    expect(toggleDescription).toHaveTextContent(/removes these orders from Net Sales again/);
    // Must state the change is org-wide and applies to every date range, not
    // just the one currently being viewed.
    expect(toggleDescription).toHaveTextContent(/everyone/);
    expect(toggleDescription).toHaveTextContent(/every date range/);
  });

  it('should render the reporting currency as the default "Show amounts in" option', () => {
    renderWithProviders(<AnalyticsSettingsDialog {...baseProps} />);

    expect(screen.getByRole('combobox', { name: 'Show amounts in' })).toHaveValue('');
    expect(screen.getByText('PLN · reporting currency')).toBeInTheDocument();
  });

  it('should call onApplyView with the drafted currency and rate basis on Apply, without saving anything', async () => {
    const onApplyView = vi.fn();
    renderWithProviders(<AnalyticsSettingsDialog {...baseProps} onApplyView={onApplyView} />);

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Show amounts in' }), 'EUR');
    await userEvent.click(
      screen.getByRole('radio', { name: /Rate on order date/ })
    );
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onApplyView).toHaveBeenCalledWith('EUR', 'order-date');
  });

  it('should show the pending currency-recalculation count and trigger the real remediation endpoint', async () => {
    const recalculateCurrency = vi.fn().mockResolvedValue({
      id: 'ol_remrun_1',
      category: 'currency',
      status: 'in-progress',
      detail: null,
      affectedCount: 23,
      triggeredByUserId: 'user-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const apiClient = createMockApiClient({
      analytics: {
        getCoverage: vi.fn().mockResolvedValue({
          categories: [
            { category: 'currency', status: 'open', affectedCount: 23, sampleOrderIds: [] },
            { category: 'tax-a', status: 'open', affectedCount: 0, sampleOrderIds: [] },
            { category: 'tax-b', status: 'open', affectedCount: 0, sampleOrderIds: [] },
            { category: 'tax-c', status: 'open', affectedCount: 0, sampleOrderIds: [] },
            { category: 'product-matching', status: 'open', affectedCount: 0, sampleOrderIds: [] },
          ],
        }),
        recalculateCurrency,
      },
    });

    renderWithProviders(<AnalyticsSettingsDialog {...baseProps} />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    expect(await screen.findByText('23 orders waiting to be recalculated')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Recalculate now' }));

    await waitFor(() => {
      expect(recalculateCurrency).toHaveBeenCalledWith(baseProps.coverageFilters);
    });
  });

  it('should render an inert, disabled auto-recalculate toggle since no backend setting exists for it', () => {
    renderWithProviders(<AnalyticsSettingsDialog {...baseProps} />);

    const toggle = screen.getByRole('checkbox', {
      name: /Automatically recalculate outstanding orders/,
    });
    expect(toggle).toBeDisabled();
  });

  it('should toggle the tax-rate setting via the real settings mutation, preserving the persisted currency/rateBasis defaults', async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({
      analyticsSettings: {
        getSettings: vi.fn().mockResolvedValue({
          displayCurrency: 'EUR',
          displayCurrencySource: 'setting',
          rateBasis: 'current',
          includeBackfilledTaxRatesInNetSales: false,
          updatedAt: null,
          updatedByUserId: null,
        }),
        updateSettings,
      },
    });

    renderWithProviders(<AnalyticsSettingsDialog {...baseProps} />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    const taxToggle = await screen.findByRole('checkbox', {
      name: /Use the rate found in the product catalog/,
    });
    await userEvent.click(taxToggle);

    await waitFor(() => {
      expect(updateSettings).toHaveBeenCalledWith({
        displayCurrency: 'EUR',
        rateBasis: 'current',
        includeBackfilledTaxRatesInNetSales: true,
      });
    });
  });

  describe('admin-only write affordances (#2473 review)', () => {
    // PUT /analytics/settings and POST /analytics/coverage/currency/recalculate
    // are @Roles('admin')-gated server-side — the tax-rate toggle and
    // "Recalculate now" must not render as live, clickable controls for a
    // session that would just get a 403.
    const viewerSession = {
      sessionAdapter: createAuthenticatedSessionAdapter({
        id: 'u2',
        username: 'viewer',
        email: null,
        role: 'viewer',
        permissions: ['orders:read'],
      }),
    };

    function coverageApiClient(): ReturnType<typeof createMockApiClient> {
      return createMockApiClient({
        analytics: {
          getCoverage: vi.fn().mockResolvedValue({
            categories: [
              { category: 'currency', status: 'open', affectedCount: 23, sampleOrderIds: [] },
              { category: 'tax-a', status: 'open', affectedCount: 0, sampleOrderIds: [] },
              { category: 'tax-b', status: 'open', affectedCount: 0, sampleOrderIds: [] },
              { category: 'tax-c', status: 'open', affectedCount: 0, sampleOrderIds: [] },
              { category: 'product-matching', status: 'open', affectedCount: 0, sampleOrderIds: [] },
            ],
          }),
        },
      });
    }

    it('should hide the tax-rate toggle and the recalculate action for a non-admin, non-demo session', async () => {
      renderWithProviders(<AnalyticsSettingsDialog {...baseProps} />, {
        apiClient: coverageApiClient(),
        ...viewerSession,
      });

      expect(await screen.findByText('23 orders waiting to be recalculated')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Recalculate now' })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('checkbox', { name: /Use the rate found in the product catalog/ })
      ).not.toBeInTheDocument();
    });

    it('should render both admin-only controls visible-but-disabled for a demo read-only viewer', async () => {
      const apiClient = createMockApiClient({
        ...coverageApiClient(),
        system: { getConfig: vi.fn().mockResolvedValue({ demoMode: true }) },
      });

      renderWithProviders(<AnalyticsSettingsDialog {...baseProps} />, {
        apiClient,
        ...viewerSession,
      });

      expect(await screen.findByRole('button', { name: 'Recalculate now' })).toBeDisabled();
      expect(
        screen.getByRole('checkbox', { name: /Use the rate found in the product catalog/ })
      ).toBeDisabled();
    });
  });
});

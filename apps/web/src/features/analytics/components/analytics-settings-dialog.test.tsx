import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
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
    // Opens a confirmation before writing anything (#2668 review, finding 14)
    // — a real, permanent financial write on one click had no confirm.
    await userEvent.click(await screen.findByRole('button', { name: 'Recalculate' }));

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
          netGrossBasis: 'gross',
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
    // Turning the toggle ON opens a confirmation before writing anything
    // (#2857, mirroring #2668 review, finding 14).
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on' }));

    await waitFor(() => {
      expect(updateSettings).toHaveBeenCalledWith({
        displayCurrency: 'EUR',
        rateBasis: 'current',
        includeBackfilledTaxRatesInNetSales: true,
        netGrossBasis: 'gross',
      });
    });
  });

  it('should send null displayCurrency when the resolved value is only the default, not a stored override (#2668 review, finding 10)', async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({
      analyticsSettings: {
        getSettings: vi.fn().mockResolvedValue({
          displayCurrency: 'PLN',
          displayCurrencySource: 'default',
          rateBasis: 'current',
          includeBackfilledTaxRatesInNetSales: false,
          netGrossBasis: 'gross',
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
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on' }));

    await waitFor(() => {
      expect(updateSettings).toHaveBeenCalledWith({
        displayCurrency: null,
        rateBasis: 'current',
        includeBackfilledTaxRatesInNetSales: true,
        netGrossBasis: 'gross',
      });
    });
  });

  it('should gate turning the tax-rate toggle ON behind a confirm dialog, leaving it untouched on Cancel (#2857)', async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({
      analyticsSettings: {
        getSettings: vi.fn().mockResolvedValue({
          displayCurrency: 'PLN',
          displayCurrencySource: 'default',
          rateBasis: 'current',
          includeBackfilledTaxRatesInNetSales: false,
          netGrossBasis: 'gross',
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

    // Clicking the checkbox alone must not write anything yet.
    const confirmDialog = await screen.findByRole('dialog', { name: 'Turn on including orders with a guessed tax rate?' });
    expect(updateSettings).not.toHaveBeenCalled();

    await userEvent.click(within(confirmDialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Turn on including orders with a guessed tax rate?' })).not.toBeInTheDocument();
    });
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('should never render a false "Affects 0 orders" claim from an absent coverage read in the confirm dialog (#2993 review)', async () => {
    let resolveCoverage: ((value: unknown) => void) | undefined;
    const apiClient = createMockApiClient({
      analytics: {
        getCoverage: vi.fn().mockImplementation(
          () =>
            new Promise((resolve) => {
              resolveCoverage = resolve;
            })
        ),
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

    const confirmDialog = await screen.findByRole('dialog', {
      name: 'Turn on including orders with a guessed tax rate?',
    });

    // While the coverage read is still in flight, the dialog must not
    // assert a positive "Affects 0 orders." claim — that would be a
    // rendered fact built from an absent value.
    expect(within(confirmDialog).queryByText(/Affects 0 order/)).not.toBeInTheDocument();
    expect(within(confirmDialog).getByText(/Checking how many orders are affected/)).toBeInTheDocument();

    resolveCoverage?.({
      categories: [
        { category: 'tax-a', status: 'open', affectedCount: 7, sampleOrderIds: [] },
      ],
    });

    // Once the read settles successfully, the real count renders.
    await waitFor(() => {
      expect(within(confirmDialog).getByText('Affects 7 orders.')).toBeInTheDocument();
    });
  });

  it('should say the count is unknown, never claim zero, when the confirm dialog\'s coverage read fails (#2993 review)', async () => {
    const apiClient = createMockApiClient({
      analytics: {
        getCoverage: vi.fn().mockRejectedValue(new Error('network error')),
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

    const confirmDialog = await screen.findByRole('dialog', {
      name: 'Turn on including orders with a guessed tax rate?',
    });

    await waitFor(() => {
      expect(
        within(confirmDialog).getByText(/Affects an unknown number of orders/)
      ).toBeInTheDocument();
    });
    expect(within(confirmDialog).queryByText(/Affects 0 order/)).not.toBeInTheDocument();
  });

  it('should turn the tax-rate setting OFF directly, with no confirm dialog (#2857, #2993 review)', async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({
      analyticsSettings: {
        getSettings: vi.fn().mockResolvedValue({
          displayCurrency: 'EUR',
          displayCurrencySource: 'setting',
          rateBasis: 'current',
          includeBackfilledTaxRatesInNetSales: true,
          netGrossBasis: 'gross',
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
    expect(taxToggle).toBeChecked();

    await userEvent.click(taxToggle);

    // Turning OFF is the safe, reversing direction — it writes immediately,
    // with no confirm dialog gating it (the ON direction only, per #2857's
    // own AC). A future edit that starts gating both directions, or drops
    // the `else` branch, must fail this test.
    expect(
      screen.queryByRole('dialog', { name: 'Turn on including orders with a guessed tax rate?' })
    ).not.toBeInTheDocument();
    await waitFor(() => {
      expect(updateSettings).toHaveBeenCalledWith({
        displayCurrency: 'EUR',
        rateBasis: 'current',
        includeBackfilledTaxRatesInNetSales: false,
        netGrossBasis: 'gross',
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

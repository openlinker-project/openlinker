/**
 * Currency Settings Tile — Tests
 *
 * Covers the tile's loading/error/success states, in particular the three
 * distinct source states this tile renders (`default` / `env` / `setting`)
 * rather than the plan's two-state `EUR (default)` collapse, and the
 * coverage-gap acknowledgement gate in the edit dialog.
 *
 * @module apps/web/src/features/currency-settings/components
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';
import type { CurrencySettingsView } from '../api/currency-settings.types';
import { CurrencySettingsTile } from './currency-settings-tile';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

afterEach(cleanup);

const adminSessionAdapter = createAuthenticatedSessionAdapter();

const unsetView: CurrencySettingsView = {
  reportingCurrency: 'EUR',
  source: 'default',
  updatedAt: null,
  updatedBy: null,
  supportedCurrencies: ['PLN', 'EUR'],
  rateSource: 'ecb',
  rateDateRule: 'prev-business-day',
  stampedOrders: [],
  coverage: [
    { reportingCurrency: 'PLN', rateSource: 'nbp', observedCurrencies: [], uncoverableCurrencies: [] },
    { reportingCurrency: 'EUR', rateSource: 'ecb', observedCurrencies: [], uncoverableCurrencies: [] },
  ],
};

const envView: CurrencySettingsView = {
  ...unsetView,
  reportingCurrency: 'PLN',
  source: 'env',
  rateSource: 'nbp',
};

const savedView: CurrencySettingsView = {
  ...unsetView,
  reportingCurrency: 'PLN',
  source: 'setting',
  rateSource: 'nbp',
  updatedAt: '2026-07-01T09:14:00.000Z',
  updatedBy: 'admin',
  stampedOrders: [
    { reportingCurrency: 'PLN', count: 3947 },
    { reportingCurrency: 'EUR', count: 1284 },
  ],
};

describe('CurrencySettingsTile', () => {
  it('shows a loading state while the settings query is in flight', async () => {
    const apiClient = createMockApiClient({
      currencySettings: { get: vi.fn(() => new Promise<CurrencySettingsView>(() => {})) },
    });
    renderWithProviders(<CurrencySettingsTile />, { sessionAdapter: adminSessionAdapter, apiClient });

    expect(await screen.findByText('Loading currency settings…')).toBeInTheDocument();
  });

  it('shows an error state when the settings query fails', async () => {
    const apiClient = createMockApiClient({
      currencySettings: { get: vi.fn().mockRejectedValue(new Error('Network down')) },
    });
    renderWithProviders(<CurrencySettingsTile />, { sessionAdapter: adminSessionAdapter, apiClient });

    expect(
      await screen.findByText(/Could not load currency settings: Network down/)
    ).toBeInTheDocument();
  });

  it('renders "EUR (default)" when nobody has chosen a value', async () => {
    const apiClient = createMockApiClient({
      currencySettings: { get: vi.fn().mockResolvedValue(unsetView) },
    });
    renderWithProviders(<CurrencySettingsTile />, { sessionAdapter: adminSessionAdapter, apiClient });

    expect(await screen.findByText('EUR (default)')).toBeInTheDocument();
  });

  it('renders "PLN (from env)" when the value comes from OL_REPORTING_CURRENCY', async () => {
    const apiClient = createMockApiClient({
      currencySettings: { get: vi.fn().mockResolvedValue(envView) },
    });
    renderWithProviders(<CurrencySettingsTile />, { sessionAdapter: adminSessionAdapter, apiClient });

    expect(await screen.findByText('PLN (from env)')).toBeInTheDocument();
  });

  it('renders a bare "PLN" when an operator has saved a value', async () => {
    const apiClient = createMockApiClient({
      currencySettings: { get: vi.fn().mockResolvedValue(savedView) },
    });
    renderWithProviders(<CurrencySettingsTile />, { sessionAdapter: adminSessionAdapter, apiClient });

    expect(await screen.findByText('PLN')).toBeInTheDocument();
    // Stamped-order counts are never shown on first paint — see the
    // "Coverage" dialog tests below for why (0 reads as an alarm, not a fact).
    expect(screen.queryByText(/3947/)).not.toBeInTheDocument();
  });

  it('opens the coverage dialog with a friendly zero-state when nothing is stamped yet', async () => {
    const apiClient = createMockApiClient({
      currencySettings: { get: vi.fn().mockResolvedValue(unsetView) },
    });
    renderWithProviders(<CurrencySettingsTile />, { sessionAdapter: adminSessionAdapter, apiClient });

    fireEvent.click(await screen.findByRole('button', { name: 'Coverage' }));

    expect(await screen.findByText('Analytics coverage')).toBeInTheDocument();
    expect(screen.getByText(/No orders have been stamped yet/)).toBeInTheDocument();
    expect(screen.queryByText('Orders with a reporting figure')).not.toBeInTheDocument();
  });

  it('opens the coverage dialog with the era breakdown once orders are stamped', async () => {
    const apiClient = createMockApiClient({
      currencySettings: { get: vi.fn().mockResolvedValue(savedView) },
    });
    renderWithProviders(<CurrencySettingsTile />, { sessionAdapter: adminSessionAdapter, apiClient });

    fireEvent.click(await screen.findByRole('button', { name: 'Coverage' }));

    expect(await screen.findByText('Orders with a reporting figure')).toBeInTheDocument();
    expect(screen.getByText('5231')).toBeInTheDocument(); // 3947 + 1284
    expect(screen.getByText('— stamped in PLN')).toBeInTheDocument();
    expect(screen.getByText('— stamped in EUR')).toBeInTheDocument();
    expect(screen.getByText('More than one reporting-currency era')).toBeInTheDocument();
  });

  it('opens the edit dialog when Edit is clicked', async () => {
    const apiClient = createMockApiClient({
      currencySettings: { get: vi.fn().mockResolvedValue(savedView) },
    });
    renderWithProviders(<CurrencySettingsTile />, { sessionAdapter: adminSessionAdapter, apiClient });

    const editButton = await screen.findByRole('button', { name: 'Edit' });
    fireEvent.click(editButton);

    await waitFor(() => {
      expect(screen.getByText('Read by Analytics · never used on an invoice')).toBeInTheDocument();
    });
  });

  it('blocks submit on a coverage gap until acknowledged', async () => {
    const viewWithGap: CurrencySettingsView = {
      ...savedView,
      coverage: [
        {
          reportingCurrency: 'PLN',
          rateSource: 'nbp',
          observedCurrencies: ['TRY'],
          uncoverableCurrencies: ['TRY'],
        },
        { reportingCurrency: 'EUR', rateSource: 'ecb', observedCurrencies: [], uncoverableCurrencies: [] },
      ],
    };
    const apiClient = createMockApiClient({
      currencySettings: { get: vi.fn().mockResolvedValue(viewWithGap) },
    });
    renderWithProviders(<CurrencySettingsTile />, { sessionAdapter: adminSessionAdapter, apiClient });

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await waitFor(() => {
      expect(screen.getByText('Coverage gap')).toBeInTheDocument();
    });

    const saveButton = screen.getByRole('button', { name: 'Save' });
    expect(saveButton).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox'));
    expect(saveButton).not.toBeDisabled();
  });
});

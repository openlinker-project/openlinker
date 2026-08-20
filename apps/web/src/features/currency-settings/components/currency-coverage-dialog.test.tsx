/**
 * Currency Coverage Dialog — Tests
 *
 * @module apps/web/src/features/currency-settings/components
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/test-utils';
import type { CurrencySettingsView } from '../api/currency-settings.types';
import { CurrencyCoverageDialog } from './currency-coverage-dialog';

afterEach(cleanup);

const baseView: CurrencySettingsView = {
  reportingCurrency: 'PLN',
  source: 'setting',
  updatedAt: '2026-07-01T09:14:00.000Z',
  updatedBy: 'admin',
  supportedCurrencies: ['PLN', 'EUR'],
  rateSource: 'nbp',
  rateDateRule: 'prev-business-day',
  stampedOrders: [],
  coverage: [],
};

describe('CurrencyCoverageDialog', () => {
  it('explains the zero-state without showing a bare 0', async () => {
    renderWithProviders(
      <CurrencyCoverageDialog open view={baseView} onClose={vi.fn()} />,
    );

    expect(await screen.findByText('Analytics coverage')).toBeInTheDocument();
    expect(screen.getByText(/No orders have been stamped yet/)).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('shows a single total with no era breakdown for one currency', async () => {
    const view: CurrencySettingsView = {
      ...baseView,
      stampedOrders: [{ reportingCurrency: 'PLN', count: 42 }],
    };
    renderWithProviders(<CurrencyCoverageDialog open view={view} onClose={vi.fn()} />);

    expect(await screen.findByText('Orders with a reporting figure')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.queryByText(/stamped in/)).not.toBeInTheDocument();
    expect(screen.queryByText('More than one reporting-currency era')).not.toBeInTheDocument();
  });

  it('breaks down multiple reporting-currency eras and explains why', async () => {
    const view: CurrencySettingsView = {
      ...baseView,
      stampedOrders: [
        { reportingCurrency: 'PLN', count: 3947 },
        { reportingCurrency: 'EUR', count: 1284 },
      ],
    };
    renderWithProviders(<CurrencyCoverageDialog open view={view} onClose={vi.fn()} />);

    expect(await screen.findByText('5231')).toBeInTheDocument();
    expect(screen.getByText('— stamped in PLN')).toBeInTheDocument();
    expect(screen.getByText('— stamped in EUR')).toBeInTheDocument();
    expect(screen.getByText('More than one reporting-currency era')).toBeInTheDocument();
  });

  it('calls onClose when Close is clicked', async () => {
    const onClose = vi.fn();
    const view: CurrencySettingsView = {
      ...baseView,
      stampedOrders: [{ reportingCurrency: 'PLN', count: 1 }],
    };
    renderWithProviders(<CurrencyCoverageDialog open view={view} onClose={onClose} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});

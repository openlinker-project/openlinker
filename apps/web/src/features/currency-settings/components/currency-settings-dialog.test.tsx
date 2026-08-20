/**
 * Currency Settings Dialog — Tests
 *
 * Covers the reactive-warning accessibility contract (#2135 review, finding 8):
 * both warnings materialise on a `<select>` change rather than on submit, and one
 * of them gates Save behind a checkbox, so their appearance has to be announced.
 * The live region is asserted to exist BEFORE any warning applies, because a
 * region inserted together with its content is not reliably announced.
 *
 * @module apps/web/src/features/currency-settings/components
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/test-utils';
import type { CurrencySettingsView } from '../api/currency-settings.types';
import { CurrencySettingsDialog } from './currency-settings-dialog';

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

function liveRegion(): HTMLElement {
  const region = document.querySelector('p.sr-only[role="status"]');
  if (!region) {
    throw new Error('the dialog rendered no persistent live region');
  }
  return region as HTMLElement;
}

describe('CurrencySettingsDialog', () => {
  it('mounts an empty live region up front, before any warning applies', async () => {
    renderWithProviders(<CurrencySettingsDialog open view={baseView} onClose={vi.fn()} />);

    expect(await screen.findByText('Currency')).toBeInTheDocument();
    // Present but silent: the element has to pre-exist the warning text, which is
    // the whole reason it is not rendered conditionally.
    expect(liveRegion()).toHaveAttribute('aria-live', 'polite');
    expect(liveRegion().textContent).toBe('');
  });

  it('announces a coverage gap and the acknowledgement it requires', async () => {
    const view: CurrencySettingsView = {
      ...baseView,
      coverage: [
        {
          reportingCurrency: 'PLN',
          rateSource: 'nbp',
          observedCurrencies: ['PLN', 'EUR', 'XTS'],
          uncoverableCurrencies: [],
        },
        {
          reportingCurrency: 'EUR',
          rateSource: 'ecb',
          observedCurrencies: ['PLN', 'EUR', 'XTS'],
          uncoverableCurrencies: ['XTS'],
        },
      ],
    };
    renderWithProviders(<CurrencySettingsDialog open view={view} onClose={vi.fn()} />);

    expect(await screen.findByText('Currency')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'EUR' } });

    expect(liveRegion().textContent).toContain('coverage gap');
    expect(liveRegion().textContent).toContain('XTS');
    // The Save-gating requirement is named, since a screen-reader user otherwise
    // meets a disabled button with no stated cause.
    expect(liveRegion().textContent).toContain('Acknowledge before saving');
  });

  it('announces the history split when the new currency has stamped history elsewhere', async () => {
    const view: CurrencySettingsView = {
      ...baseView,
      stampedOrders: [{ reportingCurrency: 'PLN', count: 3947 }],
    };
    renderWithProviders(<CurrencySettingsDialog open view={view} onClose={vi.fn()} />);

    expect(await screen.findByText('Currency')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'EUR' } });

    expect(liveRegion().textContent).toContain('splits reporting history');
    expect(liveRegion().textContent).toContain('PLN');
  });

  it('returns the region to silence when the operator picks a clean currency again', async () => {
    const view: CurrencySettingsView = {
      ...baseView,
      stampedOrders: [{ reportingCurrency: 'PLN', count: 3947 }],
    };
    renderWithProviders(<CurrencySettingsDialog open view={view} onClose={vi.fn()} />);

    expect(await screen.findByText('Currency')).toBeInTheDocument();
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'EUR' } });
    expect(liveRegion().textContent).not.toBe('');

    fireEvent.change(select, { target: { value: 'PLN' } });
    expect(liveRegion().textContent).toBe('');
  });
});

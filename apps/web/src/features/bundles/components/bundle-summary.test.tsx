/**
 * Bundle summary (#3935): the availability answer leads, the limiting
 * component is marked in its row, and unknown stock is never drawn as zero.
 */
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import type { ParsedRow } from '../lib/bundle-form-model';
import { BundleSummary } from './bundle-summary';

function row(over: Partial<ParsedRow>): ParsedRow {
  return {
    variantId: 'v',
    productId: 'p',
    name: 'Kubek',
    sku: 'KUB',
    price: 40,
    currency: 'PLN',
    availableToPromise: 10,
    isBundle: false,
    quantity: '1',
    gift: false,
    documentForm: '',
    qty: 1,
    ...over,
  };
}

describe('BundleSummary', () => {
  it('should show the count of bundles and mark the limiting component in its row', () => {
    renderWithProviders(
      <BundleSummary
        name="Zestaw"
        price={65}
        currency="PLN"
        rows={[
          row({ variantId: 'a', name: 'Kubek', availableToPromise: 12 }),
          row({ variantId: 'b', name: 'Lyzeczka', availableToPromise: 3 }),
        ]}
        availability={{ kind: 'known', bundles: 3, limitedBy: 'Lyzeczka' }}
        giftDocumentLine={null}
      />
    );

    expect(screen.getByTestId('bundle-form-availability')).toHaveTextContent('3');
    const limiting = screen.getByTestId('bundle-form-summary-limiting');
    expect(limiting).toHaveTextContent('Lyzeczka');
    expect(limiting).toHaveTextContent(/Lowest|Najmniej/);
  });

  it('should show the stock formula with a worked example and a per-component yield', () => {
    renderWithProviders(
      <BundleSummary
        name="Zestaw"
        price={65}
        currency="PLN"
        rows={[row({ variantId: 'a', name: 'Kubek', availableToPromise: 28, qty: 2, quantity: '2' })]}
        availability={{ kind: 'known', bundles: 14, limitedBy: null }}
        giftDocumentLine={null}
      />
    );

    expect(screen.getByTestId('bundle-form-formula')).toHaveTextContent('28 ÷ 2 = 14');
    expect(screen.getByTestId('bundle-form-summary-enough')).toHaveTextContent('14');
  });

  it('should show zero muted with a prompt before any component is added', () => {
    renderWithProviders(
      <BundleSummary
        name={null}
        price={null}
        currency={undefined}
        rows={[]}
        availability={{ kind: 'empty' }}
        giftDocumentLine={null}
      />
    );

    const hero = screen.getByTestId('bundle-form-availability');
    expect(hero).toHaveClass('is-empty');
    expect(hero).toHaveTextContent(/Add a component|Dodaj składnik/);
  });

  it('should name the component with unknown stock and never show a count', () => {
    renderWithProviders(
      <BundleSummary
        name="Zestaw"
        price={65}
        currency="PLN"
        rows={[row({ variantId: 'a', name: 'Kubek', availableToPromise: null })]}
        availability={{ kind: 'unknown', component: 'Kubek' }}
        giftDocumentLine={null}
      />
    );

    const hero = screen.getByTestId('bundle-form-availability');
    expect(hero).toHaveClass('is-unk');
    expect(hero).toHaveTextContent('Kubek');
    expect(hero.querySelector('.s-hero__num')).toBeNull();
  });

  it('should announce availability politely', () => {
    renderWithProviders(
      <BundleSummary
        name="Zestaw"
        price={null}
        currency={undefined}
        rows={[row({})]}
        availability={{ kind: 'known', bundles: 10, limitedBy: null }}
        giftDocumentLine={null}
      />
    );

    expect(screen.getByTestId('bundle-form-availability')).toHaveAttribute('aria-live', 'polite');
  });
});

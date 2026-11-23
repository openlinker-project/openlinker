/**
 * Bundle form step 3 (#3935): the document card is always there, and a gift
 * shows its default form as text with the other forms one click away.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { BundleFormRow } from '../lib/bundle-form-model';
import { BundleStepGifts } from './bundle-step-gifts';

function row(over: Partial<BundleFormRow>): BundleFormRow {
  return {
    variantId: 'v1',
    productId: 'p1',
    name: 'Lyzeczka',
    sku: 'LYZ',
    price: 15,
    currency: 'PLN',
    availableToPromise: 4,
    isBundle: false,
    quantity: '1',
    gift: false,
    documentForm: '',
    ...over,
  };
}

function render(rows: BundleFormRow[]): void {
  renderWithProviders(
    <BundleStepGifts rows={rows} readOnly={false} currency="PLN" onFormChange={vi.fn()} onBackToComponents={vi.fn()} />,
    { apiClient: createMockApiClient() }
  );
}

describe('BundleStepGifts', () => {
  it('should show the three rules and the document card even when no component is a gift', () => {
    render([row({})]);

    expect(screen.getByTestId('bundle-form-gift-rules').querySelectorAll('li')).toHaveLength(3);
    expect(screen.getByTestId('bundle-form-doc-card')).toBeInTheDocument();
    expect(screen.getByTestId('bundle-form-no-gifts')).toBeInTheDocument();
  });

  it('should show the default form as text and reveal the choice on "other form"', async () => {
    const user = userEvent.setup();
    render([row({ gift: true })]);

    expect(screen.getByTestId('bundle-form-gift-default-LYZ')).toBeInTheDocument();
    expect(screen.queryByTestId('bundle-form-gift-form-LYZ')).not.toBeInTheDocument();
    expect(screen.getByTestId('bundle-form-gift-meta-LYZ')).toHaveTextContent('4');

    await user.click(screen.getByTestId('bundle-form-gift-other-LYZ'));
    expect(screen.getByTestId('bundle-form-gift-form-LYZ')).toBeInTheDocument();
  });
});

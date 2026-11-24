/**
 * BundleComposition tests (#3520)
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import { renderWithProviders } from '../../../../test/test-utils';
import type { BundleOfferPreviewOk } from '../../hooks/use-bundle-offer-preview';
import { BundleComposition } from './bundle-composition';

const preview: BundleOfferPreviewOk = {
  variantId: 'bundle-v',
  status: 'ok',
  suggestedCategoryId: '74035',
  availableSets: 3,
  limitingComponentVariantId: 'c',
  components: [
    {
      variantId: 'k',
      productId: 'p-k',
      name: 'Kawa 250 g',
      sku: 'KAW-250',
      quantity: 1,
      giftSlot: false,
      imageUrl: null,
      mode: 'own-offer',
      externalOfferId: '778123',
      cardCategoryId: '74035',
      problems: [],
    },
    {
      variantId: 'l',
      productId: 'p-l',
      name: 'Łyżeczka',
      sku: 'LYZ-01',
      quantity: 1,
      giftSlot: true,
      imageUrl: null,
      mode: 'missing',
      problems: [{ code: 'PRODUCT_SET_COMPONENT_UNPUBLISHABLE', message: 'No catalogue match.' }],
    },
  ],
};

function renderIt(chosen: string | null, onUse = vi.fn()): void {
  renderWithProviders(
    <BundleComposition
      preview={preview}
      connectionId="conn-1"
      chosenCategoryId={chosen}
      onUseSuggestedCategory={onUse}
    />
  );
}

describe('BundleComposition', () => {
  it('should list each component with its mode, quantity and gift marker', () => {
    renderIt('74035');
    expect(screen.getByText('Kawa 250 g')).toBeInTheDocument();
    expect(screen.getByText('own offer 778123')).toBeInTheDocument();
    expect(screen.getByText('gift')).toBeInTheDocument();
    expect(screen.getByText('cannot be listed')).toBeInTheDocument();
    expect(screen.getByText('No catalogue match.')).toBeInTheDocument();
  });

  it('should link a component that cannot be listed to publishing it on its own', () => {
    renderIt('74035');
    expect(screen.getByRole('link', { name: 'List component' })).toHaveAttribute(
      'href',
      '/listings/bulk-create/wizard?productIds=p-l&connectionId=conn-1'
    );
  });

  it('should offer the first component category only when the chosen one differs', () => {
    const onUse = vi.fn();
    renderIt('110886', onUse);
    fireEvent.click(screen.getByRole('button', { name: "Use first component's category" }));
    expect(onUse).toHaveBeenCalledTimes(1);
  });

  it('should not offer a category fix when the category already matches', () => {
    renderIt('74035');
    expect(screen.queryByTestId('bundle-category-mismatch')).not.toBeInTheDocument();
  });
});

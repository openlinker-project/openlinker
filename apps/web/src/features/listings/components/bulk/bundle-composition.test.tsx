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
    expect(screen.getByText('your offer 778123')).toBeInTheDocument();
    expect(screen.getByText('gift')).toBeInTheDocument();
    expect(screen.getByText('component has no offer')).toBeInTheDocument();
    expect(screen.getByText('No catalogue match.')).toBeInTheDocument();
  });

  it('should summarise how many sets can be sold and which component limits them', () => {
    renderIt('74035');
    expect(screen.getByTestId('bundle-sets-summary')).toHaveTextContent('Sets available');
  });

  it('should explain each mode in words, not only in a badge', () => {
    renderIt('74035');
    expect(
      screen.getAllByText('The component has no offer or product card. List it first.').length,
    ).toBeGreaterThan(0);
  });

  it('should open the publish link in a new tab so the batch is not lost', () => {
    renderIt('74035');
    expect(screen.getByRole('link', { name: 'List component' })).toHaveAttribute('target', '_blank');
    expect(screen.getByTestId('bundle-missing-hint')).toBeInTheDocument();
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

describe('BundleComposition - multipack and stock', () => {
  const pack: BundleOfferPreviewOk = {
    variantId: 'pack-v',
    status: 'ok',
    suggestedCategoryId: null,
    availableSets: 4,
    limitingComponentVariantId: 'm',
    components: [
      {
        variantId: 'm',
        productId: 'p-m',
        name: 'Mug',
        sku: 'MUG',
        quantity: 3,
        giftSlot: false,
        imageUrl: null,
        mode: 'own-offer',
        availableUnits: 12,
        problems: [],
      },
    ],
  };

  it('should explain a multipack and show how many packs the stock makes', () => {
    renderWithProviders(
      <BundleComposition
        preview={pack}
        connectionId="conn-1"
        chosenCategoryId={null}
        destinationName="Allegro"
      />
    );
    expect(screen.getByTestId('bundle-pack-hint')).toHaveTextContent('pack of 3');
    expect(screen.getByTestId('bundle-component-stock')).toHaveTextContent('12 in stock · enough for 4 sets');
  });

  it('should not show a pack hint for a set of different products', () => {
    renderIt('74035');
    expect(screen.queryByTestId('bundle-pack-hint')).not.toBeInTheDocument();
  });

  it('should say the price covers the whole set and name the first product on Allegro', () => {
    renderWithProviders(
      <BundleComposition
        preview={preview}
        connectionId="conn-1"
        chosenCategoryId="74035"
        destinationName="Allegro"
      />
    );
    expect(screen.getByTestId('bundle-price-scope')).toBeInTheDocument();
    expect(screen.getByTestId('bundle-first-product-note')).toHaveTextContent('Kawa 250 g');
  });
});

describe('BundleComposition - Allegro advisories', () => {
  const component = (i: number): BundleOfferPreviewOk['components'][number] => ({
    variantId: `v${i}`,
    productId: `p${i}`,
    name: `Item ${i}`,
    sku: `S${i}`,
    quantity: 1,
    giftSlot: false,
    imageUrl: null,
    mode: 'own-offer',
    availableUnits: 5,
    problems: [],
  });
  const many: BundleOfferPreviewOk = {
    variantId: 'big',
    status: 'ok',
    suggestedCategoryId: null,
    availableSets: 5,
    limitingComponentVariantId: null,
    components: Array.from({ length: 11 }, (_, i) => component(i)),
  };

  it('should advise, not block, when a set has more than 10 products', () => {
    renderWithProviders(
      <BundleComposition preview={many} connectionId="c" chosenCategoryId={null} destinationName="Allegro" />
    );
    expect(screen.getByTestId('bundle-too-many-products')).toHaveTextContent('11');
    expect(screen.getByTestId('bundle-gallery-advisory')).toBeInTheDocument();
  });

  it('should show the final pack title with a counter and the per-piece price', () => {
    const pack: BundleOfferPreviewOk = {
      ...many,
      components: [{ ...component(1), quantity: 3 }],
    };
    renderWithProviders(
      <BundleComposition
        preview={pack}
        connectionId="c"
        chosenCategoryId={null}
        destinationName="Allegro"
        title="Mug"
        priceAmount="30,00"
      />
    );
    expect(screen.getByTestId('bundle-pack-final-title')).toHaveTextContent('Mug - Set of 3 pcs');
    expect(screen.getByTestId('bundle-per-piece-price')).toHaveTextContent('10.00');
  });
});

/**
 * Gift slot document form in the bundle expansion (#3940)
 */
import { expandBundleLines, type BundleDefinition } from './bundle.types';

const line = { id: 'l1', productId: 'p-set', variantId: 'v-set', quantity: 2 };

function definition(components: BundleDefinition['components']): BundleDefinition {
  return { variantId: 'v-set', version: 1, components };
}

describe('expandBundleLines gift slot document form', () => {
  it('should carry the gift slot form onto the expanded gift line when the slot names one', () => {
    const [paid, gift] = expandBundleLines(
      [line],
      [
        definition([
          { variantId: 'v-a', productId: 'p-a', quantity: 1 },
          { variantId: 'v-g', productId: 'p-g', quantity: 1, giftSlot: true, documentForm: 'show-zero' },
        ]),
      ]
    );

    expect(paid.giftDocumentForm).toBeUndefined();
    expect(gift.giftSlot).toBe(true);
    expect(gift.giftDocumentForm).toBe('show-zero');
  });

  it('should leave the form absent when the slot says nothing so the connection and default decide', () => {
    const [gift] = expandBundleLines(
      [line],
      [definition([{ variantId: 'v-g', productId: 'p-g', quantity: 1, giftSlot: true }])]
    );

    expect(gift.giftDocumentForm).toBeUndefined();
  });

  it('should ignore a form on a component that is not a gift slot', () => {
    const [paid] = expandBundleLines(
      [line],
      [definition([{ variantId: 'v-a', productId: 'p-a', quantity: 1, documentForm: 'omit' }])]
    );

    expect(paid.giftDocumentForm).toBeUndefined();
  });

  it('should drop an unrecognised stored form rather than carry it', () => {
    const [gift] = expandBundleLines(
      [line],
      [
        definition([
          {
            variantId: 'v-g',
            productId: 'p-g',
            quantity: 1,
            giftSlot: true,
            documentForm: 'bogus' as never,
          },
        ]),
      ]
    );

    expect(gift.giftDocumentForm).toBeUndefined();
  });

  it('should fall back to as-in-settings when two merged slots of one variant disagree', () => {
    const [gift] = expandBundleLines(
      [line],
      [
        definition([
          { variantId: 'v-g', productId: 'p-g', quantity: 1, giftSlot: true, documentForm: 'omit' },
          { variantId: 'v-g', productId: 'p-g', quantity: 1, giftSlot: true, documentForm: 'priced-in' },
        ]),
      ]
    );

    expect(gift.quantity).toBe(4);
    expect(gift.giftDocumentForm).toBeUndefined();
  });
});

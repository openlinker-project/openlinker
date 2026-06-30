/**
 * Unit tests for the TaxonomyBorrower capability guard (#1045).
 */
import { isTaxonomyBorrower } from '../taxonomy-borrower.capability';
import type { OfferManagerPort } from '../../offer-manager.port';

describe('isTaxonomyBorrower', () => {
  const base = { updateOfferQuantity: jest.fn() } as unknown as OfferManagerPort;

  it('narrows an adapter that declares getBorrowedTaxonomy', () => {
    const adapter = { ...base, getBorrowedTaxonomy: () => 'allegro' as const } as OfferManagerPort;

    expect(isTaxonomyBorrower(adapter)).toBe(true);
    if (isTaxonomyBorrower(adapter)) {
      // After the guard, the method is callable on the narrowed type.
      expect(adapter.getBorrowedTaxonomy()).toBe('allegro');
    }
  });

  it('returns false for an adapter without getBorrowedTaxonomy', () => {
    expect(isTaxonomyBorrower(base)).toBe(false);
  });
});

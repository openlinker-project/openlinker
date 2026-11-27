/**
 * Taxonomy owner vocabulary tests (#4181)
 *
 * @module libs/core/src/listings/domain/types/__tests__
 */
import { amazonTaxonomyOwner, isTaxonomyOwner } from '../taxonomy-owner.types';

describe('isTaxonomyOwner', () => {
  it('should accept the Allegro trees and an Amazon marketplace tree in either environment', () => {
    expect(isTaxonomyOwner('allegro')).toBe(true);
    expect(isTaxonomyOwner('allegro:sandbox')).toBe(true);
    expect(isTaxonomyOwner('amazon:A1PA6795UKMFR9')).toBe(true);
    expect(isTaxonomyOwner('amazon:sandbox:A1PA6795UKMFR9')).toBe(true);
  });

  it('should refuse an unqualified Amazon owner and anything unknown', () => {
    expect(isTaxonomyOwner('amazon')).toBe(false);
    expect(isTaxonomyOwner('amazon:de')).toBe(false);
    expect(isTaxonomyOwner('ebay:EBAY_US')).toBe(false);
    expect(isTaxonomyOwner('')).toBe(false);
  });
});

describe('amazonTaxonomyOwner', () => {
  it('should name one tree per marketplace and environment', () => {
    expect(amazonTaxonomyOwner('A1PA6795UKMFR9', false)).toBe('amazon:A1PA6795UKMFR9');
    expect(amazonTaxonomyOwner('A1PA6795UKMFR9', true)).toBe('amazon:sandbox:A1PA6795UKMFR9');
  });
});

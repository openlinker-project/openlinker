/**
 * Unmatched product id helper tests (#4280)
 *
 * @module libs/core/src/identifier-mapping/domain/types/__tests__
 */
import {
  buildUnmatchedProductId,
  isUnmatchedProductId,
  readableProductLabel,
  readUnmatchedOfferId,
} from '../unmatched-product-id.types';

describe('unmatched-product-id', () => {
  it('should build a deterministic id from the connection and the external offer id', () => {
    expect(buildUnmatchedProductId('conn-1', '9788328345')).toBe('unmatched:conn-1:9788328345');
    expect(buildUnmatchedProductId('conn-1', '9788328345')).toBe(
      buildUnmatchedProductId('conn-1', '9788328345')
    );
  });

  it('should keep two accounts with the same offer id apart', () => {
    expect(buildUnmatchedProductId('conn-1', 'offer')).not.toBe(
      buildUnmatchedProductId('conn-2', 'offer')
    );
  });

  describe('isUnmatchedProductId', () => {
    it('should recognise a synthetic id', () => {
      expect(isUnmatchedProductId('unmatched:conn-1:offer')).toBe(true);
    });

    it('should not recognise a real internal product id', () => {
      expect(isUnmatchedProductId('ol_product_fce2df4d853f4499b955a6bb1a212bd1')).toBe(false);
    });

    it('should treat an absent or empty value as not unmatched', () => {
      expect(isUnmatchedProductId(undefined)).toBe(false);
      expect(isUnmatchedProductId(null)).toBe(false);
      expect(isUnmatchedProductId('')).toBe(false);
    });
  });

  describe('readUnmatchedOfferId', () => {
    it('should recover the offer id', () => {
      expect(readUnmatchedOfferId('unmatched:conn-1:9788328345')).toBe('9788328345');
    });

    it('should keep colons that belong to the external id', () => {
      expect(readUnmatchedOfferId('unmatched:conn-1:a:b:c')).toBe('a:b:c');
    });

    it('should return null for a non-synthetic or malformed value', () => {
      expect(readUnmatchedOfferId('ol_product_x')).toBeNull();
      expect(readUnmatchedOfferId('unmatched:conn-only')).toBeNull();
      expect(readUnmatchedOfferId('unmatched:conn-1:')).toBeNull();
      expect(readUnmatchedOfferId(undefined)).toBeNull();
    });
  });
});

describe('readableProductLabel', () => {
  it('should show the marketplace offer id for a synthetic id', () => {
    expect(readableProductLabel('unmatched:conn-1:9788328345')).toBe('9788328345');
  });

  it('should show a real product id unchanged', () => {
    expect(readableProductLabel('ol_product_x')).toBe('ol_product_x');
  });
});

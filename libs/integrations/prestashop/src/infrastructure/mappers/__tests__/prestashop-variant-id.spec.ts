/**
 * Unit tests for the PrestaShop variant-id coercion helper.
 *
 * Locks the contract relied on by both the order/cart mapper and the
 * price-pinning path: a synthetic-variant marker (`product:<n>`) or any
 * non-numeric / missing value must collapse to 0, while numeric ids pass
 * through unchanged (#923).
 *
 * @module libs/integrations/prestashop/src/infrastructure/mappers
 */
import { toPrestashopProductAttributeId } from '../prestashop-variant-id';

describe('toPrestashopProductAttributeId', () => {
  it('should return 0 when the variant id is undefined (no variant mapping)', () => {
    expect(toPrestashopProductAttributeId(undefined)).toBe(0);
  });

  it('should return 0 for a synthetic-variant marker (the #923 simple-product bug)', () => {
    expect(toPrestashopProductAttributeId('product:25')).toBe(0);
  });

  it('should parse a numeric-string combination id', () => {
    expect(toPrestashopProductAttributeId('460')).toBe(460);
  });

  it('should pass a numeric combination id through unchanged', () => {
    expect(toPrestashopProductAttributeId(460)).toBe(460);
  });

  it('should return 0 for an explicit zero string', () => {
    expect(toPrestashopProductAttributeId('0')).toBe(0);
  });

  it('should return 0 for an explicit zero number', () => {
    expect(toPrestashopProductAttributeId(0)).toBe(0);
  });

  it('should return 0 for an arbitrary non-numeric string', () => {
    expect(toPrestashopProductAttributeId('abc')).toBe(0);
  });

  it('should preserve the mapper precedent of leading-numeric parse (parseInt semantics)', () => {
    // Number.parseInt('460abc', 10) === 460 — matches the pre-extraction mapper
    // behaviour exactly; the extraction introduces no stricter validation.
    expect(toPrestashopProductAttributeId('460abc')).toBe(460);
  });
});

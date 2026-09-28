/**
 * derivePrestashopOrderReference — unit tests (#3473)
 *
 * @module libs/integrations/prestashop/src/infrastructure/mappers/__tests__
 */
import { derivePrestashopOrderReference } from '../prestashop-order-reference';

describe('derivePrestashopOrderReference', () => {
  it('should pass through a reference that already fits VARCHAR(9)', () => {
    expect(derivePrestashopOrderReference('ABC123')).toBe('ABC123');
  });

  it('should pass through a reference exactly 9 characters long', () => {
    expect(derivePrestashopOrderReference('ABCDEFGHI')).toBe('ABCDEFGHI');
  });

  it('should collapse a 36-character Allegro checkoutFormId to 9 characters', () => {
    const checkoutFormId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    const derived = derivePrestashopOrderReference(checkoutFormId);
    expect(derived).toHaveLength(9);
    expect(derived).not.toBe(checkoutFormId.slice(0, 9));
  });

  it('should be deterministic — same input always derives the same reference', () => {
    const checkoutFormId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    expect(derivePrestashopOrderReference(checkoutFormId)).toBe(
      derivePrestashopOrderReference(checkoutFormId),
    );
  });

  it('should derive distinct references for two ids sharing a long common prefix', () => {
    // Plain truncation would collide here; the hash-prefix approach must not.
    const a = derivePrestashopOrderReference('f47ac10b-0000-0000-0000-000000000001');
    const b = derivePrestashopOrderReference('f47ac10b-0000-0000-0000-000000000002');
    expect(a).not.toBe(b);
  });

  it('should trim surrounding whitespace before measuring length', () => {
    expect(derivePrestashopOrderReference('  ABC123  ')).toBe('ABC123');
  });

  it('should return an empty string for an empty/whitespace-only input', () => {
    expect(derivePrestashopOrderReference('   ')).toBe('');
  });
});

/**
 * FA(3) Cross-Border Guard — Unit Specs
 *
 * Pins the interim #1586 guard: domestic sales pass, cross-border sales are
 * refused with `KsefCrossBorderUnsupportedException` unless `allowCrossBorder`
 * is set, and country comparison is case/whitespace-insensitive so a lowercase
 * source ISO code never trips a false refusal.
 *
 * @module libs/integrations/ksef/src/infrastructure/fa3/domain
 */
import { assertCrossBorderHandled } from './fa3-cross-border-guard';
import { KsefCrossBorderUnsupportedException } from '../../../domain/exceptions/ksef-cross-border-unsupported.exception';

describe('assertCrossBorderHandled', () => {
  it('should pass for a domestic sale (same country)', () => {
    expect(() => assertCrossBorderHandled('PL', 'PL', false)).not.toThrow();
  });

  it('should pass domestic regardless of case/whitespace', () => {
    expect(() => assertCrossBorderHandled('PL', ' pl ', false)).not.toThrow();
  });

  it('should throw for a cross-border sale when not opted in', () => {
    expect(() => assertCrossBorderHandled('PL', 'DE', false)).toThrow(
      KsefCrossBorderUnsupportedException,
    );
  });

  it('should carry the seller and buyer countries on the exception', () => {
    try {
      assertCrossBorderHandled('PL', 'de', false);
      fail('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(KsefCrossBorderUnsupportedException);
      const ex = error as KsefCrossBorderUnsupportedException;
      expect(ex.sellerCountry).toBe('PL');
      expect(ex.buyerCountry).toBe('DE');
    }
  });

  it('should suppress the throw when the connection opted into cross-border', () => {
    expect(() => assertCrossBorderHandled('PL', 'DE', true)).not.toThrow();
  });

  it('should not treat an empty/absent buyer country as cross-border', () => {
    expect(() => assertCrossBorderHandled('PL', '', false)).not.toThrow();
  });
});

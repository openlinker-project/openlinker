/**
 * Erli Buyable-Problem Mapper Tests
 *
 * The coverage assertion is the point of this file (#2231): every value of
 * Erli's `buyableProblems` enum must have an operator-facing sentence, so an
 * enum member added upstream fails the build instead of quietly rendering an
 * internal token to a seller.
 */
import { mapErliBuyableProblems } from '../erli-buyable-problem.mapper';
import { ErliBuyableProblemValues } from '../erli-product.types';

describe('mapErliBuyableProblems (#2231)', () => {
  it('should map every declared Erli problem to a distinct operator-facing message', () => {
    const errors = mapErliBuyableProblems([...ErliBuyableProblemValues]);

    expect(errors).toHaveLength(ErliBuyableProblemValues.length);
    for (const error of errors) {
      expect(error.summary?.length ?? 0).toBeGreaterThan(0);
      expect(error.message.length).toBeGreaterThan(0);
      // Erli has no rejection status, so the copy must never say the OFFER was
      // rejected. Saying Erli rejected a price or a title is a different and
      // accurate statement, and stays allowed.
      expect(`${error.summary ?? ''} ${error.message}`).not.toMatch(
        /offer (was |is )?rejected|rejected (the |this )offer/i,
      );
    }
    // Distinct: a shared sentence would tell the operator nothing about which
    // of two problems to fix.
    expect(new Set(errors.map((error) => error.message)).size).toBe(errors.length);
    expect(new Set(errors.map((error) => error.summary)).size).toBe(errors.length);
  });

  it('should carry each raw Erli code through untranslated', () => {
    const errors = mapErliBuyableProblems([...ErliBuyableProblemValues]);

    expect([...errors.map((error) => error.code)].sort()).toEqual(
      [...ErliBuyableProblemValues].sort(),
    );
  });

  it('should scope exactly the two unambiguously shop-level reasons to the account', () => {
    const errors = mapErliBuyableProblems([...ErliBuyableProblemValues]);

    expect(
      errors.filter((error) => error.scope === 'account').map((error) => error.code),
    ).toEqual(['shop-activity', 'shopKyc']);
  });

  it('should keep `blocked` on the offer, since Erli says it may be per-offer', () => {
    // Scoping it to the account pulls it off the row and into a
    // once-per-connection banner, so a genuinely offer-level block becomes
    // invisible on the offer it blocks. Over-reporting is the recoverable arm.
    const errors = mapErliBuyableProblems(['blocked']);

    expect(errors[0]?.scope).toBe('offer');
  });

  it('should order shop-level and money-blocking reasons ahead of a deliberate switch-off', () => {
    const errors = mapErliBuyableProblems(['active', 'translations', 'missingPrice', 'shopKyc']);

    expect(errors.map((error) => error.code)).toEqual([
      'shopKyc',
      'missingPrice',
      'translations',
      'active',
    ]);
  });

  it('should surface an unrecognised code with its raw value rather than dropping it', () => {
    const errors = mapErliBuyableProblems(['somethingNew']);

    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('somethingNew');
    expect(errors[0].message).toContain('somethingNew');
    expect(errors[0].scope).toBe('offer');
  });

  it('should sort an unrecognised code after every known one', () => {
    const errors = mapErliBuyableProblems(['somethingNew', 'stock']);

    expect(errors.map((error) => error.code)).toEqual(['stock', 'somethingNew']);
  });

  it('should collapse duplicates so an overflow count cannot be inflated', () => {
    const errors = mapErliBuyableProblems(['stock', 'stock']);

    expect(errors.map((error) => error.code)).toEqual(['stock']);
  });

  it.each([[undefined], [null], [[]], [['', '   ']], [[42, {}, null]]])(
    'should return no errors for %p',
    (input) => {
      expect(mapErliBuyableProblems(input as never)).toEqual([]);
    },
  );
});

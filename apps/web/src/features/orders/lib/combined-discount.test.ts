import { describe, expect, it } from 'vitest';

import { describeCombinedDiscount } from './combined-discount';

describe('describeCombinedDiscount', () => {
  it('should show both parts and the sum when the channel and OpenLinker both discounted (E-44)', () => {
    const text = describeCombinedDiscount(
      { currency: 'PLN', channelDiscountTotal: 5, combinedDiscountTotal: 15 },
      10,
      'Allegro'
    );
    expect(text).toContain('at Allegro');
    expect(text).toContain('in OpenLinker');
    expect(text).toContain('=');
  });

  it('should not mention the channel when it reported no discount (E-44)', () => {
    const text = describeCombinedDiscount({ currency: 'PLN', channelDiscountTotal: null }, 10, 'Allegro');
    expect(text).not.toContain('at Allegro');
    expect(text).toContain('in OpenLinker');
  });

  it('should fall back to the OpenLinker amount when the payload lacks the new fields (E-44)', () => {
    expect(describeCombinedDiscount({ currency: 'PLN' }, 10, null)).toContain('in OpenLinker');
  });

  it('should say nothing when there is no discount at all (E-44)', () => {
    expect(describeCombinedDiscount({ currency: 'PLN' }, null, null)).toBeNull();
  });
});

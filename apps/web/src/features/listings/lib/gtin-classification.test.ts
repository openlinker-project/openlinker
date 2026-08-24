/**
 * GTIN classification tests (#2243)
 *
 * The carve-out is the point of this module, so it is tested as hard as the rule:
 * flagging a book prefix would break an entire vertical, and a false "in-store
 * barcode" warning is a claim about the operator's own catalogue.
 *
 * @module apps/web/src/features/listings/lib
 */
import { describe, expect, it } from 'vitest';

import { isRestrictedCirculationGtin } from './gtin-classification';

describe('isRestrictedCirculationGtin', () => {
  it('flags the 2xx restricted-circulation block', () => {
    expect(isRestrictedCirculationGtin('2001234567893')).toBe(true);
    expect(isRestrictedCirculationGtin('2991234567890')).toBe(true);
  });

  it('flags the 02x / 04x in-store blocks', () => {
    expect(isRestrictedCirculationGtin('0201234567890')).toBe(true);
    expect(isRestrictedCirculationGtin('0451234567890')).toBe(true);
  });

  it('flags the 98x / 99x coupon blocks', () => {
    expect(isRestrictedCirculationGtin('9801234567890')).toBe(true);
    expect(isRestrictedCirculationGtin('9991234567890')).toBe(true);
  });

  it('never flags ISSN / ISBN / ISMN prefixes - they are real trade item numbers', () => {
    expect(isRestrictedCirculationGtin('9771234567890')).toBe(false);
    expect(isRestrictedCirculationGtin('9781234567890')).toBe(false);
    expect(isRestrictedCirculationGtin('9791234567890')).toBe(false);
  });

  it('leaves an ordinary company prefix alone', () => {
    expect(isRestrictedCirculationGtin('5901234123457')).toBe(false);
    expect(isRestrictedCirculationGtin('4006381333931')).toBe(false);
  });

  it('says nothing about a length it cannot read a prefix block from', () => {
    // GTIN-8 / UPC-A / GTIN-14 carry no prefix block we can read reliably, so
    // the honest answer is "not classified", never "restricted".
    expect(isRestrictedCirculationGtin('20012345')).toBe(false);
    expect(isRestrictedCirculationGtin('200123456789')).toBe(false);
    expect(isRestrictedCirculationGtin('20012345678901')).toBe(false);
  });

  it('ignores surrounding whitespace and rejects non-digits', () => {
    expect(isRestrictedCirculationGtin('  2001234567893 ')).toBe(true);
    expect(isRestrictedCirculationGtin('200-1234-56789')).toBe(false);
    expect(isRestrictedCirculationGtin('')).toBe(false);
  });
});

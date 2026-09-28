/**
 * The bench's own copy rules, where the rule is arithmetic rather than a string.
 *
 * Nothing here asserts wording — that changes and should. It asserts the two
 * places the copy module does real work on live data, which is where it can be
 * silently wrong on a screen a packer is reading at speed.
 */
import { describe, expect, it } from 'vitest';

import { benchParcelCopy } from './bench-parcel.copy';

describe('benchParcelCopy.lines.attributesText', () => {
  // The shape that exposed the defect, copied from a live PrestaShop product
  // in the demo catalogue. Rendered values-only it read `tak · tak · tak · …`
  // — three identical words, in Polish, telling a packer holding the box
  // nothing at all about which bottle it is.
  const REAL = {
    Wariant: 'Black Tiger woda toaletowa 50ml',
    'Reklamowany w TV': 'tak',
    'Kosmetyk ekskluzywny': 'tak',
    'Produkt dla mężczyzn': 'tak',
  };

  it('names every attribute, so a bare value is never left to speak for itself', () => {
    const text = benchParcelCopy.lines.attributesText(REAL);

    expect(text).toContain('Reklamowany w TV: tak');
    expect(text).toContain('Wariant: Black Tiger woda toaletowa 50ml');
    // The regression itself: no run of bare values.
    expect(text).not.toMatch(/(^|· )tak( ·|$)/);
  });

  it('reads the same way every render, whatever order the attributes arrive in', () => {
    const shuffled = {
      'Produkt dla mężczyzn': 'tak',
      Wariant: 'Black Tiger woda toaletowa 50ml',
      'Kosmetyk ekskluzywny': 'tak',
      'Reklamowany w TV': 'tak',
    };

    expect(benchParcelCopy.lines.attributesText(shuffled)).toBe(
      benchParcelCopy.lines.attributesText(REAL)
    );
  });

  it('still reads well for the distinguishing attributes it was written for', () => {
    expect(benchParcelCopy.lines.attributesText({ Colour: 'Red', Size: 'M' })).toBe(
      'Colour: Red · Size: M'
    );
  });
});

/**
 * Bench line text, where the rule is arithmetic rather than a string.
 *
 * Nothing here asserts wording - that changes and should. It asserts the places
 * a line's text does real work on live data, which is where it can be silently
 * wrong on a screen a packer is reading at speed.
 */
import { describe, expect, it } from 'vitest';

import { formatVariantAttributes } from '../../../shared/lib/variant-attributes';
import { formatBenchLineCodes, formatBenchWeight } from './bench-line-text';

describe('formatVariantAttributes on a bench line', () => {
  // The shape that exposed the defect, copied from a live product in the demo
  // catalogue. Rendered values-only it read `tak · tak · tak · …` - three
  // identical words, in Polish, telling a packer holding the box nothing at all
  // about which bottle it is.
  const REAL = {
    Wariant: 'Black Tiger woda toaletowa 50ml',
    'Reklamowany w TV': 'tak',
    'Kosmetyk ekskluzywny': 'tak',
    'Produkt dla mężczyzn': 'tak',
  };

  it('names every attribute, so a bare value is never left to speak for itself', () => {
    const text = formatVariantAttributes(REAL);

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

    expect(formatVariantAttributes(shuffled)).toBe(formatVariantAttributes(REAL));
  });

  it('still reads well for the distinguishing attributes it was written for', () => {
    expect(formatVariantAttributes({ Colour: 'Red', Size: 'M' })).toBe('Colour: Red · Size: M');
  });
});

describe('formatBenchLineCodes', () => {
  it('omits whichever code the line does not carry', () => {
    expect(formatBenchLineCodes({ ean: '5901234123457', sku: null })).toBe('EAN 5901234123457');
    expect(formatBenchLineCodes({ ean: '5901234123457', sku: 'MUG-1' })).toBe(
      'EAN 5901234123457 · SKU MUG-1'
    );
  });
});

describe('formatBenchWeight', () => {
  it('shows grams below a kilogram and kilograms above it', () => {
    expect(formatBenchWeight(350)).toBe('350 g');
    expect(formatBenchWeight(2000)).toBe('2 kg');
    expect(formatBenchWeight(1250)).toBe('1.3 kg');
  });
});

import { describe, expect, it } from 'vitest';

import {
  distinguishingAttributeKeys,
  formatVariantAttributes,
  narrowAttributes,
} from './variant-attributes';

describe('distinguishingAttributeKeys', () => {
  it('should find nothing to distinguish when there is a single line', () => {
    expect(distinguishingAttributeKeys([{ attributes: { Size: 'L' } }]).size).toBe(0);
  });

  it('should keep only the keys whose values differ when lines disagree', () => {
    const keys = distinguishingAttributeKeys([
      { attributes: { Size: 'L', Colour: 'red' } },
      { attributes: { Size: 'M', Colour: 'red' } },
    ]);
    expect([...keys]).toEqual(['Size']);
  });

  it('should treat a key one line lacks as distinguishing when presence differs', () => {
    const keys = distinguishingAttributeKeys([
      { attributes: { Size: 'L' } },
      { attributes: null },
    ]);
    expect(keys.has('Size')).toBe(true);
  });
});

describe('narrowAttributes', () => {
  it('should return null when the line has no attributes', () => {
    expect(narrowAttributes(null, new Set())).toBeNull();
    expect(narrowAttributes({}, new Set(['Size']))).toBeNull();
  });

  it('should return everything when nothing distinguishes the lines', () => {
    expect(narrowAttributes({ Size: 'L', Colour: 'red' }, new Set())).toEqual({
      Size: 'L',
      Colour: 'red',
    });
  });

  it('should narrow to the distinguishing keys when some differ', () => {
    expect(narrowAttributes({ Size: 'L', Colour: 'red' }, new Set(['Size']))).toEqual({ Size: 'L' });
  });

  it('should fall back to every attribute when the line carries none of the distinguishing keys', () => {
    expect(narrowAttributes({ Colour: 'red' }, new Set(['Size']))).toEqual({ Colour: 'red' });
  });
});

describe('formatVariantAttributes', () => {
  it('should join sorted key-value pairs with a middle dot when given several attributes', () => {
    expect(formatVariantAttributes({ Rozmiar: 'L', Kolor: 'srebrny' })).toBe(
      'Kolor: srebrny · Rozmiar: L'
    );
  });

  it('should render one pair when given one attribute', () => {
    expect(formatVariantAttributes({ Size: 'L' })).toBe('Size: L');
  });
});

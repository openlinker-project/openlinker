/**
 * Plurals - unit tests
 *
 * @module shared/i18n
 */
import { describe, expect, it } from 'vitest';
import { formatPlural } from './plural';

const orders = {
  one: '{n} zamówienie',
  few: '{n} zamówienia',
  many: '{n} zamówień',
  other: '{n} zamówienia',
};

describe('formatPlural', () => {
  it.each([
    [1, '1 zamówienie'],
    [2, '2 zamówienia'],
    [5, '5 zamówień'],
    [12, '12 zamówień'],
    [22, '22 zamówienia'],
    [25, '25 zamówień'],
  ])('should pick the Polish form for %i', (count, expected) => {
    expect(formatPlural(count, orders, 'pl')).toBe(expected);
  });

  it('should pick English one/other', () => {
    const forms = { one: '{n} order', other: '{n} orders' };
    expect(formatPlural(1, forms, 'en')).toBe('1 order');
    expect(formatPlural(3, forms, 'en')).toBe('3 orders');
  });

  it('should fall back to other when a form is missing', () => {
    expect(formatPlural(5, { one: '{n} order', other: '{n} orders' }, 'pl')).toBe('5 orders');
  });

  it('should format the count for the language', () => {
    expect(formatPlural(1234, { one: '{n} x', other: '{n} x' }, 'en')).toBe('1,234 x');
  });
});

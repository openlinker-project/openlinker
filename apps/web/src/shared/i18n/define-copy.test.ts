/**
 * defineCopy / resolveCopy - unit tests
 *
 * Covers per-key English fallback, Polish-only plural categories, caching
 * and the compile-time guarantee that Polish cannot add keys English lacks.
 *
 * @module shared/i18n
 */
import { describe, expect, it } from 'vitest';
import { defineCopy, resolveCopy } from './define-copy';
import type { PluralForms } from './copy.types';

const ordersCopy = defineCopy({
  en: {
    title: 'Orders',
    subtitle: 'Orders from every connected sales channel.',
    attention: { one: '{n} order needs attention', other: '{n} orders need attention' },
  },
  pl: {
    title: 'Zamówienia',
    attention: {
      one: '{n} zamówienie wymaga uwagi',
      few: '{n} zamówienia wymagają uwagi',
      many: '{n} zamówień wymaga uwagi',
      other: '{n} zamówienia wymaga uwagi',
    },
  },
});

describe('resolveCopy', () => {
  it('should return English unchanged when the locale is en', () => {
    expect(resolveCopy(ordersCopy, 'en').title).toBe('Orders');
  });

  it('should return Polish when the key is translated', () => {
    expect(resolveCopy(ordersCopy, 'pl').title).toBe('Zamówienia');
  });

  it('should fall back to English per key when Polish is missing', () => {
    expect(resolveCopy(ordersCopy, 'pl').subtitle).toBe('Orders from every connected sales channel.');
  });

  it('should carry the Polish-only plural categories when the locale is pl', () => {
    const attention = resolveCopy(ordersCopy, 'pl').attention;
    expect(attention.few).toBe('{n} zamówienia wymagają uwagi');
    expect(attention.many).toBe('{n} zamówień wymaga uwagi');
  });

  it('should return the same object when read twice', () => {
    expect(resolveCopy(ordersCopy, 'pl')).toBe(resolveCopy(ordersCopy, 'pl'));
  });

  // The real assertion here is the `@ts-expect-error`, checked by `tsc -b`:
  // if Polish could carry an extra key the directive would itself fail.
  it('should reject a Polish key when English does not have it', () => {
    defineCopy({
      en: { title: 'Orders' },
      // @ts-expect-error - Polish may not add keys English lacks
      pl: { title: 'Zamówienia', extra: 'nie ma w angielskim' },
    });
    expect(true).toBe(true);
  });

  it('should treat an object as a section when it has keys besides one and other', () => {
    const copy = defineCopy({
      en: { stats: { one: 'One', other: 'Other', title: 'Totals' } },
      pl: { stats: { title: 'Podsumowanie' } },
    });
    // A section keeps every key; a plural would have dropped `title` from the type.
    const title: string = resolveCopy(copy, 'pl').stats.title;
    expect(title).toBe('Podsumowanie');
  });

  it('should type an object as a plural when its keys are exactly one and other', () => {
    const copy = defineCopy({
      en: { count: { one: '{n} item', other: '{n} items' } },
      pl: {},
    });
    const forms: PluralForms = resolveCopy(copy, 'en').count;
    expect(forms.other).toBe('{n} items');
  });
});

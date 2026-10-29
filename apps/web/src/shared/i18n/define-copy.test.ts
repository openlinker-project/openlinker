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
  it('should return English unchanged for en', () => {
    expect(resolveCopy(ordersCopy, 'en').title).toBe('Orders');
  });

  it('should return Polish where it exists', () => {
    expect(resolveCopy(ordersCopy, 'pl').title).toBe('Zamówienia');
  });

  it('should fall back to English per key when Polish is missing', () => {
    expect(resolveCopy(ordersCopy, 'pl').subtitle).toBe('Orders from every connected sales channel.');
  });

  it('should carry Polish-only plural categories', () => {
    const attention = resolveCopy(ordersCopy, 'pl').attention;
    expect(attention.few).toBe('{n} zamówienia wymagają uwagi');
    expect(attention.many).toBe('{n} zamówień wymaga uwagi');
  });

  it('should return the same object for repeated reads', () => {
    expect(resolveCopy(ordersCopy, 'pl')).toBe(resolveCopy(ordersCopy, 'pl'));
  });

  it('should reject a Polish key English does not have', () => {
    defineCopy({
      en: { title: 'Orders' },
      // @ts-expect-error - Polish may not add keys English lacks
      pl: { title: 'Zamówienia', extra: 'nie ma w angielskim' },
    });
    expect(true).toBe(true);
  });
});

/**
 * useFormat / usePlural / Zod messages - unit tests
 *
 * The hooks follow the provider's language, and Zod's default messages
 * switch with it.
 *
 * @module shared/i18n
 */
import { renderHook } from '@testing-library/react';
import type { PropsWithChildren, ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LocaleProvider } from './locale-provider';
import type { SupportedLocale } from './i18n.types';
import { useFormat } from './use-format';
import { usePlural } from './use-plural';
import { applyZodLocale } from './zod-locale';

function wrapperFor(locale: SupportedLocale) {
  return function Wrapper({ children }: PropsWithChildren): ReactElement {
    return <LocaleProvider locale={locale}>{children}</LocaleProvider>;
  };
}

/** Intl separates groups with a narrow no-break space; compare on plain spaces. */
const plain = (text: string): string => text.replace(/\s/g, ' ');

afterEach(() => {
  applyZodLocale('en');
});

describe('useFormat', () => {
  it('should format numbers, percentages and lists in Polish when the locale is pl', () => {
    const { result } = renderHook(() => useFormat(), { wrapper: wrapperFor('pl') });
    expect(plain(result.current.number(12345))).toBe('12 345');
    expect(result.current.percent(0.155).replace(/\s/g, '')).toBe('15,5%');
    expect(result.current.list(['a', 'b'])).toBe('a i b');
  });

  it('should format numbers, percentages and lists in English when the locale is en', () => {
    const { result } = renderHook(() => useFormat(), { wrapper: wrapperFor('en') });
    expect(result.current.number(12345)).toBe('12,345');
    expect(result.current.percent(0.155)).toBe('15.5%');
    expect(result.current.list(['a', 'b'])).toBe('a and b');
  });

  it('should format dates in Polish when the locale is pl', () => {
    const { result } = renderHook(() => useFormat(), { wrapper: wrapperFor('pl') });
    expect(plain(result.current.date('2026-03-28T23:59:00.000Z'))).toBe('28 mar 2026');
    expect(plain(result.current.dateTime('2026-03-28T23:59:00.000Z'))).toBe('28 mar 2026, 23:59');
  });
});

describe('usePlural', () => {
  const forms = {
    one: '{n} zamówienie',
    few: '{n} zamówienia',
    many: '{n} zamówień',
    other: '{n} zamówienia',
  };

  it('should pick the Polish form when the locale is pl', () => {
    const { result } = renderHook(() => usePlural(), { wrapper: wrapperFor('pl') });
    expect(result.current(2, forms)).toBe('2 zamówienia');
    expect(result.current(5, forms)).toBe('5 zamówień');
  });

  it('should pick the English form when the locale is en', () => {
    const { result } = renderHook(() => usePlural(), { wrapper: wrapperFor('en') });
    expect(result.current(2, { one: '{n} order', other: '{n} orders' })).toBe('2 orders');
  });
});

describe('applyZodLocale', () => {
  const message = (): string => {
    const parsed = z.string().safeParse(1);
    return parsed.success ? '' : (parsed.error.issues[0]?.message ?? '');
  };

  it('should switch Zod default messages when the locale changes', () => {
    applyZodLocale('en');
    const english = message();
    expect(english).toMatch(/invalid/i);

    applyZodLocale('pl');
    const polish = message();
    expect(polish).not.toBe(english);
    expect(polish).toMatch(/nieprawidłow/i);

    applyZodLocale('en');
    expect(message()).toBe(english);
  });
});

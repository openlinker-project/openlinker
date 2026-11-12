/**
 * mergeOverEnglish - unit tests
 *
 * The fallback rules, and the inspector's tagging hook (#4017): every kind is
 * tagged only when instrumentation is passed, never otherwise.
 *
 * @module shared/i18n
 */
import { describe, expect, it } from 'vitest';
import { mergeOverEnglish, type FallbackInfo } from './merge';

const english = {
  title: 'Orders',
  subtitle: 'Every channel',
  empty: 'Nothing here',
  count: { one: '{n} order', other: '{n} orders' },
};

function recorder(): { calls: FallbackInfo[]; tag: (info: FallbackInfo) => string } {
  const calls: FallbackInfo[] = [];
  return {
    calls,
    tag: (info): string => {
      calls.push(info);
      return `[${info.kind}:${info.path.join('.')}]`;
    },
  };
}

describe('mergeOverEnglish', () => {
  it('should fall back to English per key when no instrumentation is passed', () => {
    const merged = mergeOverEnglish(english, { title: 'Zamówienia', empty: '' });
    expect(merged).toEqual({
      title: 'Zamówienia',
      subtitle: 'Every channel',
      empty: 'Nothing here',
      count: { one: '{n} order', other: '{n} orders' },
    });
  });

  it('should tag a missing key, an empty string and a missing plural form when instrumented', () => {
    const tagger = recorder();
    const merged = mergeOverEnglish(
      english,
      { title: 'Zamówienia', empty: '', count: { one: '{n} zamówienie', other: '{n} zamówienia' } },
      { tagger, locale: 'pl', namespace: 'orders' },
    ) as Record<string, unknown>;

    expect(merged.title).toBe('Zamówienia');
    expect(merged.subtitle).toBe('[missing:subtitle]');
    expect(merged.empty).toBe('[empty:empty]');
    expect(merged.count).toEqual({
      one: '{n} zamówienie',
      other: '{n} zamówienia',
      few: '[plural-form:count.few]',
      many: '[plural-form:count.many]',
    });
    expect(tagger.calls.find((call) => call.kind === 'plural-form')?.shown).toBe('{n} zamówienia');
    expect(tagger.calls.every((call) => call.namespace === 'orders')).toBe(true);
  });

  it('should not tag a plural whose Polish forms are all present', () => {
    const tagger = recorder();
    mergeOverEnglish(
      { count: english.count },
      { count: { one: 'a', few: 'b', many: 'c', other: 'd' } },
      { tagger, locale: 'pl', namespace: 'orders' },
    );
    expect(tagger.calls).toEqual([]);
  });

  it('should report the forms of a plural with no translated other as missing, from untagged English', () => {
    const tagger = recorder();
    const merged = mergeOverEnglish(
      { count: english.count },
      { count: { one: '{n} zamówienie' } },
      { tagger, locale: 'pl', namespace: 'orders' },
    ) as { count: Record<string, string> };

    expect(merged.count.few).toBe('[missing:count.few]');
    expect(merged.count.many).toBe('[missing:count.many]');
    const forms = tagger.calls.filter((call) => call.path[1] === 'few' || call.path[1] === 'many');
    expect(forms.map((call) => call.shown)).toEqual(['{n} orders', '{n} orders']);
  });

  it('should tag every key of a namespace that has no translation at all', () => {
    const tagger = recorder();
    mergeOverEnglish({ a: 'A', b: { c: 'C' } }, undefined, { tagger, locale: 'pl', namespace: 'x' });
    expect(tagger.calls.map((call) => call.path.join('.'))).toEqual(['a', 'b.c']);
  });
});

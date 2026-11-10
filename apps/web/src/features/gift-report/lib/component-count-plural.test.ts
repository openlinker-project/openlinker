import { describe, expect, it } from 'vitest';
import { formatPlural } from '../../../shared/i18n/plural';
import { mergeOverEnglish } from '../../../shared/i18n/merge';
import en from '../../../locales/en/gift-report.json';
import pl from '../../../locales/pl/gift-report.json';

type Forms = { one: string; other: string; few?: string; many?: string };

describe('bundle component count, Polish copy merged over English', () => {
  const forms = (mergeOverEnglish(en, pl) as { bundles: { componentCount: Forms } }).bundles
    .componentCount;

  it.each([
    [1, '1 składnik'],
    [2, '2 składniki'],
    [5, '5 składników'],
    [22, '22 składniki'],
  ])('should pick the right form for %i', (count, expected) => {
    expect(formatPlural(count, forms, 'pl')).toBe(expected);
  });
});

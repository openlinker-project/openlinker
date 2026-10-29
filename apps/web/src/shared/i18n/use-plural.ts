/**
 * usePlural Hook
 *
 * `plural(count, forms, params?)` bound to the active language. Use it for
 * every count shown to an operator instead of `n === 1 ? '' : 's'`.
 *
 * @module shared/i18n
 */
import { useCallback } from 'react';
import type { PluralForms } from './copy.types';
import type { InterpolationParams } from './interpolate';
import { formatPlural } from './plural';
import { useLocale } from './use-locale';

export type PluralFn = (count: number, forms: PluralForms, params?: InterpolationParams) => string;

export function usePlural(): PluralFn {
  const { locale } = useLocale();
  return useCallback(
    (count: number, forms: PluralForms, params?: InterpolationParams) =>
      formatPlural(count, forms, locale, params),
    [locale],
  );
}

/**
 * useCopy Hook
 *
 * Returns a feature's copy for the active language, with English filling any
 * key Polish does not have yet. The resolved object is cached per copy file
 * and language, so it is referentially stable across renders.
 *
 * @module shared/i18n
 */
import { useLocale } from './use-locale';
import { resolveCopy } from './define-copy';
import type { CopyTree, LocaleCopy, ResolvedCopy } from './copy.types';

export function useCopy<T extends CopyTree>(copy: LocaleCopy<T>): ResolvedCopy<T> {
  const { locale } = useLocale();
  return resolveCopy(copy, locale);
}

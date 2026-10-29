/**
 * useCopy Hook
 *
 * Returns a feature's copy for the active language, with English filling any
 * key Polish does not have yet. The resolved object is cached per copy file
 * and language, so it is referentially stable across renders. Under the
 * development-only pseudo-language it returns the pseudo-localized English.
 *
 * @module shared/i18n
 */
import { useContext } from 'react';
import { LocaleContext } from './locale-provider';
import { getLocale } from './active-locale';
import { resolveCopy } from './define-copy';
import { resolvePseudoCopy } from './pseudo';
import type { CopyTree, LocaleCopy, ResolvedCopy } from './copy.types';

export function useCopy<T extends CopyTree>(copy: LocaleCopy<T>): ResolvedCopy<T> {
  const ctx = useContext(LocaleContext);
  if (ctx?.pseudo) return resolvePseudoCopy(copy);
  return resolveCopy(copy, ctx?.locale ?? getLocale());
}

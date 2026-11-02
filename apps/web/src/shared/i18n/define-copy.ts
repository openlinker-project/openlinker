/**
 * Copy definition and resolution
 *
 * `defineCopy` is how a feature declares its copy file: English infers the
 * shape and Polish is checked against it. `resolveCopy` produces the object a
 * component reads for one language, falling back to English per key so a
 * partially translated file never shows a blank.
 *
 * @module shared/i18n
 */
import type { CopyTree, LocaleCopy, ResolvedCopy } from './copy.types';
import type { SupportedLocale } from './i18n.types';
import { mergeOverEnglish } from './merge';

export function defineCopy<const T extends CopyTree>(copy: LocaleCopy<T>): LocaleCopy<T> {
  return copy;
}

const cache = new WeakMap<object, Map<SupportedLocale, unknown>>();

export function resolveCopy<T extends CopyTree>(
  copy: LocaleCopy<T>,
  locale: SupportedLocale,
): ResolvedCopy<T> {
  let perLocale = cache.get(copy);
  if (!perLocale) {
    perLocale = new Map();
    cache.set(copy, perLocale);
  }
  let resolved = perLocale.get(locale);
  if (resolved === undefined) {
    resolved = locale === 'en' ? copy.en : mergeOverEnglish(copy.en, copy.pl);
    perLocale.set(locale, resolved);
  }
  return resolved as ResolvedCopy<T>;
}

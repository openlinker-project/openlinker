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

export function defineCopy<const T extends CopyTree>(copy: LocaleCopy<T>): LocaleCopy<T> {
  return copy;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function merge(source: unknown, override: unknown): unknown {
  if (typeof source === 'string') {
    return typeof override === 'string' ? override : source;
  }
  if (!isRecord(source)) return source;
  const result: Record<string, unknown> = {};
  const patch = isRecord(override) ? override : {};
  for (const key of Object.keys(source)) {
    result[key] = merge(source[key], patch[key]);
  }
  // Polish-only plural categories (few, many) have no English counterpart.
  for (const key of Object.keys(patch)) {
    if (!(key in result) && typeof patch[key] === 'string') result[key] = patch[key];
  }
  return result;
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
    resolved = locale === 'en' ? copy.en : merge(copy.en, copy.pl);
    perLocale.set(locale, resolved);
  }
  return resolved as ResolvedCopy<T>;
}

/**
 * Intl object cache
 *
 * Building an `Intl.*` formatter is far more expensive than calling one, and
 * a table page formats several values per row on every render. The formatters
 * are immutable, so one instance per language tag and options is shared.
 *
 * @module shared/i18n
 */

const cache = new Map<string, unknown>();

function cached<T>(kind: string, tag: string, options: object | undefined, build: () => T): T {
  const key = `${kind}|${tag}|${options ? JSON.stringify(options) : ''}`;
  let value = cache.get(key) as T | undefined;
  if (value === undefined) {
    value = build();
    cache.set(key, value);
  }
  return value;
}

export function numberFormat(tag: string, options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  return cached('number', tag, options, () => new Intl.NumberFormat(tag, options));
}

export function pluralRules(tag: string): Intl.PluralRules {
  return cached('plural', tag, undefined, () => new Intl.PluralRules(tag));
}

export function dateTimeFormat(
  tag: string,
  options?: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  return cached('date', tag, options, () => new Intl.DateTimeFormat(tag, options));
}

export function listFormat(tag: string, options?: Intl.ListFormatOptions): Intl.ListFormat {
  return cached('list', tag, options, () => new Intl.ListFormat(tag, options));
}

export function regionNames(tag: string): Intl.DisplayNames {
  return cached('region', tag, undefined, () => new Intl.DisplayNames([tag], { type: 'region' }));
}

export function collator(tag: string): Intl.Collator {
  return cached('collator', tag, undefined, () => new Intl.Collator(tag));
}

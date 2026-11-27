/**
 * Pseudo-localization
 *
 * A development-only language (`?lang=xx`) generated from English: accented
 * letters, about 40% longer, wrapped in brackets. Switching to it shows every
 * string that is still hardcoded (it stays plain English) and every layout
 * that breaks under longer copy, before any real translation exists.
 * `{placeholders}` and `<tags>` are left intact.
 *
 * @module shared/i18n
 */
export const PSEUDO_LOCALE_CODE = 'xx';

const ACCENTED: Readonly<Record<string, string>> = {
  a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', y: 'ý', c: 'ç', n: 'ñ', s: 'š', z: 'ž',
  A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú', Y: 'Ý', C: 'Ç', N: 'Ñ', S: 'Š', Z: 'Ž',
};

const PROTECTED = /(\{\w+\}|<\/?\w+>)/;

export function pseudoLocalize(text: string): string {
  const accented = text
    .split(PROTECTED)
    .map((part) => (PROTECTED.test(part) ? part : part.replace(/[A-Za-z]/g, (c) => ACCENTED[c] ?? c)))
    .join('');
  const padding = '~'.repeat(Math.max(1, Math.ceil(text.length * 0.4)));
  return `[${accented} ${padding}]`;
}

/** Every string of a namespace, pseudo-localized; the shape is unchanged. */
export function pseudoTree(value: unknown): unknown {
  if (typeof value === 'string') return pseudoLocalize(value);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, pseudoTree(inner)]));
}

/**
 * Product list search helpers (pure).
 *
 * Folding runs in TypeScript on the term and via `translate()` on the column
 * side, never `unaccent()`: that extension is optional and correctness must not
 * depend on it being installed (same stance as DestinationCategory.searchText).
 */

const FOLD_FROM = 'ąćęłńóśźżĄĆĘŁŃÓŚŹŻ';
const FOLD_TO = 'acelnoszzACELNOSZZ';

/** Postgres fragment folding Polish diacritics; caller applies ILIKE (case-insensitive). */
export const foldSqlExpr = (column: string): string =>
  `translate(COALESCE(${column}, ''), '${FOLD_FROM}', '${FOLD_TO}')`;

export function foldPolish(value: string): string {
  let out = '';
  for (const ch of value) {
    const idx = FOLD_FROM.indexOf(ch);
    out += idx >= 0 ? FOLD_TO[idx] : ch;
  }
  return out;
}

/** Whitespace-separated terms, folded and LIKE-escaped. Empty input yields []. */
export function toSearchTerms(search: string): string[] {
  return foldPolish(search)
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => t.replace(/[\\%_]/g, '\\$&'));
}

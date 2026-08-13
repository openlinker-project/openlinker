/**
 * Destination Category Search Normalization (#1979, ADR-037)
 *
 * Pure helper that derives the trigram-matched `search_text` for a category
 * name, and normalizes an incoming query the identical way. Both halves of
 * `search` call THIS function, so the stored column and the query can never
 * drift apart.
 *
 * Why normalize in application code rather than with the `unaccent` extension:
 * `unaccent(text)` is declared STABLE, not IMMUTABLE (it depends on a mutable
 * dictionary), so Postgres rejects it in an index expression — and a GIN index
 * on the raw column cannot serve an `unaccent(name) % $1` predicate either,
 * leaving every search a sequential scan. The documented workaround is an
 * IMMUTABLE wrapper function, which lies to the planner and silently corrupts
 * the index if the dictionary ever changes. Normalizing here needs no extension
 * beyond `pg_trgm`, is unit-testable without a database, and is locale-agnostic.
 *
 * Domain-only — zero framework imports. Mirrors the pure-normalizer shape of
 * `shipping/domain/pickup-point-query.ts`.
 *
 * @module libs/core/src/listings/domain
 */

/**
 * Letters that NFD does NOT decompose, because they are distinct letters rather
 * than a base letter plus a combining mark.
 *
 * The list is ADDITIVE — it covers the letters the shipped destinations
 * actually use, not every such letter in Unicode. Turkish `ı` (U+0131) and
 * Icelandic `þ`/`ð` belong to the same class and are deliberately absent until
 * a destination needs them; add them here rather than reaching for a
 * transliteration dependency.
 *
 * `ł` (U+0142) is the one that matters here and is easy to miss: `Odzież`
 * normalizes fine (`ż` is `z` + combining dot above), but `Artykuły` would keep
 * its `ł` forever, so an operator typing `artykuly` would get nothing — in a
 * Polish taxonomy that is one of the most common words there is. The others are
 * included so the same trap doesn't reappear for a non-Polish destination.
 */
const NON_DECOMPOSING_LETTERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/ł/g, 'l'],
  [/đ/g, 'd'],
  [/ø/g, 'o'],
  [/ß/g, 'ss'],
  [/æ/g, 'ae'],
  [/œ/g, 'oe'],
];

/**
 * Lowercase, fold diacritics, collapse whitespace.
 *
 * Diacritic folding is what makes `odziez` match `Odzież` — the common case for
 * a Polish taxonomy typed on a keyboard without them. It does NOT solve
 * cross-language search (`shoes` will never match `Buty`) — no lexical method
 * can; that is a sync-time `Accept-Language` concern, tracked as **#2059**.
 *
 * Lowercasing happens BEFORE the letter map so the map only needs lowercase
 * entries.
 */
export function normalizeCategorySearchText(value: string): string {
  let normalized = value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

  for (const [pattern, replacement] of NON_DECOMPOSING_LETTERS) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized.trim().replace(/\s+/g, ' ');
}

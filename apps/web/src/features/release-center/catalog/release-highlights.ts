/**
 * Curated release highlights (#4145, ADR-085)
 *
 * Which changelog entries the update dialog features, per minor. Picked by
 * hand: an automatic "first of Features" always lands on scope `api` because
 * entries are alphabetical by scope. Entries are referenced by commit hash (at
 * least 7 hex characters) so the text stays in CHANGELOG.md; the catalog check
 * fails the build when a minor lacks a list or a hash is not in the changelog.
 *
 * @module features/release-center
 */

/** Key is `major.minor`. */
export const RELEASE_HIGHLIGHTS: Readonly<Record<string, readonly string[]>> = {
  '0.19': ['4188fec', 'ba4c7bd'],
};

/** Minors before this predate the release center and need no highlights. */
export const HIGHLIGHTS_REQUIRED_FROM = '0.19';

export function highlightsForMinor(majorMinor: string): readonly string[] {
  return RELEASE_HIGHLIGHTS[majorMinor] ?? [];
}

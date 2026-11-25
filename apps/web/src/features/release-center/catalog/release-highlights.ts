/**
 * Curated release highlights (#4145, ADR-086)
 *
 * Which changelog entries the update dialog features, per minor. Picked by
 * hand: an automatic "first of Features" always lands on scope `api` because
 * entries are alphabetical by scope. Entries are referenced by commit hash (at
 * least 7 hex characters) so the text stays in CHANGELOG.md; the catalog check
 * fails the build when a minor lacks a list or a hash is not a commit in the
 * repository's history (the changelog section is written later, by the
 * release-please PR, so it cannot be the proof).
 *
 * @module features/release-center
 */

/** Key is `major.minor`. */
export const RELEASE_HIGHLIGHTS: Readonly<Record<string, readonly string[]>> = {
  // A minor's list is written on main as soon as its changes are merged: the hashes only have to exist in git
  // history, not yet in CHANGELOG.md (the catalog check fails the release PR if the list is missing).
};

/** Minors before this predate the release center and need no highlights. */
export const HIGHLIGHTS_REQUIRED_FROM = '0.21';

export function highlightsForMinor(majorMinor: string): readonly string[] {
  return RELEASE_HIGHLIGHTS[majorMinor] ?? [];
}

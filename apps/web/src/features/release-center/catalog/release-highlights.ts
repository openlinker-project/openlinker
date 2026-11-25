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
  // Most important to an operator first; the dialog features the first four that the changelog lists.
  '0.21': [
    '75bc68c', // release center: what's new, guides, notifications, update settings (#4155)
    '115c728', // saved views for list tables (#4251)
    'ff596ed', // hide old orders and erase buyer data by retention rules (#4290)
    'aefa5a1', // choose where order sync starts for Shopify, Shoper and Subiekt (#4287)
    '60cfbbb', // choose where order sync starts, and change it later (#4252)
    'd7f4661', // Subiekt GT sets and multipacks (#4267)
    'ebee8ca', // text size switch in the user menu (#4264)
    'a0f7164', // order detail page tabs (#4288)
  ],
};

/** Minors before this predate the release center and need no highlights. */
export const HIGHLIGHTS_REQUIRED_FROM = '0.21';

export function highlightsForMinor(majorMinor: string): readonly string[] {
  return RELEASE_HIGHLIGHTS[majorMinor] ?? [];
}

/**
 * Release Center Types
 *
 * Closed vocabularies, limits and the pure version rules (ADR-085). The
 * version rules live here because the cursor comparison and its SQL twin
 * (`WHERE (major, minor, patch, rank) < (...)`) must change together.
 *
 * @module libs/core/src/release-center/domain/types
 */

export const ReleaseItemScopeValues = ['installation', 'user'] as const;
export type ReleaseItemScope = (typeof ReleaseItemScopeValues)[number];

/** `done` / `not_applicable` are installation decisions; the rest are per-user. */
export const ReleaseItemStatusValues = [
  'open',
  'done',
  'not_applicable',
  'archived',
  'snoozed',
  'deleted',
] as const;
export type ReleaseItemStatus = (typeof ReleaseItemStatusValues)[number];

export const InstallationItemStatusValues = ['open', 'done', 'not_applicable'] as const;
export const UserItemStatusValues = ['open', 'archived', 'snoozed', 'deleted'] as const;

/** How an installation step became done: observed from a save, or marked by an admin. */
export const ReleaseDoneViaValues = ['auto', 'manual'] as const;
export type ReleaseDoneVia = (typeof ReleaseDoneViaValues)[number];

export const USER_ITEM_STATE_LIMIT = 500;
export const INSTALLATION_ITEM_STATE_LIMIT = 2000;
export const RELEASE_STATE_BATCH_MAX = 50;

/** Item ids, optionally `stepId:connectionId`. */
export const RELEASE_ITEM_KEY_PATTERN = /^[a-z0-9][a-z0-9:-]{0,127}$/;

export function isReleaseItemKey(value: unknown): value is string {
  return typeof value === 'string' && RELEASE_ITEM_KEY_PATTERN.test(value);
}

export function isReleaseItemStatus(value: unknown): value is ReleaseItemStatus {
  return (ReleaseItemStatusValues as readonly unknown[]).includes(value);
}

export function isReleaseDoneVia(value: unknown): value is ReleaseDoneVia {
  return (ReleaseDoneViaValues as readonly unknown[]).includes(value);
}

/** Version as stored: display text plus the four comparison numbers. */
export interface ParsedReleaseVersion {
  text: string;
  major: number;
  minor: number;
  patch: number;
  rank: number;
}

const RANK_FINAL = 3_000_000;
const RANK_BASE = { rc: 2_000_000, beta: 1_000_000, alpha: 0 } as const;
const MAX_PRERELEASE_N = 999_999;
const VERSION_RE = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-(alpha|beta|rc)\.(\d{1,6}))?$/;

/**
 * Parse `1.2.3` or `1.2.3-rc.4` (alpha, beta, rc). Anything else is `null`:
 * the caller refuses it rather than guessing a rank for an unknown prerelease
 * tag, since a wrong rank would let a regression through the cursor guard.
 */
export function parseReleaseVersion(input: unknown): ParsedReleaseVersion | null {
  if (typeof input !== 'string') return null;
  const match = VERSION_RE.exec(input.trim());
  if (!match) return null;
  const [, maj, min, pat, tag, n] = match;
  const rank =
    tag === undefined
      ? RANK_FINAL
      : RANK_BASE[tag as keyof typeof RANK_BASE] + Math.min(Number(n), MAX_PRERELEASE_N);
  return {
    text: input.trim().replace(/^v/, ''),
    major: Number(maj),
    minor: Number(min),
    patch: Number(pat),
    rank,
  };
}

/** Negative when `a` is older than `b`, zero when equal, positive when newer. */
export function compareReleaseVersions(
  a: Pick<ParsedReleaseVersion, 'major' | 'minor' | 'patch' | 'rank'>,
  b: Pick<ParsedReleaseVersion, 'major' | 'minor' | 'patch' | 'rank'>
): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch || a.rank - b.rank;
}

/** A write to one item. `snoozedUntil` is meaningful only for `snoozed`. */
export interface ReleaseItemStateChange {
  itemKey: string;
  status: ReleaseItemStatus;
  doneVia?: ReleaseDoneVia | null;
  snoozedUntil?: Date | null;
}

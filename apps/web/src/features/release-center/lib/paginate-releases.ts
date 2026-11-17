/**
 * Release list pagination (#4154)
 *
 * Pure slicing for the What's new page. The page number lives in the URL, so
 * every input is untrusted text: anything that is not a positive integer, or
 * that points past the last page, resolves to a page that exists instead of an
 * empty list.
 *
 * @module features/release-center/lib
 */

export const RELEASES_PAGE_SIZE = 5;

export interface ReleasePage<T> {
  /** One-based page actually shown, after clamping. */
  page: number;
  pageCount: number;
  /** Zero-based index of the first item on the page. */
  offset: number;
  items: T[];
}

/** Resolves a raw `?page=` value to a valid one-based page. */
export function clampPage(raw: string | null, pageCount: number): number {
  const parsed = raw !== null && /^\d+$/.test(raw) ? Number(raw) : 1;
  return Math.min(Math.max(1, parsed), Math.max(1, pageCount));
}

export function paginateReleases<T>(
  items: readonly T[],
  rawPage: string | null,
  pageSize: number = RELEASES_PAGE_SIZE
): ReleasePage<T> {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = clampPage(rawPage, pageCount);
  const offset = (page - 1) * pageSize;
  return { page, pageCount, offset, items: items.slice(offset, offset + pageSize) };
}

/**
 * Finds the release a deep link names: an exact `major.minor.patch`, or a
 * `major.minor` meaning the newest release of that minor. Input is sorted
 * newest first, so the first match is the newest.
 */
export function findReleaseIndex(
  releases: readonly { version: string }[],
  target: string | null
): number {
  if (!target) return -1;
  const exact = releases.findIndex((r) => r.version === target);
  if (exact >= 0) return exact;
  return releases.findIndex((r) => r.version.split('.').slice(0, 2).join('.') === target);
}

/** The page that contains a given item index. */
export function pageOfIndex(index: number, pageSize: number = RELEASES_PAGE_SIZE): number {
  return Math.floor(index / pageSize) + 1;
}

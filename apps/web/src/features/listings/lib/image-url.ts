/**
 * Image URL validation
 *
 * Pure check for an image address an operator types into the bulk offer
 * editor. The list it guards is submitted verbatim as the offer's image URLs,
 * and a marketplace rejects a bad one only after the batch is submitted - far
 * from the field that caused it. So the editor refuses, at add time, anything
 * that cannot possibly be an image address. Whether the address actually
 * serves an image is not knowable here; the thumbnail's own load failure is
 * that signal (see `bulk-image-strip.tsx`).
 *
 * @module apps/web/src/features/listings/lib
 */

export const ImageUrlProblemValues = ['empty', 'not-a-url', 'duplicate'] as const;
export type ImageUrlProblem = (typeof ImageUrlProblemValues)[number];

export type ImageUrlCheck =
  | { ok: true; url: string }
  | { ok: false; problem: ImageUrlProblem };

// The scheme is tested on the raw text, not on `new URL(...).protocol`: the
// URL parser repairs `https:example.com` into `https://example.com/`, and
// accepting the repaired form would store text the parser guessed at rather
// than what the operator typed.
const ABSOLUTE_HTTP_PREFIX = /^https?:\/\//i;

/**
 * True for an absolute http(s) address with a host. Inner whitespace is
 * refused rather than percent-encoded, for the same reason: the stored value
 * is the typed value, and a raw space in it is not an address.
 */
export function isAbsoluteHttpUrl(value: string): boolean {
  if (!ABSOLUTE_HTTP_PREFIX.test(value) || /\s/.test(value)) return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname !== '';
  } catch {
    return false;
  }
}

/**
 * Validate a typed image address against the list it would join. Returns the
 * trimmed address on success. A duplicate is an exact match after trimming -
 * two spellings of one resource are not detectable without fetching.
 */
export function checkImageUrl(raw: string, existing: readonly string[]): ImageUrlCheck {
  const url = raw.trim();
  if (url === '') return { ok: false, problem: 'empty' };
  if (!isAbsoluteHttpUrl(url)) return { ok: false, problem: 'not-a-url' };
  if (existing.includes(url)) return { ok: false, problem: 'duplicate' };
  return { ok: true, url };
}

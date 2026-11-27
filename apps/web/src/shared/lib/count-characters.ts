/**
 * Counts characters the way a person sees them (grapheme clusters): an emoji,
 * a flag and a ZWJ family emoji each count as 1. Display-only: do not use it to
 * mirror a backend limit, which is measured in code points or UTF-16 units.
 *
 * @module apps/web/src/shared/lib
 */
export function countCharacters(value: string): number {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value);
    return Array.from(segments).length;
  }
  // Older engines: code points are the closest approximation available.
  return Array.from(value).length;
}

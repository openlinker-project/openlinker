/**
 * Pure mapping from a page position to a position on the contents rail.
 *
 * The rail marker is a window onto the contents list: its two edges are the
 * top and bottom of what the reader sees, each translated through the section
 * that line currently crosses. Because the mapping is continuous (progress
 * through a section becomes progress through its link, and gaps interpolate
 * between neighbouring links) the marker moves pixel by pixel with the scroll.
 *
 * @module shared/ui
 */
export interface RailSegment {
  /** Section start and end on the page axis (same coordinate space as `y`). */
  start: number;
  end: number;
  /** Matching link start and end on the rail axis. */
  linkStart: number;
  linkEnd: number;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Segments must be in page order. Returns `null` when there are none. */
export function mapViewportToRail(segments: readonly RailSegment[], y: number): number | null {
  if (segments.length === 0) return null;
  const first = segments[0];
  if (y <= first.start) return first.linkStart;
  for (let i = 0; i < segments.length; i += 1) {
    const s = segments[i];
    if (y < s.end) {
      const span = s.end - s.start;
      return lerp(s.linkStart, s.linkEnd, span > 0 ? clamp01((y - s.start) / span) : 0);
    }
    const next = segments[i + 1];
    if (next && y < next.start) {
      const gap = next.start - s.end;
      return lerp(s.linkEnd, next.linkStart, gap > 0 ? clamp01((y - s.end) / gap) : 0);
    }
  }
  return segments[segments.length - 1].linkEnd;
}

/** Marker extent for a viewport spanning `viewTop`..`viewBottom` on the page. */
export function mapViewportWindow(
  segments: readonly RailSegment[],
  viewTop: number,
  viewBottom: number
): { start: number; size: number } | null {
  const a = mapViewportToRail(segments, viewTop);
  const b = mapViewportToRail(segments, viewBottom);
  if (a === null || b === null) return null;
  const start = Math.min(a, b);
  return { start, size: Math.max(2, Math.abs(b - a)) };
}

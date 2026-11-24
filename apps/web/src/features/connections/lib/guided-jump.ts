/**
 * Guided jump choreography (#4228)
 *
 * The pure parts of the "Get orders from a period" hand-off: the timeline, the
 * geometry of the ripple and of the travelling tab underline, the slide
 * direction and the landed signal the Actions panel chains its dialog to. The
 * rendering lives in the page, the panel and `index.css`; none of it is needed
 * for the end state, which is the Actions tab active and the period chosen.
 *
 * @module features/connections/lib
 */

/** Press -> navigation: the button compresses first, the tab travel starts as the route changes. */
export const GUIDED_PRESS_MS = 120;
/** The underline's spring, in Motion's duration/bounce terms (a little overshoot, then rest). */
export const GUIDED_INK_SPRING = { type: 'spring', visualDuration: 0.52, bounce: 0.16 } as const;
/** If the landing signal never comes, the dialog still opens after this long. */
export const GUIDED_DIALOG_FALLBACK_MS = 900;
/** The guided flag is dropped this long after the underline lands. */
export const GUIDED_SETTLE_MS = 240;
/** Last resort for dropping the flag if the sequence stalls. */
export const GUIDED_FLAG_FALLBACK_MS = 1400;

/** A tab's underline span inside the (scrollable) tab list, in the list's own scroll coordinates. */
export interface TabSpan {
  left: number;
  width: number;
}

export interface InkTravel {
  x: [number, number];
  scaleX: [number, number];
}

/**
 * The ink is a 1 px wide, fixed-height line, so a span is `translateX(left)` +
 * `scaleX(width)`: moving between two spans needs transforms only. The height
 * never scales, so the distortion of `scaleX` is invisible.
 */
export function computeInkTravel(from: TabSpan, to: TabSpan): InkTravel {
  return { x: [from.left, to.left], scaleX: [from.width, to.width] };
}

/** +1 when the target tab lies after the origin in tab order, -1 before it, 0 when either is unknown. */
export function tabDirection(
  order: readonly string[],
  from: string | undefined,
  to: string
): 1 | -1 | 0 {
  if (from === undefined) return 0;
  const fromIndex = order.indexOf(from);
  const toIndex = order.indexOf(to);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return 0;
  return toIndex > fromIndex ? 1 : -1;
}

export interface RippleGeometry {
  x: number;
  y: number;
  diameter: number;
}

/**
 * Where the ripple starts and how big it must grow to cover the button from that
 * point. A keyboard activation (no pointer position) ripples from the centre.
 */
export function computeRipple(
  box: { width: number; height: number },
  point: { x: number; y: number } | null
): RippleGeometry {
  const x = point === null ? box.width / 2 : Math.min(Math.max(point.x, 0), box.width);
  const y = point === null ? box.height / 2 : Math.min(Math.max(point.y, 0), box.height);
  const reachX = Math.max(x, box.width - x);
  const reachY = Math.max(y, box.height - y);
  return { x, y, diameter: Math.ceil(2 * Math.hypot(reachX, reachY)) };
}

/** Brings a tab fully into view inside a horizontally scrolling list (the right edge is masked on phones). */
export function scrollLeftToReveal(
  view: { scrollLeft: number; clientWidth: number },
  span: TabSpan,
  edge = 28
): number {
  if (span.left < view.scrollLeft) return Math.max(0, span.left - edge);
  const right = span.left + span.width;
  if (right > view.scrollLeft + view.clientWidth - edge) {
    return right - view.clientWidth + edge;
  }
  return view.scrollLeft;
}

const LANDED_EVENT = 'openlinker:guided-tab-landed';

/** Tells the panel that arrived with the tab that the underline has landed. */
export function announceGuidedLanded(): void {
  window.dispatchEvent(new Event(LANDED_EVENT));
}

/** Subscribes to the landed signal; returns the unsubscribe. */
export function onGuidedLanded(callback: () => void): () => void {
  window.addEventListener(LANDED_EVENT, callback);
  return () => window.removeEventListener(LANDED_EVENT, callback);
}

/**
 * The location as the browser holds it RIGHT NOW. Two components replace the history entry in
 * the same tick (the panel drops its `sync`/`scope` params, the page drops the guided flag) and
 * each used the location from its own render, so whichever ran second restored what the other
 * had just removed. A react-router browser history entry carries `idx`; when it does, the live
 * `window.location` and entry state are the truth, otherwise (memory router) the render's own
 * values are all there is.
 */
export function readLiveLocation<S>(fallback: { search: string; state: S }): {
  search: string;
  state: S | null;
} {
  const entry: unknown = typeof window === 'undefined' ? null : window.history.state;
  if (typeof entry === 'object' && entry !== null && 'idx' in entry) {
    const usr = (entry as { usr?: S | null }).usr;
    return { search: window.location.search, state: usr ?? null };
  }
  return fallback;
}

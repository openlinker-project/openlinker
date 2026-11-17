/**
 * Tour geometry (#4154)
 *
 * Pure placement maths for the highlight ring and the card, kept out of the
 * component so the rules are unit-testable. The lit area is the part of the
 * target that is actually visible: clipped to the viewport below the top bar
 * and above the card, so the card never sits on top of what the step is about.
 *
 * @module features/release-center/tour
 */
export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export type TourDock = 'bottom' | 'right';

export interface TourLayoutInput {
  /** Target rect in viewport coordinates, as returned by getBoundingClientRect. */
  target: Box;
  viewport: { width: number; height: number };
  card: { width: number; height: number };
  /** Lowest y (viewport) the lit area may start at: below the sticky top bar. */
  topInset: number;
}

export interface TourLayout {
  lit: Box;
  dock: TourDock;
}

export const RING_PADDING = 8;
export const CARD_EDGE = 16;
export const CARD_GAP = 16;
export const NARROW_VIEWPORT = 640;
const MIN_LIT_HEIGHT = 120;

function clampBox(target: Box, limits: { top: number; left: number; right: number; bottom: number }): Box {
  const top = Math.max(target.top - RING_PADDING, limits.top);
  const left = Math.max(target.left - RING_PADDING, limits.left);
  const bottom = Math.min(target.top + target.height + RING_PADDING, limits.bottom);
  const right = Math.min(target.left + target.width + RING_PADDING, limits.right);
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/** Space the page must keep free under its last row so a target can scroll clear of a bottom-docked card. */
export function bottomReserve(cardHeight: number): number {
  return Math.ceil(cardHeight + CARD_EDGE + CARD_GAP);
}

export function computeTourLayout(input: TourLayoutInput): TourLayout {
  const { target, viewport, card, topInset } = input;
  const narrow = viewport.width < NARROW_VIEWPORT;
  const side = narrow ? 8 : CARD_EDGE;
  const top = Math.max(topInset - RING_PADDING, 0);

  // On a phone the card is a full-width sheet flush with the bottom edge.
  const cardTop = viewport.height - (narrow ? card.height : card.height + CARD_EDGE);
  const bottomLit = clampBox(target, {
    top,
    left: side,
    right: viewport.width - side,
    bottom: cardTop - CARD_GAP,
  });

  if (!narrow) {
    // A right dock is only worth it when it costs the target nothing sideways:
    // clipping the right-hand column would hide the controls the step talks about.
    const cardLeft = viewport.width - CARD_EDGE - card.width;
    const fitsBeside = target.left + target.width + RING_PADDING <= cardLeft - CARD_GAP;
    if (fitsBeside) {
      const rightLit = clampBox(target, {
        top,
        left: side,
        right: cardLeft - CARD_GAP,
        bottom: viewport.height - CARD_EDGE,
      });
      if (
        bottomLit.height < Math.min(MIN_LIT_HEIGHT, target.height) ||
        rightLit.height > bottomLit.height * 1.15
      ) {
        return { lit: rightLit, dock: 'right' };
      }
    }
  }
  return { lit: bottomLit, dock: 'bottom' };
}

/** True when the whole target is inside the lit box, i.e. nothing of it was clipped. */
export function targetIsFullyLit(layout: TourLayout, target: Box): boolean {
  return layout.lit.height >= target.height + RING_PADDING * 2 - 1;
}
